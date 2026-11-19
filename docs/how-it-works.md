# How it works

## The big picture

There are two ways the server can run:

**Local (STDIO)**
```
You (typing in Claude Desktop)
        │
        ▼
   Claude (the LLM)
        │
        ▼
   MCP Server  ←── Claude Desktop spawned this as a child process
   (build/src/index.js)
        │
        ▼
   Bluestone PAPI / MAPI
        │
        ▼
   MCP Server formats result → Claude replies to you
```
There is no running terminal, no web server, no port. Claude Desktop manages the process entirely.

**Remote (Vercel)**
```
You (typing in Claude Desktop)
        │
        ▼
   Claude (the LLM)
        │
        ▼
   Claude Desktop  ──── HTTPS + Bearer token ────▶  Vercel Function
                                                     (api/mcp.ts)
                                                          │
                                                          ▼
                                                   Bluestone PAPI / MAPI
                                                          │
                                                          ▼
                                                   Response → Claude → you
```
No local process. The server runs as a serverless function on Vercel. Credentials travel as a Bearer token on every request. By default nothing is stored server-side. An optional shared store (Upstash Redis) adds refresh tokens and revocation, and keeps an encrypted refresh record for up to 30 days.

---

## Model Context Protocol (MCP)

MCP is an open standard from Anthropic that lets Claude use external "tools": functions that Claude can call to fetch data or perform actions. The protocol is built on [JSON-RPC 2.0](https://www.jsonrpc.org/specification).

Three types of things an MCP server can expose:

| Type | Description | Used here |
|---|---|---|
| **Tools** | Functions Claude can call (with user approval) | Yes |
| **Resources** | File-like data Claude can read | No |
| **Prompts** | Pre-written prompt templates | No |

This server exposes seven tools. See [tools.md](tools.md) for details.

---

## Transports

The MCP spec defines two transport mechanisms. This project implements both.

**STDIO (local)**
- Claude Desktop runs `node build/src/index.js` as a child process
- Communication is via JSON-RPC over stdin/stdout
- `console.log()` must never be used: stdout is the JSON-RPC channel. Use `console.error()` (stderr) for logging
- Process is terminated automatically when Claude Desktop quits

**StreamableHTTP (remote)**
- Claude Desktop sends JSON-RPC over HTTPS to the Vercel function
- No persistent storage: credentials come from the encrypted Bearer token on every request, and a new `McpServer` instance is created per request. MAPI OAuth tokens are cached in memory on warm instances but nothing is written to disk and there is no shared state between instances.
- Auth uses OAuth 2.1 with PKCE (see [setup-developer.md](setup-developer.md) for the credential flow)

---

## Request/response flow

### Local (STDIO)

When you ask "show me the catalogs" with a local setup:

1. **You type** a message in Claude Desktop
2. **Claude reads** the list of available tools from the MCP server (this happened at startup via a `tools/list` JSON-RPC call)
3. **Claude decides** to call `list_catalogs` based on your message and the tool's description
4. **Claude Desktop prompts you** to approve the tool call (the first time, or if you have approval required)
5. **Claude Desktop sends** a `tools/call` JSON-RPC message to the MCP server's stdin:
   ```json
   { "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "list_catalogs", "arguments": {} } }
   ```
6. **The MCP server** calls `https://api.test.bluestonepim.com/v1/categories` with the API key
7. **Bluestone returns** JSON
8. **The MCP server** formats the response and writes it back to stdout:
   ```json
   { "jsonrpc": "2.0", "id": 1, "result": { "content": [{ "type": "text", "text": "..." }] } }
   ```
9. **Claude receives** the data and composes a human-readable reply

### Remote (Vercel)

The same flow, but transport and auth differ:

1. **You type** a message in Claude Desktop
2. **Claude decides** to call `list_catalogs`
3. **Claude Desktop sends** a POST request to `https://your-vercel-deployment.vercel.app/mcp` with the encrypted Bearer token in the `Authorization` header
4. **The Vercel function** decrypts the Bearer token using `SIGNING_SECRET` to recover the three Bluestone credentials
5. **The function** calls `https://api.test.bluestonepim.com/v1/categories` with the API key
6. **Bluestone returns** JSON
7. **The function** streams the JSON-RPC response back to Claude Desktop over HTTPS
8. **Claude receives** the data and composes a human-readable reply

---

## Process lifecycle

```
Claude Desktop starts
        │
        ├── reads claude_desktop_config.json
        ├── for each mcpServers entry:
        │       runs the command as a child process
        │       sends tools/list → receives tool definitions
        │
        │  [you use Claude normally]
        │
        ├── on each tool call: sends tools/call to the child process
        │
Claude Desktop quits
        └── child processes are terminated
```

The server does not need to be started manually. It has no persistent state between Claude sessions.

> This lifecycle applies to local (STDIO) mode only. In remote (Vercel) mode there is no persistent process; each request spins up a serverless function instance independently.

---

## Security model

**Local**
- Credentials live in `.env` and are passed via the `env` block in `claude_desktop_config.json`
- They never appear in source code
- `.env` is excluded from git

**Remote**
- The Vercel deployment is a public HTTPS endpoint, so proper auth is required
- Uses OAuth 2.1 with PKCE, the flow recommended by the MCP spec for remote servers
- Two auth flows are supported depending on the client:

  **Legacy flow (Claude Desktop):** `client_id` encodes credentials directly as `{mapiClientId}:{papiKey}`:
  1. Claude Desktop opens a browser to `/authorize` with the composite `client_id`, `redirect_uri`, and a PKCE S256 challenge
  2. The server checks `redirect_uri` against the allowlist, extracts credentials from `client_id`, encrypts them into a short-lived single-use AES-256-GCM auth code, and redirects back immediately; no login screen appears, and `mapiClientSecret` is intentionally absent here so it never travels in the redirect
  3. Claude Desktop POSTs to `/token` with the PKCE verifier, the same `redirect_uri` and `client_id`, and `mapiClientSecret`; the server decrypts the auth code, checks expiry and binding, verifies the PKCE challenge, validates the secret against Bluestone, then seals all three credentials into a Bearer token using AES-256-GCM

  **Dynamic registration flow (Cursor and RFC 7591 clients)**:
  1. The client POSTs to `/register` and receives an opaque `client_id` (no credentials yet)
  2. The client opens a browser to `/authorize`; the server detects the opaque `client_id` and renders an HTML form asking for all three Bluestone credentials: `mapiClientId`, `mapiClientSecret`, and PAPI key
  3. A CSRF token (HMAC over a random cookie nonce, client, redirect URI, `state`, `code_challenge`, and an expiry) is embedded as a hidden field and must arrive together with the cookie; this prevents a malicious page from tricking a user into submitting the form
  4. On form submit the server validates `redirect_uri`, verifies the CSRF token, checks the credentials against Bluestone, encrypts them into the auth code (AES-256-GCM), and redirects back to the client. A per-client-ID failure counter blocks guessing of a secret from many IPs
  5. The client POSTs to `/token` with the PKCE verifier, `redirect_uri`, and `client_id`; the server decrypts the auth code and retrieves the MAPI secret from within it; no `client_secret` body param is required from the client

- That encrypted Bearer token is sent on every subsequent `/mcp` request; the server decrypts it using `SIGNING_SECRET` to recover the credentials and forwards them to the Bluestone APIs
- Bearer tokens contain an expiration timestamp, an audience (`/mcp` of this server), and an optional read-only claim inside the encrypted payload. The server verifies them on every request; access tokens expire after 59 minutes
- Sealed values use per-purpose HKDF subkeys with a key id and purpose-bound AAD, so a value for one purpose cannot be reused as another
- `SIGNING_SECRET` should be rotated every 90 days with `SIGNING_SECRET_PREVIOUS` for a smooth hand-over, and immediately if compromised (`TOKEN_NOT_BEFORE` cuts off everything issued earlier)
- Without the optional shared store nothing is stored server-side. With it, rotating refresh tokens are kept as encrypted records for up to 30 days, reuse of a refresh token revokes its whole family, and `/revoke` ends a connection on demand
- Security events are logged as JSON lines with allowlisted fields only; credential values, tokens, and codes are never logged

**Both modes**
- The server only makes outbound HTTP requests; it does not open ports or listen for connections
- Claude always shows you which tool is being called before it executes (human in the loop)

---

## Production hardening

The current implementation is suitable for a beta/internal deployment. The following items should be addressed before exposing this to untrusted users at scale:

| Area | Current state | What to do |
|---|---|---|
| **redirect_uri validation** | Exact callback URIs of Claude, ChatGPT, VS Code, and Cursor plus loopback are accepted. Auth codes are bound to the redirect URI and client, and are single use. | Add other clients with `REDIRECT_URI_ALLOWLIST` (exact URIs). Avoid `REDIRECT_URI_HOST_ALLOWLIST` unless you trust every path on the host. |
| **Client registration** | Stateless but signed: `/register` returns an HMAC-signed `client_id` that embeds the redirect URIs. `/authorize` verifies the signature and requires an exact `redirect_uri` match. The form shows where the token will be sent. Registration itself is open. | Persist registrations (e.g. Vercel KV) if you need revocation or per-client policy. Rotating `SIGNING_SECRET` invalidates registered `client_id`s, so clients must register again. |
| **Rate limiting** | `/mcp` at 60 req/min per IP, auth endpoints at 20 req/min per IP, credential validation at 10 req/min, plus 10 failed credential checks per MAPI client ID per 15 minutes. Counters use the shared store when configured and memory otherwise. | Configure the Upstash store (and `REQUIRE_SHARED_STORE=true`) on shared deployments so limits hold across instances. |
| **CSP** | The credentials form has a per-request nonce CSP with `default-src 'none'` and `form-action` limited to self and the redirect target. | Check new browsers when changing the form. |
| **Origin validation** | `/mcp` rejects browser requests whose Origin is not on the allowlist. Native clients send no Origin. | Extend with `MCP_ALLOWED_ORIGINS` for web-based MCP clients. |
| **Write confirmation** | Five bulk or schema tools return a preview and a signed `confirmationToken` first, or ask the client through elicitation when the transport is stateful. | Keep `MCP_READ_ONLY=true` where writes are not needed. The token flow forces a visible preview step but cannot prove a human read it. |
| **MAPI token cache** | In-memory per Vercel instance, keyed by a hash of client ID and secret, capped at 200 entries | Move to an external cache (e.g. Vercel KV) so tokens survive across cold starts and concurrent instances. |
| **Direct header fallback** | Off by default. `ALLOW_HEADER_AUTH=true` enables `x-papi-key` / `x-mapi-client-id` / `x-mapi-client-secret` headers, which bypass OAuth. | Leave it off in any shared deployment. Use it only for local development. |
| **Read-only mode** | `MCP_READ_ONLY=true` skips every tool with `readOnlyHint: false`. | Enable it for deployments where write access is not needed. It limits the damage a prompt-injected instruction in PIM content can do. |
| **Image fetching** | `get_product_image` fetches only https URLs on `bluestonepim.com` hosts, with no redirects, a 15 s timeout, a 5 MB cap, and an image content type. | Add other media hosts with `IMAGE_HOST_ALLOWLIST` (comma-separated domain suffixes). |
| **Path parameters** | Every ID placed in an API path is validated (`[A-Za-z0-9_-]`, max 128) and encoded by `seg()` in `src/safe-path.ts`. | Use `seg()` for any new tool that builds a path from user or model input. |
