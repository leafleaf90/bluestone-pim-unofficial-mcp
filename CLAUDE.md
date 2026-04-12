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

- `list_contexts` — calls MAPI Global Settings `/global-settings/context` via `mapiGet()`
- `list_catalogs` — calls MAPI `/pim/catalogs` via `mapiGet()`. Returns catalog IDs used directly as nodeId in the next tool.
- `list_products_in_category` — three-step recursive listing. Steps 1+2 run in parallel: `POST /search/products/search?archiveState=ACTIVE` with `categoryFilters: [{categoryId, type: "IN_ANY_CHILD"}]` returns `{ data: [{id: string}] }` (objects, not strings — no total field); `POST /search/products/count` with the same filter body returns `{ count: int }` for the accurate total. Step 3: `POST /pim/products/list/views/by-ids?archiveState=ACTIVE` with `views: [{type: "METADATA"}]` resolves IDs to product data. Name is context-keyed (`metadata.name.value[context]`), not a plain string. Also returns `type` and `state` from metadata. Note: the UI uses `POST /pim/products/list/by-ids` (simpler flat response) but that endpoint is not in the official PIM spec — we use `list/views/by-ids` instead.
- `list_published_catalogs` — calls PAPI `/categories` via `papiGet()` (published/live data only)
- `list_published_products_in_category` — calls PAPI `/categories/{id}/products` via `papiGet()` (published/live data only)
- `create_product` — calls MAPI `/pim/products` via `mapiPost()`

Version is defined in `src/version.ts` and imported by both `src/tools.ts` and `api/mcp.ts`. Update it there when bumping.

The beta notice and capability summary are delivered via the `instructions` field on `McpServer` (server-level context, not a tool call). Do not add a `session_init` tool — this was an earlier approach that was replaced.

**MAPI is the default for reads.** Working state data (including unpublished changes) comes from MAPI. PAPI is reserved for the `list_published_*` tools that explicitly return live/synced data only. See `docs/mcp-design.md` for the reasoning.

Three MAPI API families share the same Bearer token and base domain (`api.test.bluestonepim.com`):
- **`/pim`** (`MAPI_PIM_BASE`): products, catalogs, attributes, categories
- **`/search`** (`MAPI_SEARCH_BASE`): full-text and structured product search
- **`/global-settings`** (`MAPI_GLOBAL_SETTINGS_BASE`): contexts (languages/markets)

Two auth methods:
- **PAPI** (`papiGet`): `x-api-key` header (static). Pagination: `itemsOnPage` + `pageNo` (0-indexed doubles).
- **MAPI** (`mapiGet`, `mapiPost`, `mapiPostBody`): `Authorization: Bearer` via OAuth 2.0 client credentials (`getBearerToken()`). Tokens are cached in memory per `mapiClientId` and refreshed 60s before expiry. Pagination: `page` + `pageSize` (0-indexed). `mapiPostBody` is for POST requests that return a JSON body (reads); `mapiPost` is for mutations that return a `resource-id` header. Both `mapiGet` and `mapiPostBody` send `context-fallback: true` on every request so the API returns fallback-language data instead of nulls when a translation is missing.

Both APIs expose 1-indexed `page` to the model — subtract 1 internally before passing to either API.

Most MAPI read endpoints accept a `context` header (language/market, e.g. `"en"`, `"l3600"`). Pass it via `mapiGet(url, creds, { context })`. Default is `"en"`. Call `list_contexts` to enumerate available values.

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

Register inside `createMcpServer()` in `src/tools.ts`:
- Working state reads (GET): `mapiGet<T>(url, creds, { context? })` — use `MAPI_PIM_BASE`, `MAPI_SEARCH_BASE`, or `MAPI_GLOBAL_SETTINGS_BASE` to construct the full URL.
- Working state reads (POST, e.g. search or by-ids): `mapiPostBody<T>(url, body, creds, { context? })` — same URL construction, returns the response body directly.
- Published reads: `papiGet<T>(path, creds)` — only for `list_published_*` tools.
- Mutations: `mapiPost<T>(path, body, creds)` — returns `{ data, resourceId }` where `resourceId` is from the `resource-id` response header. For PATCH/PUT/DELETE, add a helper following the `mapiPost` pattern.

Before adding a tool, read **`docs/mcp-patterns.md`** — it defines the required checklist for descriptions, response format, pagination, error handling, and annotations. See `docs/extending.md` for code skeletons.

Every tool **must** include `annotations` with `readOnlyHint`, `destructiveHint`, and `idempotentHint`. Read tools get `readOnlyHint: true, destructiveHint: false, idempotentHint: true`. Write tools get `readOnlyHint: false, destructiveHint: true, idempotentHint: false`. A tool registered without annotations is incomplete — do not leave this out.

**`docs/mcp-patterns.md` applies to any change in `src/tools.ts`**, not just new tools. When modifying an existing tool's description, response, error handling, or follow-up behaviour, check the relevant pattern sections before and after making the change.

### Connect page: `public/connect/index.html`

The connect page is a single HTML file. Content is written as Markdown in a `<script type="text/plain" id="md">` block and rendered by marked.js at runtime. Three custom tokens are replaced before parsing:

- `[server-url]` — replaced with a styled, copyable URL span (uses a `XXSERVERURLXX` placeholder to survive `marked.parse()`)
- `[prompt: text]` — renders a chat bubble
- `[screenshot: filename.webp]` — renders an `<img>` if the label ends in an image extension, otherwise a placeholder box

Image paths must be **absolute** (`/connect/images/filename.webp`), not relative (`./images/`). Relative paths break on Vercel when the page is served without a trailing slash.

### Copy style

No em dashes anywhere in the connect page, tool descriptions, error messages, or docs. Use a colon or comma instead. Em dashes read as AI-generated.

Never use the contrast construction "X is not just Y — it is Z" or any variation of it ("not merely", "not simply", etc.). This pattern is strongly associated with AI-generated writing. Rewrite as a plain statement instead. For example: "A tool description is documentation that competes with everything else in the model's context window" rather than "A tool description is not just documentation — it is an instruction competing with everything else in the model's context window."
