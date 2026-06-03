# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build           # compile TypeScript → build/
npm run dev             # watch mode (tsc --watch)
npm run vercel-build    # used by Vercel CI: compiles + copies HTML + logo into build/
npm run optimize-images # convert screenshots in public/connect/images/ to WebP (deletes originals)
cd public && python3 -m http.server 8080  # preview connect page at localhost:8080/connect/
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

- `list_contexts`: calls MAPI Global Settings `/global-settings/context` via `mapiGet()`
- `list_catalogs`: calls MAPI `/pim/catalogs` via `mapiGet()`. Returns catalog IDs used directly as nodeId in the next tool.
- `list_category_tree`: calls MAPI `/pim/catalogs/{catalogId}/nodes` via `mapiGet()`. Returns a flattened working-state category tree with `path`, `depth`, and IDs for onboarding and product placement decisions.
- `list_attribute_definitions`: calls MAPI `/pim/definitions` via `mapiGet()`. Uses server-side pagination when browsing without text filters; fetches all API pages when search, group, or dataType filters are used. Returns shaped attribute definition metadata for browsing and mapping. Enum values are truncated by default.
- `get_attribute_definition`: calls MAPI `GET /pim/definitions/{definitionId}` via `mapiGet()`. Returns full detail for one attribute definition, including all enum values by default.
- `list_dictionary_values`: calls MAPI `POST /pim/definitions/dictionary/{dictionaryId}/values/list` and `/values/count` via `mapiPostBody()`. Lists allowed values for a dictionary attribute with context-aware labels.
- `get_dictionary_value`: calls MAPI `GET /pim/definitions/dictionary/{dictionaryId}/values/{valueId}` via `mapiGet()`. Returns one dictionary value with its label.
- `list_products_in_category`: three-step recursive listing. Steps 1+2 run in parallel: `POST /search/products/search?archiveState=ACTIVE` with `categoryFilters: [{categoryId, type: "IN_ANY_CHILD"}]` returns `{ data: [{id: string}] }` (objects, not strings: no total field); `POST /search/products/count` with the same filter body returns `{ count: int }` for the accurate total. Step 3: `POST /pim/products/list/views/by-ids?archiveState=ACTIVE` with `views: [{type: "METADATA"}]` resolves IDs to product data. Name is context-keyed (`metadata.name.value[context]`), not a plain string. Also returns `type` and `state` from metadata. Note: the UI uses `POST /pim/products/list/by-ids` (simpler flat response) but that endpoint is not in the official PIM spec: we use `list/views/by-ids` instead.
- `search_products`: compiles semantic filters to query-builder `MainQueryGroup` terms, then `POST /query-builder/products/search?archiveState=ACTIVE` and `/products/count` in parallel, then resolves IDs via `list/views/by-ids`. Supports category scope, completeness score range, and failing requirement IDs. Phase 1 only: no attribute, label, relation, or asset filters yet.
- `list_published_catalogs`: calls PAPI `/categories` via `papiGet()` (published/live data only)
- `list_published_products_in_category`: calls PAPI `/categories/{id}/products` via `papiGet()` (published/live data only). Includes `imageUrl` (the `previewUri` for the "Main" media asset) on each product when present.
- `get_product_image`: fetches a product image from Bluestone's CDN using the `imageUrl` from `list_published_products_in_category` and returns it as a base64 `image` content block for inline rendering in chat. Call only when the user explicitly asks to see an image, not automatically for every product in a list.
- `create_attribute_definition`: calls MAPI `/pim/definitions` via `mapiPost()` to create an attribute definition with `name`, `dataType`, optional `unit`, and initial `enumValues` for `single_select`/`multi_select`. Select attributes require initial enum values because Bluestone rejects them without enum restrictions. Returns the `resource-id` header as the new definition ID. Does not create dictionary values, validation restrictions, groups, category nodes, or product attribute values.
- `create_dictionary_value`: calls MAPI `/pim/definitions/dictionary/{dictionaryId}/values` via `mapiPost()` to create a value for a dictionary attribute. Returns the `resource-id` header as the value ID for later `set_product_attribute` calls.
- `append_select_attribute_values`: calls MAPI `/pim/definitions/{definitionId}?validation=NAME` via `mapiPut()` after first reading the full definition. Preserves existing definition fields and enum values, then appends new `single_select` or `multi_select` values.
- `create_category_node`: calls MAPI `/pim/catalogs/nodes?validation=NAME` via `mapiPost()` to create a root-level category node or child node under `parentId`. Returns the `resource-id` header as the new node ID.
- `create_product`: calls MAPI `/pim/products` via `mapiPost()`. Supports `name`, optional `number`, optional `type` (`SINGLE`, `GROUP`, or `BUNDLE`), and optional category assignment after creation. Number is the unique product key for create-only onboarding and duplicate number conflicts return the existing product ID when Bluestone provides it.
- `set_variant_level_attribute`: calls MAPI `PUT /pim/products/{groupId}/variants/attributes/{definitionId}` via `mapiPut()`. Configures VLA flags on a variant group, including variant-defining attributes (`copy`, `definingAttributes`, `locked`, `mandatory`).
- `generate_variant_matrix`: orchestrates GROUP creation or reuse, assigns dimensions to the group with empty values, VLA configuration, SINGLE creation for each cartesian combination, attribute values on each variant, and bulk variant assignment via `append/by-ids`. Accepts attribute names and value labels; resolves definition and value IDs internally (falls back to GET by definitionId when not in the paginated list). Optional `createMissingAttributes` (with per-dimension `dataType`) and `createMissingValues`. On miss without create flags, errors include up to three nearest name suggestions. Max 500 combinations per call.
- `append_variants_to_group`: calls MAPI `POST /pim/products/variants/append/by-ids` via `mapiPost()`. Assigns up to 100 SINGLE product IDs per request; batches automatically when more IDs are passed.
- `set_product_attribute`: calls MAPI `/pim/products/{productId}/attributes` via `mapiPost()` to add an attribute value to a product. Values are always strings; select and multi-select values must be enum value IDs from `list_attribute_definitions`.
- `get_product`: calls MAPI `/pim/products/{productId}` via `mapiGetFull()` with `accept: application/full+json`. Returns metadata, raw attribute IDs/values, category IDs, asset IDs, relations, bundles, and variant information.
- `list_product_completeness_scores`: calls MAPI `/completeness-score/scores/list` via `mapiPostBody()`. Returns completeness scores (0 to 100) per product and context for known product IDs. Optional context filter; omit to return all contexts. Not for catalog-wide score filtering.
- `get_product_completeness_detail`: calls MAPI `GET /completeness-score/scores/{productId}/{context}` via `mapiGet()`, then `POST /completeness-score/requirements/list` and `GET /pim/definitions/{id}` to resolve requirement names. Returns score plus per-requirement PASSED/FAILED breakdown with human-readable labels.
- `list_category_level_attributes`: calls MAPI `GET /pim/catalogs/nodes/{id}/attributes` via `mapiGet()`. Returns CLAs on one category with propagate, lock, and mandatory flags and resolved attribute names.
- `list_column_setups`: calls UI settings `GET /columnsSetups/all` via `mapiGet()`. Lists product list column setups (`service` bluestone-pim, `entity` PRODUCT) with resolved column labels.
- `propose_column_setup`: read-only builder from category CLAs or attribute names/IDs. Always leads with status, name, and score columns; returns `columnsForApi` for create.
- `create_column_setup`: calls UI settings `POST /columnsSetups/all` via `mapiPost()`. Creates a column setup for a given owner email after user confirmation.
- `list_categories_with_cla`: calls MAPI `GET /pim/catalogs/nodes/attributeDefinition/{definitionId}` via `mapiGet()`. Reverse lookup of categories using an attribute as a CLA.
- `list_variant_level_attributes`: reads a GROUP product via `mapiGetFull()`, then probes `GET /pim/products/{groupId}/variants/attributes/{definitionId}` per attribute (paginated, max 50 per call). Lists VLAs with copy, locked, mandatory, and variant-defining flags.
- `get_variant_level_attribute`: calls MAPI `GET /pim/products/{groupId}/variants/attributes/{definitionId}` via `mapiGetOptional()`. Returns VLA flags for one attribute on a variant group.
- `get_product_validation_issues`: calls `GET /completeness-score/validations/{productId}/{context}` via `mapiGet()`. Returns sync validation issues with CLA and VLA types resolved to attribute names.
- `list_product_validation_issues`: calls `POST /completeness-score/validations/by-ids` via `mapiPostBody()`. Bulk validation issues for up to 100 product IDs in one context.
- `suggest_variant_group_candidates`: uses MAPI Search `typesFilter` plus full product reads to suggest SINGLE products that may belong in an existing GROUP. Read-only; does not attach variants.
- `assign_product_to_category`: calls MAPI `/pim/catalogs/nodes/{categoryId}/products` via `mapiPost()` to assign an existing product to a catalog category.
- `update_product_name`: calls MAPI `/pim/products/{productId}` via `mapiPatch()` to rename an existing product.

