import express, { Request, Response } from "express";
import { VERSION } from "../src/version.js";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import {
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer, Credentials } from "../src/tools.js";
import {
  getBluestoneEnvironmentLabel,
  validateCredentials,
} from "../src/validate-credentials.js";

const app = express();
// Vercel sits behind a reverse proxy and sets X-Forwarded-For. express-rate-limit
// requires trust proxy or it throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR, which
// breaks /authorize and /token during connector setup.
app.set("trust proxy", 1);
// CSP is disabled: helmet's default includes `form-action 'self'` which blocks
// the credentials form POST. The form is protected by the HMAC CSRF token instead.
// TODO (production): re-enable CSP with a proper nonce-based policy.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Rate limiting: in-memory store per Vercel instance; not globally consistent
// across concurrent instances. Sufficient for abuse prevention at this scale.
// For strict global limits, replace the default store with a Redis-backed one
// (e.g. rate-limit-redis) pointing at Vercel KV or Upstash.
const mcpRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a moment and try again." },
});

// Auth endpoints are rate-limited more strictly: they are called at most once
// per connection setup, so 20/min per IP is already generous.
const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a moment and try again." },
});

// Credential validation is a separate probe endpoint: stricter limit to reduce
// brute-force surface while still allowing a few retries during setup.
const validateRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many validation attempts. Please wait a moment and try again." },
});

// ─── Signing secret ───────────────────────────────────────────────────────────
//
// SIGNING_SECRET must be set as a Vercel environment variable.
// Used to derive the AES-256 key for encrypting auth codes and bearer tokens,
// and as the HMAC key for CSRF tokens.
// Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

const SIGNING_SECRET = process.env.SIGNING_SECRET ?? "";

// Auth code lifetime (5 minutes). Bearer token lifetime matches Bluestone's
// MAPI token expiry (1 hour), minus a 60-second buffer for clock skew.
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const BEARER_TOKEN_TTL_S = 60 * 60 - 60; // 3540

function requireSigningSecret(res: Response): boolean {
  if (!SIGNING_SECRET) {
    res.status(500).json({
      error: "server_misconfigured",
      error_description: "SIGNING_SECRET environment variable is not set.",
    });
    return false;
  }
  return true;
}

// ─── Crypto helpers ───────────────────────────────────────────────────────────
//
// AES-256-GCM provides both confidentiality and authenticity: the auth tag
// detects any tampering, so no separate HMAC is needed.
//
// Format for all encrypted values: "{iv}.{authTag}.{ciphertext}" (all base64url)

// Derived once at module load: recomputing on every request would be wasteful
// and the secret doesn't change at runtime.
// Note: if SIGNING_SECRET is unset this derives a key from an empty string.
// That key is never used in practice because requireSigningSecret() guards all
// auth endpoints, but the derivation itself is harmless.
const AES_KEY: Buffer = createHash("sha256").update(SIGNING_SECRET).digest();

