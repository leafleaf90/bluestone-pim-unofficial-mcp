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

All MCP tools are registered inside a single `createMcpServer(creds: Credentials)` factory function. This function is imported by both entry points. The tools are:

- `session_init` — must be called first; shows a beta notice to the user
- `list_catalogs` — calls Bluestone PAPI `/categories`
- `list_products_in_category` — calls PAPI `/categories/:id/products?subCategories=true`
- `create_product` — calls Bluestone MAPI `/pim/products` via `mapiPost()`

Two API layers exist:
- **PAPI** (`papiGet`): public read API, authenticated with a static `x-api-key` header
- **MAPI** (`mapiPost`): management write API, authenticated with OAuth 2.0 client credentials (`getBearerToken()`). Tokens are cached in memory per `mapiClientId` and refreshed 60s before expiry.

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

### Adding new tools

Register inside `createMcpServer()` in `src/tools.ts` using `papiGet<T>()` for reads or `mapiPost<T>()` for writes. For other HTTP methods (PATCH, PUT, DELETE), add a helper following the `mapiPost` pattern. See `docs/extending.md` for skeletons.