Version is defined in `src/version.ts` and imported by both `src/tools.ts` and `api/mcp.ts`. Update it there when bumping.

Product state values from the API (e.g. `PLAYGROUND_ONLY`) are mapped to UI labels (e.g. `Draft`) via `mapProductState()` in `src/tools.ts`. Add new mappings there as they are discovered.

The beta notice and capability summary are delivered via the `instructions` field on `McpServer` (server-level context, not a tool call). Do not add a `session_init` tool: this was an earlier approach that was replaced.

**MAPI is the default for reads.** Working state data (including unpublished changes) comes from MAPI. PAPI is reserved for the `list_published_*` tools that explicitly return live/synced data only. See `docs/mcp-design.md` for the reasoning.

MAPI is Bluestone's working-state API (everything that is not PAPI). These path prefixes share the same Bearer token and base domain (test: `api.test.bluestonepim.com`, production: `api.bluestonepim.com` when `ENVIRONMENT=production`):
- **`/pim`** (`MAPI_PIM_BASE`): products, catalogs, attributes, categories
- **`/search`** (`MAPI_SEARCH_BASE`): full-text and structured product search
- **`/global-settings`** (`MAPI_GLOBAL_SETTINGS_BASE`): contexts (languages/markets)
- **`/completeness-score`** (`MAPI_COMPLETENESS_SCORE_BASE`): product completeness scores and sync validation issues
- **`/query-builder`** (`MAPI_QUERY_BUILDER_BASE`): structured product search with filter trees

