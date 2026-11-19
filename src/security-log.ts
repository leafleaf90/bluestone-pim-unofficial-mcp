// Structured security event logging.
//
// One JSON line per event on stdout, so Vercel log drains can filter on
// `"type":"security"`. Only an allowlist of field names is ever written, values
// are length-capped and stripped of control characters, and anything that could
// carry a secret (tokens, codes, secrets, keys, query strings) has no field name
// that passes the filter. Client IDs are logged as short hashes.

import { createHash } from "crypto";

const ALLOWED_FIELDS = new Set([
  "reason",
  "path",
  "method",
  "status",
  "ip",
  "clientName",
  "redirectHost",
  "originHost",
  "clientHash",
  "storeKind",
  "operation",
  "flow",
  "count",
]);

function clean(value: unknown): string | number | boolean {
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 120);
}

/** Short stable hash for correlating events about one client ID without logging it. */
export function hashForLog(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/** Host part of a URL-like string, or "invalid". Never logs path or query. */
export function hostForLog(value: string | undefined): string {
  if (!value) return "none";
  try {
    return new URL(value).host || new URL(value).protocol;
  } catch {
    return "invalid";
  }
}

export type SecurityEvent =
  | "registration"
  | "redirect_rejected"
  | "unknown_client"
  | "credential_validation_failed"
  | "throttled"
  | "auth_code_reuse"
  | "auth_code_binding_mismatch"
  | "refresh_reuse"
  | "refresh_revoked"
  | "origin_rejected"
  | "invalid_token"
  | "legacy_flow_used"
  | "store_degraded"
  | "write_confirmation_required"
  | "write_confirmation_failed";

export function logSecurityEvent(event: SecurityEvent, fields: Record<string, unknown> = {}): void {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (ALLOWED_FIELDS.has(key) && value !== undefined && value !== null) {
      safe[key] = clean(value);
    }
  }
  console.log(JSON.stringify({ type: "security", event, time: new Date().toISOString(), ...safe }));
}