function encryptAES(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", AES_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptAES(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0], "base64url");
    const authTag = Buffer.from(parts[1], "base64url");
    const encrypted = Buffer.from(parts[2], "base64url");
    const decipher = createDecipheriv("aes-256-gcm", AES_KEY, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// Encrypt the auth code payload: keeps mapiClientId and PAPI key out of the
// redirect URL even if it is intercepted.
function encryptAuthCode(payload: object): string {
  return encryptAES(JSON.stringify(payload));
}

// Decrypt and parse the auth code. Returns null if invalid, tampered, or expired.
// mapiClientSecret is present only in the dynamic registration (form) flow -
// in the legacy Claude Desktop flow it arrives separately as client_secret at /token.
function decryptAuthCode(
  code: string
): { mapiClientId: string; papiKey: string; mapiClientSecret?: string; codeChallenge: string; exp: number } | null {
  const json = decryptAES(code);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Encrypt Bluestone credentials into a Bearer token.
//
// mapiClientId is used as AES-GCM Additional Authenticated Data (AAD) and
// stored as a plaintext prefix on the token. This binds the token to a specific
// client identity: decryption fails if the prefix is altered, so knowing
// SIGNING_SECRET alone is not enough to bulk-decrypt tokens without also knowing
// each user's mapiClientId.
//
// Token format: "{base64url(mapiClientId)}.{iv}.{authTag}.{ciphertext}"
//
// An exp timestamp is embedded in the payload so the server can reject expired
// tokens independently of whatever the client does with expires_in.
function encryptToken(creds: Credentials): string {
  const payload = { ...creds, exp: Date.now() + BEARER_TOKEN_TTL_S * 1000 };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", AES_KEY, iv);
  cipher.setAAD(Buffer.from(creds.mapiClientId, "utf8"));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const aad = Buffer.from(creds.mapiClientId).toString("base64url");
  return `${aad}.${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

// Decrypt a Bearer token back to credentials. Returns null if invalid, tampered, or expired.
function decryptToken(token: string): Credentials | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  try {
    const mapiClientId = Buffer.from(parts[0], "base64url").toString("utf8");
    const iv = Buffer.from(parts[1], "base64url");
    const authTag = Buffer.from(parts[2], "base64url");
    const encrypted = Buffer.from(parts[3], "base64url");
    const decipher = createDecipheriv("aes-256-gcm", AES_KEY, iv);
    decipher.setAAD(Buffer.from(mapiClientId, "utf8"));
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(decrypted) as Partial<Credentials> & { exp?: number };
    if (!parsed.papiKey || !parsed.mapiClientId || !parsed.mapiClientSecret) return null;
    if (!parsed.exp || Date.now() > parsed.exp) return null;
    // Verify AAD prefix matches decrypted content: detects prefix tampering
    if (parsed.mapiClientId !== mapiClientId) return null;
    return {
      papiKey: parsed.papiKey,
      mapiClientId: parsed.mapiClientId,
      mapiClientSecret: parsed.mapiClientSecret,
    };
  } catch {
    return null;
  }
}

// ─── Other helpers ────────────────────────────────────────────────────────────

// Parse composite client_id: "{mapiClientId}:{papiKey}"
function parseClientId(clientId: string): { mapiClientId: string; papiKey: string } | null {
  const colonIndex = clientId.indexOf(":");
  if (colonIndex === -1) return null;
  const mapiClientId = clientId.substring(0, colonIndex);
  const papiKey = clientId.substring(colonIndex + 1);
  if (!mapiClientId || !papiKey) return null;
  return { mapiClientId, papiKey };
}

// PKCE S256 verification
function verifyPKCE(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash("sha256").update(codeVerifier).digest().toString("base64url");
  return computed === codeChallenge;
}

// ─── redirect_uri validation ──────────────────────────────────────────────────
//
// Blocks javascript: and data: URIs (XSS vectors) and rejects unparseable URIs.
// Everything else is allowed: localhost, HTTPS, and custom app URI schemes
// (e.g. cursor://). Custom schemes are legitimate for desktop OAuth clients.
//
// PKCE (S256) is the primary protection against code interception regardless.
//
// TODO (production): enforce an allowlist of redirect_uris registered per client
// at /register time instead of this open check.
function isValidRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol !== "javascript:" && url.protocol !== "data:";
  } catch {
    return false;
  }
}

// ─── CSRF helpers ─────────────────────────────────────────────────────────────
//
// Used only for the form-based /authorize flow (dynamic registration clients).
// Token is HMAC-SHA256(SIGNING_SECRET, "csrf:" + state + ":" + codeChallenge).
// Binding the token to the PKCE challenge and state means it cannot be replayed
// across different authorization requests.
function generateCsrfToken(state: string, codeChallenge: string): string {
  return createHmac("sha256", SIGNING_SECRET)
    .update(`csrf:${state}:${codeChallenge}`)
    .digest("base64url");
}

function verifyCsrfToken(token: string, state: string, codeChallenge: string): boolean {
  const expected = generateCsrfToken(state, codeChallenge);
  try {
    return timingSafeEqual(Buffer.from(token, "base64url"), Buffer.from(expected, "base64url"));
  } catch {
    return false;
  }
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatValidationErrors(errors: { mapi?: string; papi?: string }): string {
  const parts: string[] = [];
  if (errors.mapi) parts.push(errors.mapi);
  if (errors.papi) parts.push(errors.papi);
  return parts.join(" ");
}

function renderCredentialsForm(params: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  csrfToken: string;
  mapiClientId?: string;
  mapiClientSecret?: string;
  papiKey?: string;
  formError?: string;
  fieldErrors?: { mapi?: string; papi?: string };
}): string {
  const {
    redirectUri,
    state,
    codeChallenge,
    csrfToken,
    mapiClientId = "",
    mapiClientSecret = "",
    papiKey = "",
    formError,
    fieldErrors,
  } = params;
  const envLabel = getBluestoneEnvironmentLabel();
  const envBadgeClass = envLabel === "production" ? "env-badge production" : "env-badge test";
  const initialStatus = formError
    ? escHtml(formError + (fieldErrors ? " " + formatValidationErrors(fieldErrors) : ""))
    : "";
  const initialStatusClass = formError ? "status error" : "status hidden";
  const mapiFieldErrorClass = fieldErrors?.mapi ? "field-error" : "";
  const papiFieldErrorClass = fieldErrors?.papi ? "field-error" : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorise · Bluestone PIM Unofficial MCP</title>
  <link rel="icon" type="image/png" href="/bluestone_pim_logo.png">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f3f4f6; margin: 0; padding: 40px 16px; color: #111827; }
    .card { background: white; border: 1px solid #e5e7eb; border-radius: 12px; max-width: 440px; margin: 0 auto; padding: 32px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    .card-header { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
    .logo { height: 40px; width: auto; display: block; flex-shrink: 0; }
    .card-header-text { min-width: 0; }
    .eyebrow { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #6b7280; margin: 0 0 4px; }
    h1 { font-size: 1.125rem; font-weight: 600; line-height: 1.35; margin: 0; }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 16px; }
    .env-badge { font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; }
    .env-badge.test { background: #fef3c7; color: #92400e; }
    .env-badge.production { background: #dcfce7; color: #166534; }
    .unofficial-note { font-size: 0.8125rem; color: #6b7280; }
    .intro { font-size: 0.875rem; color: #4b5563; margin: 0 0 16px; line-height: 1.5; }
    .steps { font-size: 0.8125rem; color: #374151; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; margin: 0 0 20px; line-height: 1.5; }
    .steps strong { color: #111827; }
    label { display: block; font-size: 0.8125rem; font-weight: 500; color: #374151; margin-bottom: 4px; }
    .field-hint { font-size: 0.75rem; color: #9ca3af; font-weight: 400; margin-left: 4px; }
    .field-group { margin-bottom: 14px; }
    input[type=text], input[type=password] { display: block; width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.875rem; margin-bottom: 0; outline: none; }
    input.field-error { border-color: #dc2626; }
    input[type=text]:focus, input[type=password]:focus { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.15); }
    input.field-error:focus { border-color: #dc2626; box-shadow: 0 0 0 2px rgba(220,38,38,0.15); }
    .secret-row { display: flex; gap: 8px; align-items: stretch; }
    .secret-row input { flex: 1; min-width: 0; }
    button.toggle-secret { width: auto; flex-shrink: 0; padding: 8px 12px; white-space: nowrap; }
    .status { font-size: 0.875rem; margin-bottom: 16px; padding: 10px 12px; border-radius: 6px; line-height: 1.45; }
    .status.hidden { display: none; }
    .status.error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .status.success { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
    .status.pending { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
    .button-row { display: flex; flex-direction: column; gap: 8px; }
    button { display: block; width: 100%; padding: 10px; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer; }
    button.primary { background: #2563eb; color: white; border: none; }
    button.primary:hover:not(:disabled) { background: #1d4ed8; }
    button.secondary { background: #fff; color: #374151; border: 1px solid #d1d5db; }
    button.secondary:hover:not(:disabled) { background: #f9fafb; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .footnote { font-size: 0.75rem; color: #9ca3af; margin: 20px 0 0; line-height: 1.5; }
    .footnote a { color: #2563eb; text-decoration: none; }
    .footnote a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <header class="card-header">
      <img src="/bluestone_pim_logo.png" alt="Bluestone PIM" class="logo" width="120" height="40">
      <div class="card-header-text">
        <p class="eyebrow">Bluestone PIM Labs</p>
        <h1>Unofficial MCP</h1>
      </div>
    </header>
    <div class="meta">
      <span class="${envBadgeClass}">${escHtml(envLabel)} environment</span>
      <span class="unofficial-note">Community project, not an official Bluestone product</span>
    </div>
    <p class="intro">Enter the Bluestone API credentials for your organisation. They are checked over HTTPS, encrypted into your session token, and are not stored on this server.</p>
    <p class="steps"><strong>1.</strong> Fill in all three fields &nbsp;·&nbsp; <strong>2.</strong> Test connection &nbsp;·&nbsp; <strong>3.</strong> Authorise</p>
    <form id="cred-form" method="POST" action="/authorize" autocomplete="off">
      <input type="hidden" name="redirect_uri" value="${escHtml(redirectUri)}">
      <input type="hidden" name="state" value="${escHtml(state)}">
      <input type="hidden" name="code_challenge" value="${escHtml(codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="S256">
      <input type="hidden" name="csrf_token" value="${escHtml(csrfToken)}">

      <div class="field-group">
        <label for="mapi_client_id">MAPI Client ID<span class="field-hint">working-state API</span></label>
        <input type="text" id="mapi_client_id" name="mapi_client_id" required
               class="${escHtml(mapiFieldErrorClass)}"
               value="${escHtml(mapiClientId)}"
               placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off" spellcheck="false">
      </div>

      <div class="field-group">
        <label for="mapi_client_secret">MAPI Client Secret</label>
        <div class="secret-row">
          <input type="password" id="mapi_client_secret" name="mapi_client_secret" required
                 class="${escHtml(mapiFieldErrorClass)}"
                 value="${escHtml(mapiClientSecret)}"
                 placeholder="your-mapi-client-secret" autocomplete="new-password">
          <button type="button" id="toggle-secret-btn" class="secondary toggle-secret"
                  aria-label="Show MAPI Client Secret" aria-pressed="false">Show</button>
        </div>
      </div>

      <div class="field-group">
        <label for="papi_key">PAPI Key<span class="field-hint">published catalog API</span></label>
        <input type="text" id="papi_key" name="papi_key" required
               class="${escHtml(papiFieldErrorClass)}"
               value="${escHtml(papiKey)}"
               placeholder="your-papi-key" autocomplete="off" spellcheck="false">
      </div>

      <div id="status" class="${initialStatusClass}" role="status" aria-live="polite">${initialStatus}</div>

      <div class="button-row">
        <button type="button" id="test-btn" class="secondary">Test connection</button>
        <button type="submit" id="submit-btn" class="primary" disabled title="Test the connection first">Authorise</button>
      </div>
    </form>
    <p class="footnote">Need help finding credentials? See the <a href="/connect">setup guide</a>. Wrong environment? This server targets Bluestone <strong>${escHtml(envLabel)}</strong>; production credentials will fail on a test deployment.</p>
  </div>
  <script>
    (function () {
      var form = document.getElementById("cred-form");
      var testBtn = document.getElementById("test-btn");
      var submitBtn = document.getElementById("submit-btn");
      var statusEl = document.getElementById("status");
      var secretInput = document.getElementById("mapi_client_secret");
      var toggleSecretBtn = document.getElementById("toggle-secret-btn");
      var fieldIds = ["mapi_client_id", "mapi_client_secret", "papi_key"];
      var verified = false;

      function clearFieldErrors() {
        fieldIds.forEach(function (id) {
          document.getElementById(id).classList.remove("field-error");
        });
      }

      function setFieldErrors(data) {
        clearFieldErrors();
        if (data.mapi) {
          document.getElementById("mapi_client_id").classList.add("field-error");
          document.getElementById("mapi_client_secret").classList.add("field-error");
        }
        if (data.papi) {
          document.getElementById("papi_key").classList.add("field-error");
        }
      }

      function setStatus(message, kind) {
        statusEl.textContent = message;
        statusEl.className = "status " + kind;
      }

      function clearStatus() {
        statusEl.textContent = "";
        statusEl.className = "status hidden";
      }

      function setVerified(value) {
        verified = value;
        submitBtn.disabled = !value;
      }

      function invalidate() {
        setVerified(false);
        clearStatus();
        clearFieldErrors();
      }

      toggleSecretBtn.addEventListener("click", function () {
        var showing = secretInput.type === "text";
        secretInput.type = showing ? "password" : "text";
        toggleSecretBtn.textContent = showing ? "Show" : "Hide";
        toggleSecretBtn.setAttribute("aria-pressed", showing ? "false" : "true");
        toggleSecretBtn.setAttribute("aria-label", (showing ? "Show" : "Hide") + " MAPI Client Secret");
      });

      function readPayload() {
        return {
          csrf_token: form.querySelector('[name="csrf_token"]').value,
          state: form.querySelector('[name="state"]').value,
          code_challenge: form.querySelector('[name="code_challenge"]').value,
          mapi_client_id: document.getElementById("mapi_client_id").value.trim(),
          mapi_client_secret: document.getElementById("mapi_client_secret").value,
          papi_key: document.getElementById("papi_key").value.trim(),
        };
      }

      function formatErrors(data) {
        var parts = [];
        if (data.mapi) parts.push(data.mapi);
        if (data.papi) parts.push(data.papi);
        if (data.error) parts.push(data.error);
        return parts.join(" ");
      }

      ["mapi_client_id", "mapi_client_secret", "papi_key"].forEach(function (id) {
        document.getElementById(id).addEventListener("input", invalidate);
      });

      testBtn.addEventListener("click", function () {
        var payload = readPayload();
        if (!payload.mapi_client_id || !payload.mapi_client_secret || !payload.papi_key) {
          setStatus("Fill in all three credentials before testing.", "error");
          setVerified(false);
          clearFieldErrors();
          if (!payload.mapi_client_id) document.getElementById("mapi_client_id").classList.add("field-error");
          if (!payload.mapi_client_secret) document.getElementById("mapi_client_secret").classList.add("field-error");
          if (!payload.papi_key) document.getElementById("papi_key").classList.add("field-error");
          return;
        }

        testBtn.disabled = true;
        submitBtn.disabled = true;
        clearFieldErrors();
        setStatus("Testing connection...", "pending");

        fetch("/validate-credentials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
          .then(function (res) {
            return res.json().then(function (data) {
              return { ok: res.ok, data: data };
            });
          })
          .then(function (result) {
            if (result.ok && result.data.ok) {
              clearFieldErrors();
              setStatus("Connection verified. You can authorise now.", "success");
              setVerified(true);
              return;
            }
            setFieldErrors(result.data);
            setStatus(formatErrors(result.data) || "Credentials could not be verified.", "error");
            setVerified(false);
          })
          .catch(function () {
            clearFieldErrors();
            setStatus("Could not reach the server. Try again.", "error");
            setVerified(false);
          })
          .finally(function () {
            testBtn.disabled = false;
            if (!verified) submitBtn.disabled = true;
          });
      });

      form.addEventListener("submit", function (event) {
        if (!verified) {
          event.preventDefault();
          setStatus("Test the connection before authorising.", "error");
        }
      });
    })();
  </script>
</body>
</html>`;
}

// ─── Health check ─────────────────────────────────────────────────────────────

app.get("/", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "unofficial-pim-mcp", version: VERSION, info: "Visit /connect for setup instructions and documentation." });
});