Two auth methods:
- **PAPI** (`papiGet`): `x-api-key` header (static). Pagination: `itemsOnPage` + `pageNo` (0-indexed doubles).
- **MAPI** (`mapiGet`, `mapiPost`, `mapiPostBody`): `Authorization: Bearer` via OAuth 2.0 client credentials (`getBearerToken()`). Tokens are cached in memory per `mapiClientId` and refreshed 60s before expiry. Pagination: `page` + `pageSize` (0-indexed). `mapiPostBody` is for POST requests that return a JSON body (reads); `mapiPost` is for mutations that return a `resource-id` header. Both `mapiGet` and `mapiPostBody` send `context-fallback: true` on every request so the API returns fallback-language data instead of nulls when a translation is missing.

Both APIs expose 1-indexed `page` to the model: subtract 1 internally before passing to either API.

Most MAPI read endpoints accept a `context` header (language/market, e.g. `"en"`, `"l3600"`). Pass it via `mapiGet(url, creds, { context })`. Default is `"en"`. Call `list_contexts` to enumerate available values.

### Entry point 1: `src/index.ts`: local STDIO mode

Reads `PAPI_KEY`, `MAPI_CLIENT_ID`, `MAPI_CLIENT_SECRET` from `.env`, calls `createMcpServer()`, and connects via `StdioServerTransport`. Used with Claude Desktop configured to run the binary directly.

### Entry point 2: `api/mcp.ts`: Vercel HTTP mode

An Express app that implements a full **OAuth 2.1 authorization server** so MCP clients (Claude Desktop, Cursor) can authenticate end-users without credentials being stored on the server.

Key design decisions:
- **No database.** All state (auth codes, bearer tokens) is encoded as AES-256-GCM encrypted strings. The `SIGNING_SECRET` env var is the only server-side secret.
- **Two auth flows share `/authorize`:** The *legacy* flow (Claude Desktop) encodes `mapiClientId:papiKey` directly in `client_id`. The *dynamic registration* flow (Cursor, RFC 7591 clients) shows an HTML form to collect credentials.
- **Bearer tokens are encrypted credentials.** The `/token` response contains an AES-GCM blob that decrypts back to `{ papiKey, mapiClientId, mapiClientSecret }`. No session store needed.
- **Each `/mcp` request creates a new `McpServer` instance.** Credentials come from the decrypted Bearer token (or fallback `x-papi-key` / `x-mapi-*` headers for dev use). There is no persistent storage, but Vercel reuses warm instances so in-memory state (notably the MAPI token cache in `getBearerToken()`) can survive across requests on the same instance.

Vercel routing is in `vercel.json`: all OAuth and MCP paths rewrite to `/api/mcp`.

**Static assets:** Vercel only serves files that exist in `build/`. Any file added to `public/` must also be explicitly copied in the `vercel-build` script in `package.json`, or it will 404 in production. Check the script before adding new public assets.

