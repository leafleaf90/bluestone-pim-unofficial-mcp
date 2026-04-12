# Client Compatibility

This page documents which AI clients are expected to work with this MCP server, and any known limitations per client.

The server exposes two modes:

- **Remote (HTTP):** Streamable HTTP at `/mcp`, protected by OAuth 2.1 + PKCE, with dynamic client registration (RFC 7591) and protected resource metadata (RFC 9728). Deployed on Vercel.
- **Local (STDIO):** For Claude Desktop only. Credentials go in `.env`; no OAuth involved.

---

## Confirmed working

These clients have been tested directly with this server.

| Client | Mode | Notes |
|---|---|---|
| **Claude Desktop** | STDIO (local) and HTTP (remote) | STDIO is the simplest setup. Remote HTTP uses the legacy `clientId:papiKey` flow; no browser form needed. |
| **Cursor** | HTTP (remote) | Uses dynamic client registration. Browser form collects all three credentials on first connect. |

---

## Expected to work

Based on published documentation and spec compliance. Not tested directly against this server.

| Client | Mode | Notes |
|---|---|---|
| **Claude.ai (web)** | HTTP (remote) | Supports remote MCP via Settings → Connectors on paid plans. Cannot run STDIO. Free users limited to one custom connector. |
| **ChatGPT** | HTTP (remote) | Supported in ChatGPT's connector/developer mode. Uses dynamic client registration and browser OAuth flow. Availability may depend on plan. |
| **VS Code + GitHub Copilot** | HTTP (remote) | Full OAuth 2.1 + PKCE support. Configure via `.vscode/mcp.json`. Considered the most spec-compliant client as of early 2026. |
| **Windsurf (Codeium)** | HTTP (remote) | MCP support via the Cascade system. Configure in `~/.codeium/windsurf/mcp_config.json`. Streamable HTTP adoption is newer; SSE was the earlier transport. |
| **Zed** | HTTP (remote) | OAuth support present but still maturing. Configure via Agent Panel settings. |

---

## Partial or limited

| Client | Limitation |
|---|---|
| **Claude mobile (iOS/Android)** | Remote HTTP only (no STDIO). Cannot configure new servers from the app itself: servers must be added first via claude.ai on desktop, then they appear on mobile. Works once configured. |
| **Goose (Block)** | OAuth flow re-triggers on every new chat session, which is disruptive. RFC 9728 compliance was added in late 2025 but production readiness is unclear. Usable but rough. |
| **Continue (VS Code/JetBrains extension)** | Streamable HTTP support is newer. STDIO and SSE are the more established modes. Worth testing but not guaranteed. |

---

## Not applicable

| Client | Reason |
|---|---|
| Any STDIO-only client | Remote deployment on Vercel cannot be reached via STDIO. Local STDIO mode requires running the compiled binary directly, which is only practical for developers. |

---

## Desktop vs web vs mobile summary

| Platform | Can use remote HTTP | Can use local STDIO | Can configure servers |
|---|---|---|---|
| Desktop (Claude Desktop, Cursor, VS Code, Windsurf, Zed) | Yes | Yes (where supported) | Yes |
| Web (Claude.ai, ChatGPT web) | Yes | No | Yes |
| Mobile (Claude iOS/Android) | Yes (once configured elsewhere) | No | No, must configure via web first |

---

## Notes on the OAuth flows

Two flows are supported at `/authorize`:

**Legacy flow (Claude Desktop):** The client encodes `mapiClientId` and `papiKey` directly in the `client_id` field as `mapiClientId:papiKey`. The `mapiClientSecret` is supplied separately at the token step. No browser form is shown.

**Dynamic registration flow (Cursor, ChatGPT, VS Code, etc.):** The client registers first at `/register`, then opens `/authorize` in a browser. A form collects all three Bluestone credentials. This is the standard RFC 7591 + RFC 9728 path.

Clients that strictly follow the MCP OAuth 2.1 spec (dynamic registration, protected resource metadata discovery) will use the second flow automatically.

---

*Last updated: April 2026. MCP client support is evolving quickly; verify against each client's current documentation before assuming compatibility.*