// ─── OAuth 2.1 discovery ──────────────────────────────────────────────────────

app.get("/.well-known/oauth-authorization-server", (req: Request, res: Response) => {
  const baseUrl = `https://${req.get("host")}`;
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    grant_types_supported: ["authorization_code"],
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
  });
});

// ─── Protected resource metadata ─────────────────────────────────────────────
//
// RFC 9728: tells MCP clients where to find the authorization server for this
// resource. Cursor and other strictly compliant clients look here before
// attempting dynamic client registration.

app.get("/.well-known/oauth-protected-resource", (req: Request, res: Response) => {
  const baseUrl = `https://${req.get("host")}`;
  res.json({
    resource: baseUrl,
    authorization_servers: [baseUrl],
  });
});

// ─── Dynamic client registration ─────────────────────────────────────────────
//
// RFC 7591: required by Cursor and any other strict OAuth 2.1 client.
//
// Returns a client_id (random 32-char hex) without storing any state.
// Bluestone credentials are unknown at registration time: they are collected
// via the HTML form shown at /authorize for these clients.
//
// TODO (production): persist registrations and enforce client_id at /authorize
// to prevent unregistered clients from bypassing the registration step.

app.post("/register", authRateLimiter, (req: Request, res: Response) => {
  if (!requireSigningSecret(res)) return;

  const { redirect_uris, client_name, grant_types, response_types } = req.body as {
    redirect_uris?: string[];
    client_name?: string;
    grant_types?: string[];
    response_types?: string[];
  };

  if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    res.status(400).json({
      error: "invalid_client_metadata",
      error_description: "redirect_uris is required and must be a non-empty array",
    });
    return;
  }

  res.status(201).json({
    client_id: randomBytes(16).toString("hex"),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris,
    ...(client_name && { client_name }),
    grant_types: grant_types ?? ["authorization_code"],
    response_types: response_types ?? ["code"],
    token_endpoint_auth_method: "client_secret_post",
  });
});