### Adding new tools

Register inside `createMcpServer()` in `src/tools.ts`:
- Working state reads (GET): `mapiGet<T>(url, creds, { context? })`: use `MAPI_PIM_BASE`, `MAPI_SEARCH_BASE`, or `MAPI_GLOBAL_SETTINGS_BASE` to construct the full URL.
- Working state reads (POST, e.g. search or by-ids): `mapiPostBody<T>(url, body, creds, { context? })`: same URL construction, returns the response body directly.
- Published reads: `papiGet<T>(path, creds)`: only for `list_published_*` tools.
- Mutations: `mapiPost<T>(path, body, creds)`: returns `{ data, resourceId }` where `resourceId` is from the `resource-id` response header. For PATCH/PUT/DELETE, add a helper following the `mapiPost` pattern.

Before adding a tool, read **`docs/mcp-patterns.md`**: it defines the required checklist for descriptions, response format, pagination, error handling, and annotations. See `docs/extending.md` for code skeletons.

Every tool **must** include `annotations` with `readOnlyHint`, `destructiveHint`, and `idempotentHint`. Read tools get `readOnlyHint: true, destructiveHint: false, idempotentHint: true`. Write tools get `readOnlyHint: false, destructiveHint: true, idempotentHint: false`. A tool registered without annotations is incomplete: do not leave this out.

**`docs/mcp-patterns.md` applies to any change in `src/tools.ts`**, including edits to existing tools. When modifying an existing tool's description, response, error handling, or follow-up behaviour, check the relevant pattern sections before and after making the change.

### Connect page: `public/connect/index.html`

The connect page is a single HTML file. Content is written as Markdown in a `<script type="text/plain" id="md">` block and rendered by marked.js at runtime. Three custom tokens are replaced before parsing:

- `[server-url]`: replaced with a styled, copyable URL span (uses a `XXSERVERURLXX` placeholder to survive `marked.parse()`)
- `[prompt: text]`: renders a chat bubble
- `[screenshot: filename.webp]`: renders an `<img>` if the label ends in an image extension, otherwise a placeholder box

Image paths must be **absolute** (`/connect/images/filename.webp`), not relative (`./images/`). Relative paths break on Vercel when the page is served without a trailing slash.

The page has a "Copy page as Markdown" dropdown button injected after the "MCP is the natural evolution of this" paragraph. The copy output is built by `buildCopyContent()` in the inline script: it takes the raw `#md` source, replaces `[server-url]` with the actual MCP URL, then splices in a serialized version of the `EXAMPLES` array right before the `## FAQ` section. This means **the `EXAMPLES` array feeds two things**: the rendered chat mockups on the page, and the Markdown copy output. When you add, remove, or edit an example, both are updated automatically.

## Workflows

### "Check copy" (`/check-copy`)

Scan all modified files (per `git diff --name-only`) for copy style violations. Report each violation with file, line number, and the offending text. Do not auto-fix. List findings and wait for instruction.

Violations to check:
- Em dash characters anywhere in `.ts`, `.html`, `.md` files
- AI-filler contrast constructions that pair a negated minimizer with a stronger restatement
- Trailing AI-filler summary paragraphs

If no violations are found, say so clearly. This check is also run automatically as part of "Prepare git push".

---

### "Add example" (`/add-example`)

Use when adding a new example conversation to the Examples section of `public/connect/index.html`.

1. **Clarify** with the user: what is the scenario, what tools are called, is there a screenshot, what should the notes cover?
2. **Read the existing examples** in the `EXAMPLES` array in `index.html` to understand the data structure before writing anything.
3. **Turn types** available in `renderTurns()`:
   - `{ type: 'user', text }`: user message bubble
   - `{ type: 'user-with-file', text, fileName, fileType }`: user message bubble with an attached file card above it
   - `{ type: 'reply', text }`: Claude reply (supports inline HTML)
   - `{ type: 'tool', name, display }`: tool call row
   - `{ type: 'tool-with-image', name, display, imageSrc, imageAlt }`: tool call with image preview (use for `get_product_image`)
   - `{ type: 'form', pairs: [{q, a}] }`: form response bubble
4. **Optional fields** on the example object: `screenshot` (`{ src, caption }`), `notes` (array of HTML strings), `missing` (array of HTML strings for "What's missing" block).
5. **Image paths** must be absolute (`/connect/images/filename.webp`), not relative.
6. **Notes and missing text** support inline HTML. No em dashes.
7. Run `/check-copy` on the file after editing.
8. If the example demonstrates a new tool, check that `docs/recent-updates.md` has the corresponding entry.

