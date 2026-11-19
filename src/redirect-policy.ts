// Redirect URI policy for the OAuth layer.
//
// Dynamic client registration is open, so the redirect target is the thing that
// decides who receives an auth code. The default policy therefore pins exact
// vendor callback URIs instead of whole hosts: an open redirect on an allowed
// host would otherwise leak codes.
//
// Always allowed (RFC 8252 loopback): http or https on localhost, 127.0.0.1 or
// [::1], any port and path. Loopback is how Claude Code, VS Code and Cursor
// desktop receive callbacks.
//
// Allowed by default (documented callbacks, checked against vendor docs):
//   Claude hosted apps  https://claude.ai/api/mcp/auth_callback
//                       https://claude.com/api/mcp/auth_callback
//   ChatGPT             https://chatgpt.com/connector_platform_oauth_redirect
//                       https://chatgpt.com/connector/oauth/*  (per-connection)
//   VS Code             https://vscode.dev/redirect
//                       https://insiders.vscode.dev/redirect
//   Cursor              cursor://anysphere.cursor-mcp/oauth/callback
//                       https://www.cursor.com/agents/mcp/oauth/callback
//
// Operator settings:
//   REDIRECT_URI_ALLOWLIST      Comma-separated extra URIs. A trailing * makes the
//                               entry a prefix match, otherwise the match is exact.
//   REDIRECT_URI_HOST_ALLOWLIST Comma-separated extra https hosts (any path).
//                               The single value "*" turns the allowlist off: any
//                               https URI is accepted, plus custom schemes named in
//                               EXTRA_REDIRECT_SCHEMES. Not recommended for shared
//                               deployments.
//   EXTRA_REDIRECT_SCHEMES      Only used when the allowlist is off.
//
// Userinfo and fragments are always rejected. So is anything the URL parser would
// silently rewrite into a different target: backslashes, control characters or
// spaces, dot segments (`..`, `.`), and percent-encoded dots, slashes or
// backslashes in the path. Matching is done on the parsed URL, not on the raw
// string, so `https://host/allowed/../elsewhere` cannot ride on a prefix entry.

const DEFAULT_ALLOWED: string[] = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://chatgpt.com/connector/oauth/*",
  "https://vscode.dev/redirect",
  "https://insiders.vscode.dev/redirect",
  "cursor://anysphere.cursor-mcp/oauth/callback",
  "https://www.cursor.com/agents/mcp/oauth/callback",
];

function list(env: NodeJS.ProcessEnv, name: string, lower = false): string[] {
  return (env[name] ?? "")
    .split(",")
    .map((s) => (lower ? s.trim().toLowerCase() : s.trim()))
    .filter(Boolean);
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

// Characters a URL parser treats as separators or strips: the raw string and the
// parsed URL would then describe different targets.
const CONFUSING_CHARS = /[\\\u0000-\u0020\u007f]/;
const ENCODED_PATH_TRICKS = /%(2e|2f|5c|00)/i;

/** Raw path of a hierarchical URI, before the parser normalises it. */
function rawPath(uri: string): string {
  const match = uri.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/);
  return match ? match[1] : "";
}

function hasUnsafeShape(uri: string): boolean {
  if (CONFUSING_CHARS.test(uri)) return true;
  const path = rawPath(uri);
  if (ENCODED_PATH_TRICKS.test(path)) return true;
  return path.split("/").some((segment) => segment === ".." || segment === ".");
}

function matchesEntry(uri: string, url: URL, entry: string): boolean {
  if (entry.endsWith("*")) {
    const prefix = entry.slice(0, -1);
    if (!url.href.startsWith(prefix)) return false;
    // `https://app.example.com*` must not match `https://app.example.com.evil.test`.
    if (url.protocol === "http:" || url.protocol === "https:") {
      try {
        if (new URL(prefix).origin !== url.origin) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  return uri === entry;
}

export function isAllowedRedirectUri(uri: string, env: NodeJS.ProcessEnv = process.env): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (hasUnsafeShape(uri)) return false;

  if ((url.protocol === "http:" || url.protocol === "https:") && isLoopbackHost(url.hostname)) {
    return true;
  }
  if (url.protocol === "http:") return false;

  const entries = [...DEFAULT_ALLOWED, ...list(env, "REDIRECT_URI_ALLOWLIST")];
  if (entries.some((entry) => matchesEntry(uri, url, entry))) return true;

  const hosts = list(env, "REDIRECT_URI_HOST_ALLOWLIST", true);
  if (url.protocol === "https:") {
    if (hosts.includes("*")) return true;
    return hosts.includes(url.hostname.toLowerCase());
  }

  if (hosts.includes("*")) {
    const scheme = url.protocol.replace(/:$/, "").toLowerCase();
    return list(env, "EXTRA_REDIRECT_SCHEMES", true).includes(scheme);
  }
  return false;
}

export const REDIRECT_REJECTION_HINT =
  "This redirect URI is not on the allowlist. Known MCP clients (Claude, ChatGPT, Cursor, VS Code, and loopback clients) are allowed by default. " +
  "A server admin can add others with REDIRECT_URI_ALLOWLIST (exact URIs) or REDIRECT_URI_HOST_ALLOWLIST (https hosts).";

/** Scheme and host of the redirect target, shown to the user on the consent form. */
export function describeRedirectDestination(uri: string): string {
  try {
    const url = new URL(uri);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "an unknown destination";
  }
}

/** CSP form-action source for the redirect target. */
export function formActionSource(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol === "http:" || url.protocol === "https:") return `${url.protocol}//${url.host}`;
    return `${url.protocol}`;
  } catch {
    return null;
  }
}