// ─── Authorization endpoint ───────────────────────────────────────────────────
//
// Two flows share this endpoint:
//
// Legacy (Claude Desktop): client_id = "{mapiClientId}:{papiKey}"
//   Credentials are already known → encrypt immediately and redirect. No form.
//
// Dynamic registration (Cursor and other RFC 7591 clients): client_id = opaque ID
//   Credentials are unknown → render an HTML form. The user enters mapiClientId
//   and papiKey; on POST submission those credentials are encrypted into the auth
//   code and the client is redirected in the same way as the legacy flow.
//
// redirect_uri is validated in both flows: must be localhost or HTTPS.
// PKCE (S256) remains the primary protection against code interception.

app.get("/authorize", authRateLimiter, (req: Request, res: Response) => {
  if (!requireSigningSecret(res)) return;

  const { client_id, redirect_uri, state, code_challenge, code_challenge_method } =
    req.query as Record<string, string>;

  if (!client_id || !redirect_uri || !code_challenge) {
    res.status(400).send("Missing required parameters: client_id, redirect_uri, code_challenge");
    return;
  }

  if (!isValidRedirectUri(redirect_uri)) {
    res.status(400).send("redirect_uri must be localhost or an HTTPS URI");
    return;
  }

  if (code_challenge_method !== "S256") {
    res.status(400).send("code_challenge_method=S256 is required");
    return;
  }

  // Legacy flow: credentials encoded directly in client_id as "{mapiClientId}:{papiKey}"
  const parsed = parseClientId(client_id);
  if (parsed) {
    const code = encryptAuthCode({
      mapiClientId: parsed.mapiClientId,
      papiKey: parsed.papiKey,
      codeChallenge: code_challenge,
      exp: Date.now() + AUTH_CODE_TTL_MS,
    });

    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (state) redirectUrl.searchParams.set("state", state);
    res.redirect(redirectUrl.toString());
    return;
  }

  // Dynamic registration flow: show credentials form
  const csrfToken = generateCsrfToken(state ?? "", code_challenge);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    renderCredentialsForm({
      redirectUri: redirect_uri,
      state: state ?? "",
      codeChallenge: code_challenge,
      csrfToken,
    })
  );
});

