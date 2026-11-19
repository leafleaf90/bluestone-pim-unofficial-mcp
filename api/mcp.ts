import express, { NextFunction, Request, Response } from "express";
import { VERSION } from "../src/version.js";
import helmet from "helmet";
import rateLimit, { ClientRateLimitInfo, Options, Store } from "express-rate-limit";
import { createHash, timingSafeEqual } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer, Credentials } from "../src/tools.js";
import { validateCredentials } from "../src/validate-credentials.js";
import { renderCredentialsForm } from "../src/auth-form.js";
import {
  randomId,
  seal,
  sha256Hex,
  sign,
  signingSecretProblem,
  unseal,
  verifySignature,
} from "../src/auth-crypto.js";
import {
  createStore,
  KvStore,
  sharedStoreConfig,
  sharedStoreRequired,
  StoreUnavailableError,
} from "../src/store.js";
import {
  REDIRECT_REJECTION_HINT,
  formActionSource,
  isAllowedRedirectUri,
} from "../src/redirect-policy.js";
import { hashForLog, hostForLog, logSecurityEvent } from "../src/security-log.js";

const app = express();
// Vercel sits behind a reverse proxy and sets X-Forwarded-For. express-rate-limit
// requires trust proxy or it throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR, which
// breaks /authorize and /token during connector setup.
app.set("trust proxy", 1);
// A global CSP is not applied: the static connect page is served by Vercel and
// loads a CDN. The only HTML this app renders is the credentials form, which gets
// a route-scoped nonce-based CSP (see setFormHeaders).
app.use(helmet({ contentSecurityPolicy: false }));

// Body parsers are per route with explicit limits. Auth endpoints take small
// form or JSON bodies; /mcp takes JSON-RPC.
const authBody = [
  express.json({ limit: "16kb" }),
  express.urlencoded({ extended: false, limit: "16kb" }),
];
const mcpBody = express.json({ limit: "100kb" });

// Express 4 does not catch rejections from async handlers: an unforwarded error
// leaves the request hanging and raises an unhandled rejection. Every async route
// goes through this wrapper so failures reach the JSON error handler at the end.
type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
function asyncRoute(handler: AsyncRoute) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}

