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
| **ChatGPT** | HTTP (remote) | Custom MCP in Developer mode on chatgpt.com. **Read vs write depends on plan** (see [ChatGPT: read vs write by plan](#chatgpt-read-vs-write-by-plan)). Uses dynamic client registration and browser OAuth flow. |
| **VS Code + GitHub Copilot** | HTTP (remote) | Full OAuth 2.1 + PKCE support. Configure via `.vscode/mcp.json`. Considered the most spec-compliant client as of early 2026. |
| **Windsurf (Codeium)** | HTTP (remote) | MCP support via the Cascade system. Configure in `~/.codeium/windsurf/mcp_config.json`. Streamable HTTP adoption is newer; SSE was the earlier transport. |
| **Zed** | HTTP (remote) | OAuth support present but still maturing. Configure via Agent Panel settings. |

---

## ChatGPT: read vs write by plan

ChatGPT can connect to this server in **Developer mode** on the web app at [chatgpt.com](https://chatgpt.com). Custom MCP connectors must be added from the web UI, not the desktop client. Once added, the connector is available in desktop chats too.

OpenAI separates **tool discovery** from **tool execution** on personal plans. ChatGPT may list every tool this server exposes, including write tools such as `generate_variant_matrix`, `create_product`, and `set_product_attribute`. Whether a tool can actually run depends on your ChatGPT plan and workspace settings.

This is enforced by ChatGPT on the client side. If a write tool is blocked, **`tools/call` never reaches this server**, so Vercel logs will not show a failed mutation for that attempt. Reads working while writes never execute is the typical symptom of a read-only MCP plan, not a connector outage.

Official reference: [Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta) (OpenAI Help Center, updated regularly).

### Plan summary

| Plan | Custom MCP reads | Custom MCP writes |
|---|---|---|
| **Free** | Not available. Developer mode and custom MCP connectors require Plus or above. | Not available |
| **Plus and Pro** | Yes. Tools with `readOnlyHint: true` run normally (`list_catalogs`, `get_product`, `search_products`, and other read tools). | **No.** Write tools appear in the tool list but ChatGPT cannot invoke them. The model may describe the payload or say the tool is not available for execution. |
| **Business, Enterprise, Edu** | Yes | Yes, after workspace admin setup. Writes show approval cards before execution. Admins can enable or disable specific actions per app. |

OpenAI's FAQ states that Pro users can connect MCPs with **read/fetch permissions** in developer mode, and that **full MCP including modify/write actions** is available to Business and Enterprise/Edu workspaces. We treat Plus the same as Pro for custom MCP writes based on observed behavior and third-party testing guides; verify against OpenAI's current docs if your plan tier changes.

### Which tools are affected

Every tool in this server declares MCP annotations. ChatGPT uses these hints when deciding what can run on a read-only plan:

- **Read tools** (`readOnlyHint: true`): browsing, search, completeness, validation reads, published catalog reads, product images, variant suggestions, and similar.
- **Write tools** (`readOnlyHint: false`): product and attribute creation, variant matrix generation, category assignment, enum append, dictionary values, VLA configuration, and other mutations.

On Plus or Pro, assume **all write tools are blocked**, even if the model confirms your request in chat.

### How to tell if plan gating is the cause

1. Ask: **"Using my Bluestone PIM connector, list my catalogs."** If `list_catalogs` runs and returns your org data, the connector and OAuth path are working.
2. Ask the model to call a write tool explicitly, for example: **"Call generate_variant_matrix now with …"**
3. Interpret the result:
   - **Read works, write never shows an approval card and never executes:** expected on Plus/Pro. Use Cursor, Claude Desktop, or a Business workspace for writes.
   - **Approval card appears but the call fails:** likely a connector, credentials, or server issue. Check Vercel logs and MAPI permissions.
   - **Model describes the tool payload without calling it:** often plan gating on Plus/Pro, but can also be prompting. Name the connector, start a new chat after connecting, and ask it to call the tool by name.

### Alternatives for write operations

| Goal | Option |
|---|---|
| Personal account, full read/write | **Cursor** or **Claude Desktop** (both tested with this server) |
| Writes inside ChatGPT | **Business, Enterprise, or Edu** workspace with Developer mode enabled by an admin |
| Programmatic writes from your own code | OpenAI Responses API / Agents SDK with MCP (separate from ChatGPT chat plan limits) |

Setup steps and troubleshooting for ChatGPT are on the [connect page](https://bluestone-mcp-unofficial.vercel.app/connect#chatgpt).

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

*Last updated: June 2026. MCP client support is evolving quickly; verify against each client's current documentation before assuming compatibility.*
