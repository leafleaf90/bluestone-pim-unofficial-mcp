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
No local process. The server runs as a serverless function on Vercel. Credentials travel as a Bearer token on every request — nothing is stored server-side.

---

## Model Context Protocol (MCP)

MCP is an open standard from Anthropic that lets Claude use external "tools" — functions that Claude can call to fetch data or perform actions. The protocol is built on [JSON-RPC 2.0](https://www.jsonrpc.org/specification).

Three types of things an MCP server can expose:

| Type | Description | Used here |
|---|---|---|
| **Tools** | Functions Claude can call (with user approval) | Yes |
| **Resources** | File-like data Claude can read | No |
| **Prompts** | Pre-written prompt templates | No |

This server exposes four tools. See [tools.md](tools.md) for details.

---

## Transports

The MCP spec defines two transport mechanisms. This project implements both.

**STDIO (local)**
- Claude Desktop runs `node build/src/index.js` as a child process
- Communication is via JSON-RPC over stdin/stdout
- `console.log()` must never be used — stdout is the JSON-RPC channel. Use `console.error()` (stderr) for logging
- Process is terminated automatically when Claude Desktop quits

**StreamableHTTP (remote)**
- Claude Desktop sends JSON-RPC over HTTPS to the Vercel function
- Each request is stateless — no session, no shared state between requests
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

> This lifecycle applies to local (STDIO) mode only. In remote (Vercel) mode there is no persistent process — each request spins up a serverless function instance independently.

---

## Security model

**Local**
- Credentials live in `.env` and are passed via the `env` block in `claude_desktop_config.json`
- They never appear in source code
- `.env` is excluded from git

**Remote**
- The Vercel deployment is a public HTTPS endpoint, so proper auth is required
- Uses OAuth 2.1 with PKCE — the flow recommended by the MCP spec for remote servers
- Two auth flows are supported depending on the client:

  **Legacy flow (Claude Desktop)** — `client_id` encodes credentials directly as `{mapiClientId}:{papiKey}`:
  1. Claude Desktop opens a browser to `/authorize` with the composite `client_id`, `redirect_uri`, and a PKCE S256 challenge
  2. The server validates `redirect_uri` (must be localhost or HTTPS), extracts credentials from `client_id`, encrypts them into a short-lived AES-256-GCM auth code, and redirects back immediately — no login screen, the payload is opaque in the redirect URL, and `mapiClientSecret` is intentionally absent here so it never travels in the redirect
  3. Claude Desktop POSTs to `/token` with the PKCE verifier and `mapiClientSecret`; the server decrypts the auth code, checks expiry, verifies the PKCE challenge, then encrypts all three credentials into a Bearer token using AES-256-GCM

  **Dynamic registration flow (Cursor and RFC 7591 clients)**:
  1. The client POSTs to `/register` and receives an opaque `client_id` (no credentials yet)
  2. The client opens a browser to `/authorize`; the server detects the opaque `client_id` and renders an HTML form asking for all three Bluestone credentials: `mapiClientId`, `mapiClientSecret`, and PAPI key
  3. A CSRF token (HMAC-SHA256 of `SIGNING_SECRET` + `state` + `code_challenge`) is embedded as a hidden field and verified on POST submission — this prevents a malicious page from tricking a user into submitting the form
  4. On form submit the server validates `redirect_uri`, verifies the CSRF token, encrypts all three credentials into the auth code (AES-256-GCM), and redirects back to the client
  5. The client POSTs to `/token` with the PKCE verifier; the server decrypts the auth code and retrieves the MAPI secret from within it — no `client_secret` body param is required from the client

- That encrypted Bearer token is sent on every subsequent `/mcp` request; the server decrypts it using `SIGNING_SECRET` to recover the credentials and forwards them to the Bluestone APIs
- Bearer tokens contain an expiration timestamp inside the encrypted payload. The server verifies it on every request — a stolen token cannot be used indefinitely, it expires after 59 minutes
- Tokens are bound to their owner via AES-GCM Additional Authenticated Data (AAD) — the user's `mapiClientId` is cryptographically tied to the token, so knowing `SIGNING_SECRET` alone is not enough to bulk-decrypt all tokens
- `SIGNING_SECRET` should be rotated periodically (every 90 days) and immediately if compromised — rotation invalidates all existing tokens and requires users to reconnect once
- Nothing is stored server-side at any point; Vercel function logs show request metadata only, never credential values

**Both modes**
- The server only makes outbound HTTP requests — it does not open ports or listen for connections
- Claude always shows you which tool is being called before it executes (human in the loop)

---

## Production hardening

The current implementation is suitable for a beta/internal deployment. The following items should be addressed before exposing this to untrusted users at scale:

| Area | Current state | What to do |
|---|---|---|
| **redirect_uri validation** | Blocks `javascript:` and `data:` only — custom schemes and plain HTTP are accepted | Enforce an allowlist of registered redirect URIs per client. Store URIs at `/register` time and verify them at `/authorize`. |
| **Client registration persistence** | Stateless — any opaque `client_id` is accepted at `/authorize` | Persist registered clients (e.g. Vercel KV) and reject unregistered `client_id`s at `/authorize`. |
| **Rate limiting** | None | Add rate limiting to `/authorize`, `/token`, and `/register` to prevent enumeration and abuse. |
| **CSP** | `'unsafe-inline'` for styles; no `form-action` restriction (CSRF is handled by HMAC token instead) | Add a per-request nonce to remove `'unsafe-inline'`; re-evaluate `form-action` once routing behaviour is confirmed. |
| **MAPI token cache** | In-memory per Vercel instance (accidental statefulness) | Move to an external cache (e.g. Vercel KV) so tokens survive across cold starts and concurrent instances. |
| **Direct header fallback** | `x-papi-key` / `x-mapi-client-id` / `x-mapi-client-secret` headers bypass OAuth | Remove this fallback, or restrict it to requests from trusted IPs only. |