// ─── Credential validation ────────────────────────────────────────────────────
//
// Probes Bluestone MAPI and PAPI with submitted credentials. Used by the HTML
// connect form before authorisation. Credentials are not stored or logged.

app.post("/validate-credentials", validateRateLimiter, async (req: Request, res: Response) => {
  if (!requireSigningSecret(res)) return;

  const {
    csrf_token,
    state,
    code_challenge,
    mapi_client_id,
    mapi_client_secret,
    papi_key,
  } = req.body as Record<string, string>;

  if (!csrf_token || !code_challenge || !mapi_client_id || !mapi_client_secret || !papi_key) {
    res.status(400).json({ ok: false, error: "Missing required fields." });
    return;
  }

  if (!verifyCsrfToken(csrf_token, state ?? "", code_challenge)) {
    res.status(400).json({
      ok: false,
      error: "Invalid or expired request. Go back and open the connect page again.",
    });
    return;
  }

  const creds: Credentials = {
    mapiClientId: mapi_client_id.trim(),
    mapiClientSecret: mapi_client_secret,
    papiKey: papi_key.trim(),
  };

  const result = await validateCredentials(creds);
  if (result.ok) {
    res.json({ ok: true });
    return;
  }

  res.status(400).json({
    ok: false,
    ...(result.mapi && { mapi: result.mapi }),
    ...(result.papi && { papi: result.papi }),
    ...(result.general && { error: result.general }),
  });
});

