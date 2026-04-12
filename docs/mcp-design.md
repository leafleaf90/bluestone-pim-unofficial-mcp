# MCP Design Decisions

This document explains the reasoning behind the design choices in this server. It is a record of decisions already made, not a guide for making new ones. For patterns to follow when adding tools, see [mcp-patterns.md](mcp-patterns.md).

---

## Beta notice via McpServer instructions field

The beta notice and capability summary live in the `instructions` field on `McpServer`, not in a tool call or tool response.

**Path to here:** The first approach prepended the notice to every data tool response via a `betaPrefix()` function sharing an `isFirstToolCall` flag. In Vercel's serverless environment each request creates a fresh `McpServer` instance, so the flag reset unpredictably and the notice fired mid-conversation. This was replaced by a `session_init` tool with a "ALWAYS call this FIRST" description, but that caused its own problem: models called it on every conversation restart, and it added latency. The MCP SDK's `instructions` field delivers server-level context to the model without a round-trip tool call, which is the correct mechanism for this purpose. Do not reintroduce a `session_init` tool.

---

## MAPI as the default for reads

All default read tools (`list_catalogs`, `list_products_in_category`) use MAPI, not PAPI. Separate `list_published_*` tools exist for PAPI reads.

**Why:** The primary users of this MCP are enrichment teams working on product data before it is published. PAPI returns only published/synced data; it cannot show unpublished attributes, draft catalog structures, or newly created products that haven't been synced yet. MAPI returns working state and is what Bluestone's own UI uses for enrichment. Using PAPI for default reads was a fundamental misalignment. The working state vs published distinction is surfaced explicitly in tool names, descriptions, and response summary lines so the model and user always know which they are looking at.

---

## Flat product list in list_products_in_category

MAPI's `/pim/catalogs/nodes/{id}/products` returns a flat list of `{ productId, productName }` with no type field and no variant structure.

**Why this is fine:** The GROUP/VARIANT nesting logic existed in the PAPI version because PAPI returned type and `variantParentId` and the tool tried to reconstruct the hierarchy. MAPI's node-product list is a flat listing: simpler, faster, and avoids the cross-page orphan problem the PAPI nesting logic had to handle. Products that need full detail (including type and attributes) will be fetched individually via `get_product` (planned).

## Catalog IDs as node IDs

`list_products_in_category` takes a `nodeId` parameter. For top-level catalog browsing, the catalog ID from `list_catalogs` is passed directly; the catalog itself is the root node in MAPI's hierarchy. There is no need to fetch a separate node tree first.

If sub-category browsing is needed in future (e.g. listing products only in "Face Care" under "Skincare"), the `/pim/catalogs/{id}/nodes` endpoint returns the full tree with child node IDs. That would be a separate tool or an extension of `list_catalogs`. For now, catalog-level browsing covers the primary use case.

---

## Context (language/market) via request header

MAPI and Search endpoints accept a `context` request header that controls which language/market variant of the data is returned. The default is `"en"`.

**Why a header, not a query param:** This is Bluestone's API design. Context is a routing header, not a filter parameter. The `mapiGet` helper accepts an optional `{ context }` option and forwards it as a header. Tools expose `context` as an optional input parameter so the model can pass it through. The model tracks the active context for the conversation naturally without server-side session state. The `list_contexts` tool provides the vocabulary (context IDs and names) so the model can resolve "switch to Dutch" into the right ID.

---

## Response shaping

Every tool maps the raw Bluestone API response to a smaller, purpose-built object before handing it to the model. Only the fields the model actually needs to complete the task are included.

**Why:** Raw API responses are wide. The PAPI product detail response contains media arrays, attribute definitions, relation lists, bundle lists, variant arrays, category arrays, publish info references, and more. Passing all of this to the model on every list call would flood the context window, increase cost, and make it harder for the model to focus on what matters. Response shaping keeps the payload lean and makes the model's output more predictable.

The pattern also acts as an abstraction layer: the tool decides what to expose, not the API. If the API changes a field name or nesting structure, only the tool changes; the model's view of the data stays stable.

**Image URL decision:** Product media is a clear case of a response shaping trade-off.

- `list_published_products_in_category` includes `imageUrl` (the PAPI `previewUri` for the "Main" media asset) in each product object. This is cheap: the URL is already present in the list response, no extra API call needed. The model can mention or link the URL to the user.
- The URL is not fetched and base64-encoded inline. Doing so for every product in a list would add one HTTP fetch per product, increase response latency and payload size significantly, and expand the context window with binary data.
- For inline image rendering (where the image actually appears in chat), a separate `get_product_image` tool is provided. The model calls it explicitly when the user wants to see a specific product image. One fetch, on demand, for the product the user asked about.

---

## Plain-text summary line before JSON

All read tool responses begin with a human-readable summary ("Found 12 products in Electronics.") before the JSON payload.

