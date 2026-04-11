# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build           # compile TypeScript → build/
npm run dev             # watch mode (tsc --watch)
npm run vercel-build    # used by Vercel CI: compiles + copies HTML + logo into build/
npm run optimize-images # convert screenshots in public/connect/images/ to WebP (deletes originals)
```

There are no tests. No linter is configured.

To generate a `SIGNING_SECRET` for Vercel:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Architecture

This is a **Model Context Protocol (MCP) server** for Bluestone PIM, with two deployment modes that share the same tool definitions.

### Shared core: `src/tools.ts`

All MCP tools are registered inside a single `createMcpServer(creds: Credentials)` factory function. This function is imported by both entry points. Current tools:

- `list_catalogs` — calls Bluestone PAPI `/categories`
- `list_products_in_category` — calls PAPI `/categories/:id/products?subCategories=true`
- `create_product` — calls Bluestone MAPI `/pim/products` via `mapiPost()`

The beta notice is delivered via the `instructions` field on `McpServer` (server-level context, not a tool call). Do not add a `session_init` tool — this was an earlier approach that was replaced.

Two API layers exist:
- **PAPI** (`papiGet`): public read API, authenticated with a static `x-api-key` header. Pagination: `itemsOnPage` + `pageNo` (0-indexed doubles).
- **MAPI** (`mapiPost`): management write API, authenticated with OAuth 2.0 client credentials (`getBearerToken()`). Tokens are cached in memory per `mapiClientId` and refreshed 60s before expiry. Pagination: `page` + `pageSize`.

The pagination param names differ between the two APIs. Expose 1-indexed `page` to the model in both cases and convert internally.

### Entry point 1: `src/index.ts` — local STDIO mode

Reads `PAPI_KEY`, `MAPI_CLIENT_ID`, `MAPI_CLIENT_SECRET` from `.env`, calls `createMcpServer()`, and connects via `StdioServerTransport`. Used with Claude Desktop configured to run the binary directly.

### Entry point 2: `api/mcp.ts` — Vercel HTTP mode

An Express app that implements a full **OAuth 2.1 authorization server** so MCP clients (Claude Desktop, Cursor) can authenticate end-users without credentials being stored on the server.

Key design decisions:
- **No database.** All state (auth codes, bearer tokens) is encoded as AES-256-GCM encrypted strings. The `SIGNING_SECRET` env var is the only server-side secret.
- **Two auth flows share `/authorize`:** The *legacy* flow (Claude Desktop) encodes `mapiClientId:papiKey` directly in `client_id`. The *dynamic registration* flow (Cursor, RFC 7591 clients) shows an HTML form to collect credentials.
- **Bearer tokens are encrypted credentials.** The `/token` response contains an AES-GCM blob that decrypts back to `{ papiKey, mapiClientId, mapiClientSecret }`. No session store needed.
- **Each `/mcp` request is stateless.** A new `McpServer` instance is created per request; credentials come from the decrypted Bearer token (or fallback `x-papi-key` / `x-mapi-*` headers for dev use).

Vercel routing is in `vercel.json` — all OAuth and MCP paths rewrite to `/api/mcp`.

**Static assets:** Vercel only serves files that exist in `build/`. Any file added to `public/` must also be explicitly copied in the `vercel-build` script in `package.json`, or it will 404 in production. Check the script before adding new public assets.

### Adding new tools

Register inside `createMcpServer()` in `src/tools.ts` using `papiGet<T>()` for reads or `mapiPost<T>()` for writes. For other HTTP methods (PATCH, PUT, DELETE), add a helper following the `mapiPost` pattern.

Before adding a tool, read **`docs/mcp-patterns.md`** — it defines the required checklist for descriptions, response format, pagination, and error handling. See `docs/extending.md` for code skeletons.

**`docs/mcp-patterns.md` applies to any change in `src/tools.ts`**, not just new tools. When modifying an existing tool's description, response, error handling, or follow-up behaviour, check the relevant pattern sections before and after making the change.

### Connect page: `public/connect/index.html`

The connect page is a single HTML file. Content is written as Markdown in a `<script type="text/plain" id="md">` block and rendered by marked.js at runtime. Three custom tokens are replaced before parsing:

- `[server-url]` — replaced with a styled, copyable URL span (uses a `XXSERVERURLXX` placeholder to survive `marked.parse()`)
- `[prompt: text]` — renders a chat bubble
- `[screenshot: filename.webp]` — renders an `<img>` if the label ends in an image extension, otherwise a placeholder box

Image paths must be **absolute** (`/connect/images/filename.webp`), not relative (`./images/`). Relative paths break on Vercel when the page is served without a trailing slash.

### Copy style

No em dashes anywhere — in the connect page, tool descriptions, error messages, or docs. Use a colon or comma instead. Em dashes read as AI-generated.