// Form submission for the dynamic registration flow.
// Verifies the CSRF token, re-validates credentials against Bluestone, encrypts
// credentials into the auth code, and redirects back to the client.
app.post("/authorize", authRateLimiter, async (req: Request, res: Response) => {
  if (!requireSigningSecret(res)) return;

  const {
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    csrf_token,
    mapi_client_id,
    mapi_client_secret,
    papi_key,
  } = req.body as Record<string, string>;

  const csrfToken = csrf_token ?? "";
  const formParams = {
    redirectUri: redirect_uri ?? "",
    state: state ?? "",
    codeChallenge: code_challenge ?? "",
    csrfToken,
    mapiClientId: mapi_client_id ?? "",
    mapiClientSecret: mapi_client_secret ?? "",
    papiKey: papi_key ?? "",
  };

  const renderFormError = (formError: string, fieldErrors?: { mapi?: string; papi?: string }) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(400).send(
      renderCredentialsForm({
        ...formParams,
        formError,
        fieldErrors,
      })
    );
  };

  if (!redirect_uri || !code_challenge || !csrf_token || !mapi_client_id || !mapi_client_secret || !papi_key) {
    renderFormError("Missing required fields.");
    return;
  }

  if (!isValidRedirectUri(redirect_uri)) {
    renderFormError("redirect_uri must be localhost or an HTTPS URI.");
    return;
  }

  if (code_challenge_method !== "S256") {
    renderFormError("code_challenge_method=S256 is required.");
    return;
  }

  if (!verifyCsrfToken(csrf_token, state ?? "", code_challenge)) {
    renderFormError("Invalid or expired request. Please go back and try again.");
    return;
  }

  const creds: Credentials = {
    mapiClientId: mapi_client_id.trim(),
    mapiClientSecret: mapi_client_secret,
    papiKey: papi_key.trim(),
  };

  const validation = await validateCredentials(creds);
  if (!validation.ok) {
    renderFormError("Credentials could not be verified. Fix the errors below and test again.", {
      mapi: validation.mapi,
      papi: validation.papi,
    });
    return;
  }

  const code = encryptAuthCode({
    mapiClientId: creds.mapiClientId,
    mapiClientSecret: creds.mapiClientSecret,
    papiKey: creds.papiKey,
    codeChallenge: code_challenge,
    exp: Date.now() + AUTH_CODE_TTL_MS,
  });

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (state) redirectUrl.searchParams.set("state", state);
  res.redirect(redirectUrl.toString());
});