// Bodies and query strings are untrusted: JSON can carry objects, arrays, numbers
// or booleans, and repeated form/query keys become arrays. Keep string values only.
// A dropped field then reads as "missing", which every route already rejects, so a
// malformed value returns a clean 400 instead of throwing on .trim() or .split().
function stringFields(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
// Access token lifetime matches Bluestone's MAPI token expiry (1 hour) minus a
// 60 second buffer for clock skew.
const BEARER_TOKEN_TTL_S = 60 * 60 - 60; // 3540
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CSRF_TTL_MS = 10 * 60 * 1000;
const FAILURE_LIMIT = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

const MAX_REGISTERED_REDIRECT_URIS = 5;
const MAX_REDIRECT_URI_LENGTH = 512;
const MAX_CLIENT_NAME_LENGTH = 100;
const MAX_STATE_LENGTH = 512;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function flag(name: string, defaultValue: boolean): boolean {
  const raw = (process.env[name] ?? "").toLowerCase();
  if (["1", "true", "yes"].includes(raw)) return true;
  if (["0", "false", "no"].includes(raw)) return false;
  return defaultValue;
}

// Header credentials send raw secrets on every request and skip OAuth. Off by default.
const allowHeaderAuth = () => flag("ALLOW_HEADER_AUTH", false);
// The legacy flow encodes credentials in client_id (and therefore in URLs and
// platform logs). Still on by default for existing Claude Desktop setups.
const allowLegacyFlow = () => flag("ALLOW_LEGACY_CLIENT_ID_FLOW", true);
// Temporary escape hatch: only check redirect_uri and client_id at /token when the
// client sends them.
const lenientTokenBinding = () => flag("LENIENT_TOKEN_REDIRECT_CHECK", false);

const store: KvStore = createStore((op, err) =>
  logSecurityEvent("store_degraded", {
    operation: op,
    reason: err instanceof Error ? err.name : "error",
  })
);

const refreshEnabled = () => store.kind === "shared";

function publicBaseUrl(req: Request): string {
  const configured = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return configured || `https://${req.get("host")}`;
}

function listFromEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function requireSigningSecret(res: Response): boolean {
  const problem = signingSecretProblem();
  if (problem) {
    res.status(500).json({ error: "server_misconfigured", error_description: problem });
    return false;
  }
  if (sharedStoreRequired() && !sharedStoreConfig()) {
    res.status(500).json({
      error: "server_misconfigured",
      error_description:
        "REQUIRE_SHARED_STORE is set but no shared store is configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
    });
    return false;
  }
  return true;
}

// ─── Rate limiting ────────────────────────────────────────────────────────────
//
// Counters live in the KvStore, so limits hold across serverless instances when a
// shared store is configured and per instance otherwise.

class KvRateLimitStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  private windowMs = 60_000;

  constructor(name: string) {
    this.prefix = `rl:${name}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const { count, resetAtMs } = await store.incr(this.prefix + key, this.windowMs);
    return { totalHits: count, resetTime: new Date(resetAtMs) };
  }

  async decrement(key: string): Promise<void> {
    await store.decr(this.prefix + key);
  }

  async resetKey(key: string): Promise<void> {
    await store.del(this.prefix + key);
  }
}

function limiter(name: string, limit: number, message: string) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new KvRateLimitStore(name),
    message: { error: message },
    handler: (req, res, _next, options) => {
      logSecurityEvent("throttled", { reason: `rate_limit_${name}`, path: req.path, ip: req.ip });
      res.status(options.statusCode).json(options.message);
    },
  });
}

const mcpRateLimiter = limiter("mcp", 60, "Too many requests. Please wait a moment and try again.");
const authRateLimiter = limiter("auth", 20, "Too many requests. Please wait a moment and try again.");
const validateRateLimiter = limiter(
  "validate",
  10,
  "Too many validation attempts. Please wait a moment and try again."
);

// Failed credential checks are also counted per submitted MAPI client ID, so the
// endpoints cannot be used to brute-force a client secret from many IPs.
function failureKey(mapiClientId: string): string {
  return `fail:${sha256Hex(mapiClientId.trim())}`;
}

async function isThrottled(mapiClientId: string): Promise<boolean> {
  const value = await store.get(failureKey(mapiClientId));
  return value !== null && Number(value) >= FAILURE_LIMIT;
}

async function recordFailure(mapiClientId: string): Promise<void> {
  await store.incr(failureKey(mapiClientId), FAILURE_WINDOW_MS);
}

async function clearFailures(mapiClientId: string): Promise<void> {
  await store.del(failureKey(mapiClientId));
}

const THROTTLED_MESSAGE =
  "Too many failed attempts for this client ID. Wait 15 minutes and try again.";

// ─── Tokens ───────────────────────────────────────────────────────────────────
//
// Access tokens and auth codes are AES-256-GCM sealed values (src/auth-crypto.ts).
// The server keeps no per-token state, apart from optional refresh token records
// when a shared store is configured.

interface TokenPayload extends Credentials {
  iat: number;
  exp: number;
  /** Audience: the MCP endpoint this token is for. */
  aud: string;
  /** Read-only session. */
  ro?: boolean;
  /** Refresh token family id, present when a refresh token was issued. */
  fid?: string;
}

interface OpenToken {
  creds: Credentials;
  readOnly: boolean;
  fid?: string;
  aud: string;
}

function notBeforeMs(): number {
  const seconds = Number(process.env.TOKEN_NOT_BEFORE ?? "0");
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

function sealAccessToken(
  creds: Credentials,
  opts: { aud: string; readOnly: boolean; fid?: string }
): string {
  const now = Date.now();
  const payload: TokenPayload = {
    ...creds,
    iat: now,
    exp: now + BEARER_TOKEN_TTL_S * 1000,
    aud: opts.aud,
    ...(opts.readOnly && { ro: true }),
    ...(opts.fid && { fid: opts.fid }),
  };
  return seal("token", payload);
}

function openAccessToken(token: string): OpenToken | null {
  const payload = unseal<Partial<TokenPayload>>("token", token);
  if (!payload) return null;
  if (!payload.papiKey || !payload.mapiClientId || !payload.mapiClientSecret) return null;
  if (!payload.exp || Date.now() > payload.exp) return null;
  if (!payload.iat || payload.iat < notBeforeMs()) return null;
  if (!payload.aud) return null;
  return {
    creds: {
      papiKey: payload.papiKey,
      mapiClientId: payload.mapiClientId,
      mapiClientSecret: payload.mapiClientSecret,
    },
    readOnly: payload.ro === true,
    fid: payload.fid,
    aud: payload.aud,
  };
}

interface AuthCodePayload {
  jti: string;
  clientId: string;
  redirectUri: string;
  mapiClientId: string;
  papiKey: string;
  /** Present only in the form flow. The legacy flow supplies it at /token. */
  mapiClientSecret?: string;
  codeChallenge: string;
  exp: number;
  ro?: boolean;
}

function sealAuthCode(payload: Omit<AuthCodePayload, "jti" | "exp">): string {
  const full: AuthCodePayload = {
    ...payload,
    jti: randomId(16),
    exp: Date.now() + AUTH_CODE_TTL_MS,
  };
  return seal("code", full);
}

function openAuthCode(code: string): AuthCodePayload | null {
  const payload = unseal<AuthCodePayload>("code", code);
  if (!payload || !payload.jti || !payload.codeChallenge || !payload.exp) return null;
  return payload;
}

interface RefreshRecord {
  creds: Credentials;
  clientId: string;
  fid: string;
  ro?: boolean;
  iat: number;
  absExp: number;
}

const refreshKey = (token: string) => `rt:${sha256Hex(token)}`;
const refreshUsedKey = (token: string) => `rtused:${sha256Hex(token)}`;
const familyRevokedKey = (fid: string) => `famrev:${fid}`;

async function revokeFamily(fid: string): Promise<void> {
  await store.set(familyRevokedKey(fid), "1", REFRESH_TOKEN_TTL_MS);
}

async function storeRefreshToken(record: RefreshRecord): Promise<string> {
  const token = randomId(32);
  const ttl = Math.max(1000, record.absExp - Date.now());
  await store.set(refreshKey(token), seal("refresh", record), ttl);
  return token;
}

// ─── PKCE and parsing helpers ─────────────────────────────────────────────────

function verifyPKCE(codeVerifier: string, codeChallenge: string): boolean {
  // RFC 7636: verifier is 43 to 128 characters from the unreserved set.
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(codeVerifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(codeVerifier).digest().toString("base64url"));
  const expected = Buffer.from(codeChallenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

// Parse composite client_id: "{mapiClientId}:{papiKey}"
function parseClientId(clientId: string): { mapiClientId: string; papiKey: string } | null {
  const colonIndex = clientId.indexOf(":");
  if (colonIndex === -1) return null;
  const mapiClientId = clientId.substring(0, colonIndex);
  const papiKey = clientId.substring(colonIndex + 1);
  if (!mapiClientId || !papiKey) return null;
  return { mapiClientId, papiKey };
}

// RFC 8707: a client may name the resource it wants a token for. Accept the
// server root or the MCP endpoint.
function resourceAllowed(resource: string | undefined, base: string): boolean {
  if (!resource) return true;
  const normalized = resource.replace(/\/+$/, "");
  return normalized === base || normalized === `${base}/mcp`;
}

// ─── Client registration (stateless, signed) ──────────────────────────────────
//
// /register returns a client_id that embeds the registered redirect URIs and is
// HMAC-signed. /authorize verifies the signature and requires the requested
// redirect_uri to match a registered one exactly. No database needed.
//
// Format: "rc_{base64url(json)}.{kid}.{mac}". It never contains a colon, so it
// cannot be mistaken for the legacy "{mapiClientId}:{papiKey}" client_id.
//
// Registration is open, so the redirect allowlist (src/redirect-policy.ts) and
// the destination shown on the credentials form carry the protection.

interface ClientRegistration {
  redirectUris: string[];
  clientName?: string;
}

function signClientRegistration(registration: ClientRegistration): string {
  const payload = Buffer.from(
    JSON.stringify({ u: registration.redirectUris, n: registration.clientName ?? null })
  ).toString("base64url");
  return `rc_${payload}.${sign("client", payload)}`;
}

function verifyClientRegistration(clientId: string): ClientRegistration | null {
  if (!clientId.startsWith("rc_")) return null;
  const rest = clientId.substring(3);
  const firstDot = rest.indexOf(".");
  if (firstDot < 1) return null;
  const payload = rest.substring(0, firstDot);
  if (!verifySignature("client", payload, rest.substring(firstDot + 1))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      u?: unknown;
      n?: unknown;
    };
    if (!Array.isArray(parsed.u) || !parsed.u.every((u) => typeof u === "string")) return null;
    return {
      redirectUris: parsed.u as string[],
      ...(typeof parsed.n === "string" && parsed.n ? { clientName: parsed.n } : {}),
    };
  } catch {
    return null;
  }
}

// ─── CSRF (cookie-bound) ──────────────────────────────────────────────────────
//
// GET /authorize sets a random nonce cookie. The form carries a token that is an
// HMAC over the nonce, client, redirect target, state, PKCE challenge, and an
// expiry. A POST must present both the cookie and a matching token, so a token
// cannot be obtained by a third party and used from another browser.

function csrfCookieName(req: Request): string {
  return req.secure ? "__Host-mcp_csrf" : "mcp_csrf";
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

function ensureCsrfNonce(req: Request, res: Response): string {
  const name = csrfCookieName(req);
  const existing = readCookie(req, name);
  if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
  const nonce = randomId(24);
  res.append(
    "Set-Cookie",
    `${name}=${nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(CSRF_TTL_MS / 1000)}${req.secure ? "; Secure" : ""}`
  );
  return nonce;
}

function csrfData(
  nonce: string,
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
  exp: number
): string {
  return JSON.stringify([nonce, clientId, redirectUri, state, codeChallenge, exp]);
}

function generateCsrfToken(
  nonce: string,
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string
): string {
  const exp = Date.now() + CSRF_TTL_MS;
  return `${exp}.${sign("csrf", csrfData(nonce, clientId, redirectUri, state, codeChallenge, exp))}`;
}

function verifyCsrfToken(
  req: Request,
  token: string,
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string
): boolean {
  const nonce = readCookie(req, csrfCookieName(req));
  if (!nonce) return false;
  const firstDot = token.indexOf(".");
  if (firstDot < 1) return false;
  const exp = Number(token.substring(0, firstDot));
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  return verifySignature(
    "csrf",
    csrfData(nonce, clientId, redirectUri, state, codeChallenge, exp),
    token.substring(firstDot + 1)
  );
}

// Route-scoped CSP for the credentials form. form-action must name the redirect
// target because browsers apply it to the redirect that follows the POST.
function setFormHeaders(res: Response, nonce: string, redirectUri: string): void {
  const formAction = formActionSource(redirectUri);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      `style-src 'nonce-${nonce}'`,
      "img-src 'self'",
      "connect-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      `form-action 'self'${formAction ? ` ${formAction}` : ""}`,
    ].join("; ")
  );
}

// ─── Health check ─────────────────────────────────────────────────────────────

app.get("/", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "unofficial-pim-mcp",
    version: VERSION,
    store: store.kind,
    info: "Visit /connect for setup instructions and documentation.",
  });
});

// ─── OAuth 2.1 discovery ──────────────────────────────────────────────────────

app.get("/.well-known/oauth-authorization-server", (req: Request, res: Response) => {
  const baseUrl = publicBaseUrl(req);
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    ...(refreshEnabled() && { revocation_endpoint: `${baseUrl}/revoke` }),
    grant_types_supported: refreshEnabled()
      ? ["authorization_code", "refresh_token"]
      : ["authorization_code"],
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
  });
});

// RFC 9728 protected resource metadata. The root document describes the server;
// the path-specific document describes the MCP endpoint and is what the
// WWW-Authenticate header points to.
app.get("/.well-known/oauth-protected-resource", (req: Request, res: Response) => {
  const baseUrl = publicBaseUrl(req);
  res.json({ resource: baseUrl, authorization_servers: [baseUrl] });
});

app.get("/.well-known/oauth-protected-resource/mcp", (req: Request, res: Response) => {
  const baseUrl = publicBaseUrl(req);
  res.json({ resource: `${baseUrl}/mcp`, authorization_servers: [baseUrl] });
});

// ─── Dynamic client registration ─────────────────────────────────────────────
//
// RFC 7591: required by Cursor and any other strict OAuth 2.1 client. Returns a
// signed client_id embedding the redirect URIs. No state is stored.

app.post("/register", authRateLimiter, ...authBody, (req: Request, res: Response) => {
  if (!requireSigningSecret(res)) return;

  const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const { redirect_uris, client_name } = body;
  const stringList = (value: unknown): string[] | undefined =>
    Array.isArray(value) && value.length <= 10 && value.every((v) => typeof v === "string" && v.length <= 64)
      ? (value as string[])
      : undefined;
  const grant_types = stringList(body.grant_types);
  const response_types = stringList(body.response_types);

  if (
    !Array.isArray(redirect_uris) ||
    redirect_uris.length === 0 ||
    redirect_uris.length > MAX_REGISTERED_REDIRECT_URIS ||
    !redirect_uris.every((u) => typeof u === "string" && u.length <= MAX_REDIRECT_URI_LENGTH)
  ) {
    res.status(400).json({
      error: "invalid_client_metadata",
      error_description: `redirect_uris is required and must be an array of 1 to ${MAX_REGISTERED_REDIRECT_URIS} URIs`,
    });
    return;
  }

  const uris = redirect_uris as string[];
  const rejected = uris.find((u) => !isAllowedRedirectUri(u));
  if (rejected !== undefined) {
    logSecurityEvent("redirect_rejected", {
      flow: "register",
      redirectHost: hostForLog(rejected),
      ip: req.ip,
    });
    res.status(400).json({ error: "invalid_redirect_uri", error_description: REDIRECT_REJECTION_HINT });
    return;
  }

  const clientName =
    typeof client_name === "string" && client_name.trim()
      ? client_name.trim().slice(0, MAX_CLIENT_NAME_LENGTH)
      : undefined;

  logSecurityEvent("registration", {
    clientName,
    redirectHost: hostForLog(uris[0]),
    ip: req.ip,
  });

  res.status(201).json({
    client_id: signClientRegistration({ redirectUris: uris, clientName }),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: uris,
    ...(clientName && { client_name: clientName }),
    grant_types:
      grant_types ?? (refreshEnabled() ? ["authorization_code", "refresh_token"] : ["authorization_code"]),
    response_types: response_types ?? ["code"],
    token_endpoint_auth_method: "client_secret_post",
  });
});

// ─── Authorization endpoint ───────────────────────────────────────────────────
//
// Two flows share this endpoint:
//
// Legacy (Claude Desktop): client_id = "{mapiClientId}:{papiKey}"
//   Credentials are already known, so the code is issued immediately and the
//   secret arrives at /token (where it is validated). No form. Controlled by
//   ALLOW_LEGACY_CLIENT_ID_FLOW.
//
// Dynamic registration (Cursor and other RFC 7591 clients): client_id is a signed
//   registration. A credentials form is rendered; on POST the credentials are
//   validated, sealed into the auth code, and the client is redirected.
//
// redirect_uri must pass the allowlist in both flows, and in the form flow it
// must also match a registered redirect URI exactly. PKCE (S256) is required.

app.get("/authorize", authRateLimiter, (req: Request, res: Response) => {
  if (!requireSigningSecret(res)) return;

  const { client_id, redirect_uri, state, code_challenge, code_challenge_method, resource } =
    stringFields(req.query) as Record<string, string | undefined>;

  if (!client_id || !redirect_uri || !code_challenge) {
    res.status(400).send("Missing required parameters: client_id, redirect_uri, code_challenge");
    return;
  }
  if (typeof client_id !== "string" || typeof redirect_uri !== "string" || typeof code_challenge !== "string") {
    res.status(400).send("Invalid parameters.");
    return;
  }
  if ((state ?? "").length > MAX_STATE_LENGTH || !PKCE_CHALLENGE_PATTERN.test(code_challenge)) {
    res.status(400).send("Invalid state or code_challenge.");
    return;
  }
  if (!isAllowedRedirectUri(redirect_uri)) {
    logSecurityEvent("redirect_rejected", {
      flow: "authorize",
      redirectHost: hostForLog(redirect_uri),
      ip: req.ip,
    });
    res.status(400).send(REDIRECT_REJECTION_HINT);
    return;
  }
  if (code_challenge_method !== "S256") {
    res.status(400).send("code_challenge_method=S256 is required");
    return;
  }
  if (!resourceAllowed(resource, publicBaseUrl(req))) {
    res.status(400).send("invalid_target: unknown resource.");
    return;
  }

  // Legacy flow: credentials encoded directly in client_id.
  const parsed = client_id.startsWith("rc_") ? null : parseClientId(client_id);
  if (parsed) {
    if (!allowLegacyFlow()) {
      res
        .status(400)
        .send("The legacy client_id flow is disabled on this server. Connect with a client that supports dynamic client registration.");
      return;
    }
    logSecurityEvent("legacy_flow_used", { flow: "authorize", ip: req.ip });
    const code = sealAuthCode({
      clientId: client_id,
      redirectUri: redirect_uri,
      mapiClientId: parsed.mapiClientId,
      papiKey: parsed.papiKey,
      codeChallenge: code_challenge,
    });
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (state) redirectUrl.searchParams.set("state", state);
    res.redirect(redirectUrl.toString());
    return;
  }

  // Dynamic registration flow: signed client_id and exact redirect match.
  const registration = verifyClientRegistration(client_id);
  if (!registration) {
    logSecurityEvent("unknown_client", { flow: "authorize", ip: req.ip });
    res.status(400).send("Unknown client_id. Register the client at /register first.");
    return;
  }
  if (!registration.redirectUris.includes(redirect_uri)) {
    logSecurityEvent("redirect_rejected", {
      flow: "authorize_mismatch",
      redirectHost: hostForLog(redirect_uri),
      ip: req.ip,
    });
    res.status(400).send("redirect_uri does not match the registered redirect URIs for this client.");
    return;
  }

  const nonce = randomId(16);
  const csrfNonce = ensureCsrfNonce(req, res);
  setFormHeaders(res, nonce, redirect_uri);
  res.send(
    renderCredentialsForm({
      nonce,
      storesRefreshToken: refreshEnabled(),
      redirectUri: redirect_uri,
      clientId: client_id,
      clientName: registration.clientName,
      state: state ?? "",
      codeChallenge: code_challenge,
      csrfToken: generateCsrfToken(csrfNonce, client_id, redirect_uri, state ?? "", code_challenge),
    })
  );
});

// ─── Credential validation ────────────────────────────────────────────────────
//
// Probes Bluestone MAPI and PAPI with submitted credentials. Used by the HTML
// connect form before authorisation. Credentials are not stored or logged.

app.post(
  "/validate-credentials",
  validateRateLimiter,
  ...authBody,
  asyncRoute(async (req: Request, res: Response) => {
    if (!requireSigningSecret(res)) return;

    const {
      csrf_token,
      client_id,
      redirect_uri,
      state,
      code_challenge,
      mapi_client_id,
      mapi_client_secret,
      papi_key,
    } = stringFields(req.body);

    if (
      !csrf_token ||
      !client_id ||
      !redirect_uri ||
      !code_challenge ||
      !mapi_client_id ||
      !mapi_client_secret ||
      !papi_key
    ) {
      res.status(400).json({ ok: false, error: "Missing required fields." });
      return;
    }

    if (!verifyCsrfToken(req, csrf_token, client_id, redirect_uri, state ?? "", code_challenge)) {
      res.status(400).json({
        ok: false,
        error: "Invalid or expired request. Go back and open the connect page again.",
      });
      return;
    }

    if (await isThrottled(mapi_client_id)) {
      logSecurityEvent("throttled", { reason: "failed_validation_per_client", clientHash: hashForLog(mapi_client_id) });
      res.status(429).json({ ok: false, error: THROTTLED_MESSAGE });
      return;
    }

    const creds: Credentials = {
      mapiClientId: mapi_client_id.trim(),
      mapiClientSecret: mapi_client_secret,
      papiKey: papi_key.trim(),
    };

    const result = await validateCredentials(creds);
    if (result.ok) {
      await clearFailures(creds.mapiClientId);
      res.json({ ok: true });
      return;
    }

    await recordFailure(creds.mapiClientId);
    logSecurityEvent("credential_validation_failed", {
      flow: "validate",
      clientHash: hashForLog(creds.mapiClientId),
      ip: req.ip,
    });
    res.status(400).json({
      ok: false,
      ...(result.mapi && { mapi: result.mapi }),
      ...(result.papi && { papi: result.papi }),
      ...(result.general && { error: result.general }),
    });
  })
);

// Form submission for the dynamic registration flow.
app.post("/authorize", authRateLimiter, ...authBody, asyncRoute(async (req: Request, res: Response) => {
  if (!requireSigningSecret(res)) return;

  const {
    client_id,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    csrf_token,
    mapi_client_id,
    mapi_client_secret,
    papi_key,
    read_only,
  } = stringFields(req.body);

  // Verify the client registration and redirect target before rendering anything
  // that echoes request values. Failures here return plain text.
  const registration = client_id ? verifyClientRegistration(client_id) : null;
  if (!registration || !redirect_uri || !registration.redirectUris.includes(redirect_uri)) {
    logSecurityEvent("unknown_client", { flow: "authorize_post", ip: req.ip });
    res.status(400).send("Unknown client or redirect_uri. Start the connection again from your app.");
    return;
  }
  if (!isAllowedRedirectUri(redirect_uri)) {
    res.status(400).send(REDIRECT_REJECTION_HINT);
    return;
  }

  const nonce = randomId(16);
  const csrfNonce = ensureCsrfNonce(req, res);
  const readOnly = read_only === "1";
  const renderFormError = (formError: string, fieldErrors?: { mapi?: string; papi?: string }, status = 400) => {
    setFormHeaders(res, nonce, redirect_uri);
    res.status(status).send(
      renderCredentialsForm({
        nonce,
        storesRefreshToken: refreshEnabled(),
        readOnlyChecked: readOnly,
        redirectUri: redirect_uri,
        clientId: client_id,
        clientName: registration.clientName,
        state: state ?? "",
        codeChallenge: code_challenge ?? "",
        csrfToken: generateCsrfToken(csrfNonce, client_id, redirect_uri, state ?? "", code_challenge ?? ""),
        mapiClientId: mapi_client_id ?? "",
        papiKey: papi_key ?? "",
        formError,
        fieldErrors,
      })
    );
  };

  if (!code_challenge || !csrf_token || !mapi_client_id || !mapi_client_secret || !papi_key) {
    renderFormError("Missing required fields.");
    return;
  }
  if (code_challenge_method !== "S256" || !PKCE_CHALLENGE_PATTERN.test(code_challenge)) {
    renderFormError("code_challenge_method=S256 is required.");
    return;
  }
  if (!verifyCsrfToken(req, csrf_token, client_id, redirect_uri, state ?? "", code_challenge)) {
    renderFormError("Invalid or expired request. Please go back and try again.");
    return;
  }

  if (await isThrottled(mapi_client_id)) {
    logSecurityEvent("throttled", { reason: "failed_validation_per_client", clientHash: hashForLog(mapi_client_id) });
    renderFormError(THROTTLED_MESSAGE, undefined, 429);
    return;
  }

  const creds: Credentials = {
    mapiClientId: mapi_client_id.trim(),
    mapiClientSecret: mapi_client_secret,
    papiKey: papi_key.trim(),
  };

  const validation = await validateCredentials(creds);
  if (!validation.ok) {
    await recordFailure(creds.mapiClientId);
    logSecurityEvent("credential_validation_failed", {
      flow: "authorize_post",
      clientHash: hashForLog(creds.mapiClientId),
      ip: req.ip,
    });
    renderFormError("Credentials could not be verified. Fix the errors below and test again.", {
      mapi: validation.mapi,
      papi: validation.papi,
    });
    return;
  }
  await clearFailures(creds.mapiClientId);

  const code = sealAuthCode({
    clientId: client_id,
    redirectUri: redirect_uri,
    mapiClientId: creds.mapiClientId,
    mapiClientSecret: creds.mapiClientSecret,
    papiKey: creds.papiKey,
    codeChallenge: code_challenge,
    ...(readOnly && { ro: true }),
  });

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (state) redirectUrl.searchParams.set("state", state);
  res.redirect(redirectUrl.toString());
}));

// ─── Token endpoint ───────────────────────────────────────────────────────────

async function issueTokens(
  req: Request,
  res: Response,
  opts: {
    creds: Credentials;
    clientId: string;
    readOnly: boolean;
    refresh?: { fid: string; absExp: number };
  }
): Promise<void> {
  const aud = `${publicBaseUrl(req)}/mcp`;
  let refreshToken: string | undefined;
  let fid: string | undefined;

  if (refreshEnabled()) {
    fid = opts.refresh?.fid ?? randomId(16);
    const now = Date.now();
    refreshToken = await storeRefreshToken({
      creds: opts.creds,
      clientId: opts.clientId,
      fid,
      ro: opts.readOnly || undefined,
      iat: now,
      absExp: opts.refresh?.absExp ?? now + REFRESH_TOKEN_TTL_MS,
    });
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.json({
    access_token: sealAccessToken(opts.creds, { aud, readOnly: opts.readOnly, fid }),
    token_type: "Bearer",
    expires_in: BEARER_TOKEN_TTL_S,
    ...(refreshToken && { refresh_token: refreshToken }),
  });
}

app.post("/token", authRateLimiter, ...authBody, asyncRoute(async (req: Request, res: Response) => {
  if (!requireSigningSecret(res)) return;

  const body = stringFields(req.body);
  const { grant_type } = body;

  if (grant_type === "refresh_token" && refreshEnabled()) {
    await handleRefreshGrant(req, res, body);
    return;
  }
  if (grant_type !== "authorization_code") {
    res.status(400).json({ error: "unsupported_grant_type" });
    return;
  }

  const { code, code_verifier, client_secret, redirect_uri, client_id, resource } = body;

  if (!code || !code_verifier) {
    res.status(400).json({ error: "invalid_request", error_description: "Missing code or code_verifier" });
    return;
  }

  const codePayload = openAuthCode(code);
  if (!codePayload) {
    res.status(400).json({ error: "invalid_grant", error_description: "Invalid or tampered auth code" });
    return;
  }
  if (Date.now() > codePayload.exp) {
    res.status(400).json({ error: "invalid_grant", error_description: "Authorization code expired" });
    return;
  }
  if (!verifyPKCE(code_verifier, codePayload.codeChallenge)) {
    res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
    return;
  }

  // The code is bound to the client and redirect target it was issued for.
  const lenient = lenientTokenBinding();
  const redirectMismatch = lenient
    ? redirect_uri !== undefined && redirect_uri !== codePayload.redirectUri
    : redirect_uri !== codePayload.redirectUri;
  const clientMismatch = lenient
    ? client_id !== undefined && client_id !== codePayload.clientId
    : client_id !== codePayload.clientId;
  if (redirectMismatch || clientMismatch) {
    logSecurityEvent("auth_code_binding_mismatch", {
      reason: redirectMismatch ? "redirect_uri" : "client_id",
      ip: req.ip,
    });
    res.status(400).json({
      error: "invalid_grant",
      error_description: "redirect_uri and client_id must match the authorization request.",
    });
    return;
  }
  if (!resourceAllowed(resource, publicBaseUrl(req))) {
    res.status(400).json({ error: "invalid_target", error_description: "Unknown resource." });
    return;
  }

  // Single use. Checked after PKCE and binding so a failed guess cannot burn a code.
  const firstUse = await store.setIfAbsent(`code:${codePayload.jti}`, "1", AUTH_CODE_TTL_MS * 2);
  if (!firstUse) {
    logSecurityEvent("auth_code_reuse", { ip: req.ip });
    res.status(400).json({ error: "invalid_grant", error_description: "Authorization code already used" });
    return;
  }

  // MAPI secret: from the auth code (form flow) or the client_secret body param (legacy flow).
  const mapiClientSecret = codePayload.mapiClientSecret ?? client_secret;
  if (!mapiClientSecret) {
    res.status(400).json({ error: "invalid_request", error_description: "Missing client_secret" });
    return;
  }

  const creds: Credentials = {
    papiKey: codePayload.papiKey,
    mapiClientId: codePayload.mapiClientId,
    mapiClientSecret,
  };

  // Legacy flow only: the secret arrives here for the first time and has not been
  // checked against Bluestone. Validate it so a bogus client_secret never yields a
  // token. (The form flow validated all credentials at /authorize.)
  if (codePayload.mapiClientSecret === undefined) {
    if (await isThrottled(creds.mapiClientId)) {
      logSecurityEvent("throttled", { reason: "failed_validation_per_client", clientHash: hashForLog(creds.mapiClientId) });
      res.status(429).json({ error: "temporarily_unavailable", error_description: THROTTLED_MESSAGE });
      return;
    }
    const validation = await validateCredentials(creds);
    if (!validation.ok) {
      await recordFailure(creds.mapiClientId);
      logSecurityEvent("credential_validation_failed", {
        flow: "token_legacy",
        clientHash: hashForLog(creds.mapiClientId),
        ip: req.ip,
      });
      res.status(400).json({
        error: "invalid_grant",
        error_description:
          "Bluestone credentials could not be verified. Check the MAPI client ID and secret and the PAPI key.",
      });
      return;
    }
    await clearFailures(creds.mapiClientId);
  }

  await issueTokens(req, res, {
    creds,
    clientId: codePayload.clientId,
    readOnly: codePayload.ro === true,
  });
}));

// Refresh grant (shared store only): rotating opaque refresh tokens with reuse
// detection. Presenting an already-used token revokes the whole token family.
async function handleRefreshGrant(req: Request, res: Response, body: Record<string, string>): Promise<void> {
  const { refresh_token, client_id } = body;
  const invalid = (description: string) =>
    res.status(400).json({ error: "invalid_grant", error_description: description });

  if (!refresh_token || typeof refresh_token !== "string" || refresh_token.length > 200) {
    invalid("Missing or malformed refresh_token");
    return;
  }

  const sealed = await store.get(refreshKey(refresh_token));
  if (!sealed) {
    const usedFamily = await store.get(refreshUsedKey(refresh_token));
    if (usedFamily) {
      await revokeFamily(usedFamily);
      logSecurityEvent("refresh_reuse", { ip: req.ip });
    }
    invalid("Invalid refresh token");
    return;
  }

  const record = unseal<RefreshRecord>("refresh", sealed);
  if (!record || Date.now() > record.absExp || record.iat < notBeforeMs()) {
    invalid("Refresh token expired. Connect again.");
    return;
  }
  if (await store.get(familyRevokedKey(record.fid))) {
    invalid("Refresh token revoked");
    return;
  }
  if (client_id !== record.clientId) {
    logSecurityEvent("auth_code_binding_mismatch", { reason: "refresh_client_id", ip: req.ip });
    invalid("client_id does not match the refresh token");
    return;
  }

  // Consume: the first caller wins. A second use of the same token is treated as theft.
  const ttl = Math.max(1000, record.absExp - Date.now());
  const consumed = await store.setIfAbsent(refreshUsedKey(refresh_token), record.fid, ttl);
  if (!consumed) {
    await revokeFamily(record.fid);
    logSecurityEvent("refresh_reuse", { ip: req.ip });
    invalid("Invalid refresh token");
    return;
  }
  await store.del(refreshKey(refresh_token));

  await issueTokens(req, res, {
    creds: record.creds,
    clientId: record.clientId,
    readOnly: record.ro === true,
    refresh: { fid: record.fid, absExp: record.absExp },
  });
}

// ─── Revocation (RFC 7009) ────────────────────────────────────────────────────
//
// Available when a shared store is configured. Revoking a refresh token (or an
// access token that carries a family id) revokes the whole family, which also
// ends access tokens from that family at /mcp.

app.post("/revoke", authRateLimiter, ...authBody, asyncRoute(async (req: Request, res: Response) => {
  if (!requireSigningSecret(res)) return;
  if (!refreshEnabled()) {
    res.status(404).json({ error: "unsupported_operation" });
    return;
  }
  const token = (req.body ?? {}).token;
  if (typeof token === "string" && token.length > 0 && token.length < 4096) {
    let fid: string | undefined;
    const sealed = await store.get(refreshKey(token));
    if (sealed) {
      fid = unseal<RefreshRecord>("refresh", sealed)?.fid;
      await store.del(refreshKey(token));
    } else {
      fid = openAccessToken(token)?.fid;
    }
    if (fid) {
      await revokeFamily(fid);
      logSecurityEvent("refresh_revoked", { ip: req.ip });
    }
  }
  // RFC 7009: respond 200 whether or not the token was known.
  res.status(200).json({});
}));

// ─── MCP endpoint ─────────────────────────────────────────────────────────────
//
// Origin validation (MCP transport guidance): requests from browsers carry an
// Origin header. Native clients send none. A present Origin must be on the
// allowlist. Extend with MCP_ALLOWED_ORIGINS; "*" disables the check.
const DEFAULT_ALLOWED_ORIGINS = [
  "https://claude.ai",
  "https://claude.com",
  "https://chatgpt.com",
  "https://vscode.dev",
  "https://insiders.vscode.dev",
  "https://www.cursor.com",
];

function originAllowed(origin: string): boolean {
  const extra = listFromEnv("MCP_ALLOWED_ORIGINS").map((o) => o.replace(/\/+$/, ""));
  if (extra.includes("*")) return true;
  return [...DEFAULT_ALLOWED_ORIGINS, ...extra].includes(origin.replace(/\/+$/, ""));
}

function originGuard(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin !== undefined && !originAllowed(origin)) {
    logSecurityEvent("origin_rejected", { originHost: hostForLog(origin), path: req.path, ip: req.ip });
    res.status(403).json({ error: "forbidden", description: "Origin not allowed." });
    return;
  }
  next();
}

// app.all is intentional: the MCP SDK's handleRequest needs to handle both
// GET (SSE stream initiation) and POST (JSON-RPC calls) on the same path.
app.all("/mcp", originGuard, mcpRateLimiter, mcpBody, asyncRoute(async (req: Request, res: Response) => {
  if (!requireSigningSecret(res)) return;

  let creds: Credentials | null = null;
  let readOnly = false;
  const authHeader = req.headers.authorization;
  const hasBearer = !!authHeader?.startsWith("Bearer ");

  // Primary: sealed Bearer token from the OAuth flow.
  if (hasBearer) {
    const opened = openAccessToken(authHeader!.substring(7));
    if (opened && opened.aud === `${publicBaseUrl(req)}/mcp`) {
      const revoked = opened.fid ? await store.get(familyRevokedKey(opened.fid)) : null;
      if (!revoked) {
        creds = opened.creds;
        readOnly = opened.readOnly;
      }
    }
    if (!creds) logSecurityEvent("invalid_token", { path: req.path, ip: req.ip });
  }

  // Development fallback, off by default. A present but invalid Bearer token is
  // never replaced by header credentials.
  if (!creds && !hasBearer && allowHeaderAuth()) {
    const papiKey = req.headers["x-papi-key"] as string | undefined;
    const mapiClientId = req.headers["x-mapi-client-id"] as string | undefined;
    const mapiClientSecret = req.headers["x-mapi-client-secret"] as string | undefined;
    if (papiKey && mapiClientId && mapiClientSecret) {
      creds = { papiKey, mapiClientId, mapiClientSecret };
    }
  }

  if (!creds) {
    res.setHeader(
      "WWW-Authenticate",
      `Bearer resource_metadata="${publicBaseUrl(req)}/.well-known/oauth-protected-resource/mcp"` +
        (hasBearer ? ', error="invalid_token"' : "")
    );
    res.status(401).json({
      error: "Unauthorized",
      description: hasBearer
        ? "The access token is invalid or expired. Reconnect the connector to get a new one."
        : "Connect via your MCP client's connector UI to authorise this server.",
    });
    return;
  }

  const server = createMcpServer(creds, { readOnly });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", async () => {
    await transport.close();
    await server.close();
  });

  await server.connect(transport);
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}));

// JSON error responses for oversized or malformed bodies.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  if (err instanceof StoreUnavailableError) {
    // REQUIRE_SHARED_STORE is on and the store is down: refuse instead of degrading.
    res.setHeader("Retry-After", "30");
    res.status(503).json({ error: "temporarily_unavailable" });
    return;
  }
  const status = (err as { status?: number })?.status ?? 500;
  res.status(status >= 400 && status < 500 ? status : 500).json({
    error: status === 413 ? "payload_too_large" : status >= 400 && status < 500 ? "invalid_request" : "server_error",
  });
});

export default app;
