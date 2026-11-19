// Cryptographic helpers for the OAuth layer.
//
// - One master secret (SIGNING_SECRET) is expanded with HKDF into independent
//   subkeys per purpose ("code", "token", "refresh", "csrf", "client", ...). A
//   value sealed for one purpose cannot be opened or forged as another.
// - Every sealed value and signature carries a short key id (kid). During
//   rotation set SIGNING_SECRET to the new value and SIGNING_SECRET_PREVIOUS to
//   the old one (comma-separated for more than one). New values are always
//   produced with the current secret; older ones still verify until the
//   previous secret is removed.
// - Sealed format: "v2.{kid}.{iv}.{tag}.{ciphertext}" (base64url). The AAD binds
//   the purpose, so it is authenticated but not secret. Nothing identifying a
//   user is placed in plaintext.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "crypto";

export const MIN_SECRET_LENGTH = 32;

interface Secret {
  kid: string;
  value: string;
}

let ringCacheKey = "";
let ringCache: Secret[] = [];
const subkeyCache = new Map<string, Buffer>();

function kidFor(value: string): string {
  return createHash("sha256").update(`kid:${value}`).digest("base64url").slice(0, 8);
}

function keyring(): Secret[] {
  const current = process.env.SIGNING_SECRET ?? "";
  const previous = process.env.SIGNING_SECRET_PREVIOUS ?? "";
  const cacheKey = `${current}|${previous}`;
  if (cacheKey === ringCacheKey) return ringCache;
  const values = [current, ...previous.split(",").map((s) => s.trim())].filter(Boolean);
  ringCache = values.map((value) => ({ kid: kidFor(value), value }));
  ringCacheKey = cacheKey;
  subkeyCache.clear();
  return ringCache;
}

/** Returns a human-readable problem with the configured secret, or null when it is usable. */
export function signingSecretProblem(): string | null {
  const ring = keyring();
  if (ring.length === 0 || !process.env.SIGNING_SECRET) {
    return "SIGNING_SECRET environment variable is not set.";
  }
  if (process.env.SIGNING_SECRET.length < MIN_SECRET_LENGTH) {
    return `SIGNING_SECRET must be at least ${MIN_SECRET_LENGTH} characters. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;
  }
  return null;
}

export function currentKid(): string {
  return keyring()[0]?.kid ?? "";
}

function subkey(purpose: string, secret: Secret): Buffer {
  const cacheKey = `${secret.kid}:${purpose}`;
  let key = subkeyCache.get(cacheKey);
  if (!key) {
    key = Buffer.from(
      hkdfSync("sha256", secret.value, "bluestone-mcp-salt-v2", `bluestone-mcp:${purpose}`, 32)
    );
    subkeyCache.set(cacheKey, key);
  }
  return key;
}

function secretByKid(kid: string): Secret | undefined {
  return keyring().find((s) => s.kid === kid);
}

function aad(purpose: string): Buffer {
  return Buffer.from(`bluestone-mcp:v2:${purpose}`, "utf8");
}

export function seal(purpose: string, payload: object): string {
  const secret = keyring()[0];
  if (!secret) throw new Error("SIGNING_SECRET is not set.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subkey(purpose, secret), iv);
  cipher.setAAD(aad(purpose));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2.${secret.kid}.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function unseal<T>(purpose: string, value: unknown): T | null {
  // Request bodies are untrusted JSON: a non-string must fail closed, not throw.
  if (typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 5 || parts[0] !== "v2") return null;
  const secret = secretByKid(parts[1]);
  if (!secret) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      subkey(purpose, secret),
      Buffer.from(parts[2], "base64url")
    );
    decipher.setAAD(aad(purpose));
    decipher.setAuthTag(Buffer.from(parts[3], "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parts[4], "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as T;
  } catch {
    return null;
  }
}

/** HMAC-SHA256 signature of `data`, returned as "{kid}.{mac}". */
export function sign(purpose: string, data: string): string {
  const secret = keyring()[0];
  if (!secret) throw new Error("SIGNING_SECRET is not set.");
  const mac = createHmac("sha256", subkey(`hmac:${purpose}`, secret)).update(data).digest("base64url");
  return `${secret.kid}.${mac}`;
}

export function verifySignature(purpose: string, data: unknown, signature: unknown): boolean {
  if (typeof data !== "string" || typeof signature !== "string") return false;
  const dot = signature.indexOf(".");
  if (dot < 1) return false;
  const secret = secretByKid(signature.slice(0, dot));
  if (!secret) return false;
  const expected = createHmac("sha256", subkey(`hmac:${purpose}`, secret)).update(data).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature.slice(dot + 1), "base64url");
  } catch {
    return false;
  }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function randomId(bytes = 16): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