// ─── Token endpoint ───────────────────────────────────────────────────────────
//
// Claude Desktop POSTs here with:
//   grant_type    = "authorization_code"
//   code          = the encrypted auth code from /authorize
//   code_verifier = PKCE verifier
//   client_secret = mapiClientSecret (entered in Claude Desktop UI)
//
// We decrypt the auth code, check expiry, verify PKCE, then encrypt all three
// credentials into a Bearer token using AES-256-GCM.

app.post("/token", authRateLimiter, (req: Request, res: Response) => {
  if (!requireSigningSecret(res)) return;

  const { grant_type, code, code_verifier, client_secret } = req.body as Record<string, string>;

  if (grant_type !== "authorization_code") {
    res.status(400).json({ error: "unsupported_grant_type" });
    return;
  }

  if (!code || !code_verifier) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "Missing code or code_verifier",
    });
    return;
  }

  // Decrypt and verify the auth code
  const codePayload = decryptAuthCode(code);
  if (!codePayload) {
    res.status(400).json({ error: "invalid_grant", error_description: "Invalid or tampered auth code" });
    return;
  }

  // Check expiry
  if (Date.now() > codePayload.exp) {
    res.status(400).json({ error: "invalid_grant", error_description: "Authorization code expired" });
    return;
  }

  // Verify PKCE
  if (!verifyPKCE(code_verifier, codePayload.codeChallenge)) {
    res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
    return;
  }

  // MAPI secret: from auth code (dynamic/form flow) or client_secret body param (legacy Claude Desktop flow)
  const mapiClientSecret = codePayload.mapiClientSecret ?? client_secret;
  if (!mapiClientSecret) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "Missing client_secret",
    });
    return;
  }

  // Encrypt all three credentials into the Bearer token using AES-256-GCM
  const creds: Credentials = {
    papiKey: codePayload.papiKey,
    mapiClientId: codePayload.mapiClientId,
    mapiClientSecret,
  };

  res.json({
    access_token: encryptToken(creds),
    token_type: "Bearer",
    expires_in: BEARER_TOKEN_TTL_S,
  });
});