**Why:** Models receiving only JSON often paste it verbatim into chat. The summary line already states the key facts, so the model paraphrases rather than dumps. The JSON remains present for the model to query when the user asks for specifics on a particular item.

---

## Plain-text-only responses for mutations

Write operations (create, update, delete) return a simple confirmation string rather than a JSON object.

**Why:** There is no structured data for the model to reason over after a mutation. A `{ success: true, message: "..." }` wrapper adds no value and increases the chance the model renders it as a code block in chat. A plain string like `Product "X" created. ID: abc123` is sufficient.

---

## Behavior quirks

Edge cases in model behavior discovered through testing. These are not code bugs; they are places where the model's tool selection goes wrong and the fix is a combination of description guards and user-side prompting.

### Code and HTTP bypass

When Claude has code execution or artifact creation available alongside the MCP, it occasionally reasons "I can fetch this via HTTP" and attempts a direct Bluestone API call using bash or an artifact. This fails because the credentials only exist inside the MCP tool execution context.

**Mitigations applied:**

1. The `instructions` field on `McpServer` includes an explicit block: "Do not attempt to fetch Bluestone data using HTTP, bash, code artifacts, or any other method. Credentials are only available inside the tool execution context."
2. The `list_catalogs` description includes a one-line guard: "Do not attempt to fetch catalog data via HTTP, bash, or code."

**Why these are not complete fixes:** Server instructions compete with the model's broader priors. A conversation opened in Code mode, or a system prompt that emphasizes code-first problem solving, can override the MCP instructions. The model's tool selection is probabilistic. The most reliable mitigation is user-side prompting: "Using Bluestone PIM, show me my catalogs" associates the request with the MCP explicitly, while "show me my catalogs" leaves the model to infer the source.

### Web search bypass for product images

Observed in testing: the user said "show the image" after receiving a product list. The model had web search available, matched the request to web search, fetched generic stock photos, then self-corrected and called `get_product_image`. The tool worked correctly in the end, but only after a wasted round-trip.

The cause is ambiguity: "show the image" is a strong web search prior. The model has the `imageUrl` from the product list in context, but without a source reference it does not reliably connect the request to the MCP tool.

**Mitigations applied:**

1. `McpServer` instructions: "Do not search the web for Bluestone product images. When the user asks to see a product image, call `get_product_image` with the `imageUrl` from the product list."
2. `list_published_products_in_category` description: "When the user asks to see a product image, call `get_product_image` with that imageUrl. Do not search the web." This fires in context, at the point where the model has just received the product list and an image request is most likely.
3. `get_product_image` description: "Do not search the web for product images. Do not use the imageUrl as a markdown image link. Always call this tool."
4. User-side prompting advice on the connect page: phrase image requests as "show me the product image from Bluestone PIM" rather than just "show the image".

**Why the `list_published_products_in_category` guard is the strongest:** By the time the user asks for an image, the model has already received that tool's result with `imageUrl` in hand. An instruction in that description fires at exactly the right moment in context, not at startup when the model first reads all descriptions.

---

## Stateless bearer tokens (no session store)

The Vercel HTTP deployment has no database. Bearer tokens issued at `/token` are AES-256-GCM encrypted blobs containing the user's Bluestone credentials directly, not references to stored sessions.

**Why:** Vercel serverless functions have no persistent memory between invocations. The alternatives (a database or Redis) add infrastructure for a personal/beta project. Encoding state in the token itself means the server only needs the `SIGNING_SECRET` env var to verify and decrypt. Nothing is stored.

The trade-off: token revocation is not possible. A token is valid until it expires. Acceptable at this scale.

---

## Two OAuth flows on a single /authorize endpoint

Claude Desktop and RFC 7591-compliant clients (Cursor, VS Code, ChatGPT) both hit `/authorize`, but they go through different flows.

**Why:** Claude Desktop predates dynamic client registration. It encodes `mapiClientId:papiKey` directly in the `client_id` field and skips the browser form entirely. Newer clients register first at `/register`, then open `/authorize` in a browser where the user enters Bluestone credentials. A single endpoint handles both by inspecting the `client_id` format: if it contains `:`, it is the legacy flow; otherwise it is the dynamic registration flow that renders the HTML form.

---

## Pagination

All list tools expose `limit` and `page` (1-indexed) to the model. The two APIs have different internal param names and indexing; the tools convert internally.

| API | Internal params | Indexing | Default page size |
|---|---|---|---|
| PAPI | `itemsOnPage` + `pageNo` | 0-indexed | set by caller |
| MAPI node products | `page` + `pageSize` | 0-indexed | 1000 |

MAPI's large default (1000) means most category node listings fit in a single call. The `list_products_in_category` tool still accepts a `limit` param to keep responses bounded and avoid flooding the model's context window.

MAPI's node products endpoint does not return `totalCount`. `hasMore` is inferred: if the returned count equals the requested page size, there may be more. PAPI responses include `totalCount`, so `totalPages` can be computed exactly for `list_published_products_in_category`.