---

### "Update tool description" (`/update-tool-description`)

Use when changing a tool description, response text, follow-up behaviour, or error message in `src/tools.ts`.

1. **Read the current description** for the tool being changed.
2. **Read the relevant sections of `docs/mcp-patterns.md`**: description checklist, response format, error handling, and follow-up behaviour sections all apply.
3. **Read `docs/mcp-design.md`** if the change involves a behavior quirk or a design decision that has prior context.
4. Make the edit.
5. Verify annotations are still correct for the tool type (read vs mutation).
6. Run `/check-copy` on the changed file.
7. If the change affects what users can expect from the tool, consider whether `docs/tools.md` needs updating too.

---

### "Add tool" (`/add-tool`)

Use when adding a new MCP tool to `src/tools.ts`. Follow these steps in order:

1. **Read the patterns doc** (`docs/mcp-patterns.md`) before writing anything.
2. **Clarify** with the user: what does the tool do, which API endpoint, MAPI or PAPI, read or mutation?
3. **Register** inside `createMcpServer()` using the appropriate helper (`mapiGet`, `mapiPostBody`, `papiGet`, or `mapiPost`). See the Adding new tools section below for URL construction.
4. **Description:** write it per `docs/mcp-patterns.md`. No em dashes. Include failure mode guidance for non-obvious failures.
5. **Zod schema:** type all inputs. Use `.describe()` on every parameter.
6. **Annotations:** every tool must have `readOnlyHint`, `destructiveHint`, `idempotentHint`. Read tools: `true, false, true`. Write tools: `false, true, false`.
7. **Response:** shape the output: only fields the model needs. Start with a plain-text summary line before any JSON.
8. **Error handling:** surface meaningful messages. Check existing `papiErrorMessage` / `mapiErrorMessage` helpers cover the new tool's failure cases.
9. **Update CLAUDE.md:** add the tool to the tools list in the Shared core section.
10. **Update McpServer instructions:** if the tool changes what the server can do, update the capability summary in the `instructions` field.
11. **Run `/check-copy`** on the changes before finishing.
12. **Consider `docs/recent-updates.md`:** does this tool deserve a "New" badge entry on the connect page?
13. **Update the Claude Code workflows section** in the connect page (`#fork-and-extend`) if the new tool changes what a fork can do out of the box.

---

### "Add slash command" (`/add-slash-command`)

Use when defining a new workflow in this Workflows section.

1. Write the workflow definition here in CLAUDE.md following the format of the existing workflows: name in backticks, numbered steps, no em dashes.
2. Add the new command to the Claude Code workflows list in the "Fork and extend" section of `public/connect/index.html`, one line, name and one-sentence description.
3. Run `/check-copy` on both files.

---

### "Prepare git push"

When the user says "Prepare git push", run the following steps in order:

**Step 1: Recent updates review**

Run `git log --oneline` to identify commits since the hash stored in `memory/last_push.md`. Read `public/connect/index.html` to see the current "Recent updates" entries. For each commit since the last push, assess whether the change is user-facing enough to deserve a spot (new capability, meaningful behavior change, important clarification). Exclude internal refactors, visual fixes, and changes users would never notice.

If any current entry should be replaced or a new one added, list the proposed changes and the reasoning, and wait for the user to approve before editing the file. Check `docs/recent-updates.md` for badge type guidance.

**Step 2: Commit message**

Produce a single-line `git commit -m` command, ready to copy and paste, with no line breaks. Scan it for em dashes before surfacing it. Em dashes are forbidden in all copy including commit messages.

**Step 3: Em dash check**

Run `/check-copy` on all modified files. Report any found. Do not proceed past this step if any are present.

**Step 4: Update memory**

After the user confirms the commit message, write `memory/last_push.md` with the commit hash (from `git rev-parse HEAD` after the commit) and a one-paragraph plain-English summary of what was included. This is what you read at the start of Step 1 on the next invocation.

### Copy style

No em dashes anywhere in the connect page, tool descriptions, error messages, or docs. Use a colon or comma instead. Em dashes read as AI-generated.

Avoid AI-filler contrast constructions that pair a negated minimizer with a stronger restatement. This pattern is strongly associated with AI-generated writing. Rewrite as a plain statement instead. For example: "A tool description is documentation that competes with everything else in the model's context window."