// ─── MCP endpoint ─────────────────────────────────────────────────────────────
//
// app.all is intentional: the MCP SDK's handleRequest needs to handle both
// GET (SSE stream initiation) and POST (JSON-RPC calls) on the same path.

app.all("/mcp", mcpRateLimiter, async (req: Request, res: Response) => {
  if (!requireSigningSecret(res)) return;

  let creds: Credentials | null = null;

  // Primary: encrypted Bearer token from OAuth flow
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    creds = decryptToken(authHeader.substring(7));
  }

  // Fallback: direct headers for development / non-OAuth clients.
  // This bypasses the OAuth flow intentionally: remove if exposing publicly
  // without the OAuth layer.
  if (!creds) {
    const papiKey = req.headers["x-papi-key"] as string | undefined;
    const mapiClientId = req.headers["x-mapi-client-id"] as string | undefined;
    const mapiClientSecret = req.headers["x-mapi-client-secret"] as string | undefined;
    if (papiKey && mapiClientId && mapiClientSecret) {
      creds = { papiKey, mapiClientId, mapiClientSecret };
    }
  }

  if (!creds) {
    res.status(401).json({
      error: "Unauthorized",
      description:
        "Connect via the Claude Desktop connector UI, or provide x-papi-key, x-mapi-client-id, x-mapi-client-secret headers.",
    });
    return;
  }

  const server = createMcpServer(creds);
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
});

export default app;
