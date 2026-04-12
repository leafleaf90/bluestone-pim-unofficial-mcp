# Bluestone API Quick Reference

A scannable reference for adding new tools. For detailed request/response shapes on endpoints already implemented, see [api.md](api.md).

## All available API specs

| Component | Spec URL | MCP potential |
|---|---|---|
| **Public API (PAPI)** | https://docs.api.test.bluestonepim.com/openapi/page.json | Already in use — read-only product/category/attribute data |
| **PIM (MAPI)** | https://docs.api.test.bluestonepim.com/openapi/pim.json | Already in use — full CRUD for products, categories, attributes |
| **Search** | https://docs.api.test.bluestonepim.com/openapi/search.json | High — likely best backend for a `search_products` tool |
| **Completeness score** | https://docs.api.test.bluestonepim.com/openapi/completeness-score.json | High — "which products are incomplete?" is a natural AI question |
| **History** | https://docs.api.test.bluestonepim.com/openapi/history.json | Medium — "what changed on this product / who last updated it?" |
| **Labels** | https://docs.api.test.bluestonepim.com/openapi/labels.json | Medium — add/remove labels; useful for workflow/approval flows |
| **Tasks** | https://docs.api.test.bluestonepim.com/openapi/tasks.json | Medium — if workflow tasks, AI could list or create them |
| **Query builder** | https://docs.api.test.bluestonepim.com/openapi/query-builder.json | Medium — structured attribute-based filtering; complex but powerful |
| **Media bank** | https://docs.api.test.bluestonepim.com/openapi/media-bank.json | Low-medium — asset management; useful once product writes are solid. Note: `previewUri` from product responses is already public (`?f=jpg&w=400`) and passed through in tool responses so Claude can render thumbnails inline. |
| **Metadata** | https://docs.api.test.bluestonepim.com/openapi/metadata.json | Low — internal metadata, unlikely to be user-facing |
| **Global settings** | https://docs.api.test.bluestonepim.com/openapi/global-settings.json | Low — admin config, not a conversational use case |
| **Sync / Public API sync** | https://docs.api.test.bluestonepim.com/openapi/public-api-sync.json | Low — publish pipeline internals |
| **External notifications** | https://docs.api.test.bluestonepim.com/openapi/external-notifications.json | Low — webhook/event config |
| **IDP** | https://docs.api.test.bluestonepim.com/openapi/idp.json | Not applicable — identity provider, already handled by OAuth flow |
| **UI settings** | https://docs.api.test.bluestonepim.com/openapi/ui-settings.json | Not applicable — frontend configuration |

---

## Two auth methods, one base domain

Base domain: `https://api.test.bluestonepim.com`

| | PAPI (Page API) | MAPI family (PIM, Search, Global Settings) |
|---|---|---|
| Base paths | `/v1` | `/pim`, `/search`, `/global-settings` |
| Auth | `x-api-key` header (static) | `Authorization: Bearer <token>` (OAuth2 client credentials) |
| Access | Read-only, published data | Full CRUD, working state |
| Token URL | n/a | `https://idp.test.bluestonepim.com/op/token` |
| Helper in tools.ts | `papiGet()` | `mapiPost()` + `mapiGet()` (to add) + `getBearerToken()` |

Define one `API_BASE` constant and named constants per base path (`MAPI_BASE`, `SEARCH_BASE`, `GLOBAL_SETTINGS_BASE`). Pass full URLs to helpers. This makes production environment support a one-line change.

---

## Pagination — different params per API

**PAPI:** `itemsOnPage` + `pageNo` (doubles, **0-indexed**)
```
?itemsOnPage=50&pageNo=0   ← first page
?itemsOnPage=50&pageNo=1   ← second page
```
Expose as 1-indexed to the model; subtract 1 before passing to Bluestone.

**MAPI `/pim/catalogs/nodes/{id}/products`:** `page` + `pageSize` (integers, **0-indexed**, default pageSize 1000)
```
?page=0&pageSize=100   ← first page
?page=1&pageSize=100   ← second page
```
Expose as 1-indexed to the model; subtract 1 before passing. Default of 1000 means most node listings fit in one call.

**Search API `/search/products/search` and `/search/find`:** `page` + `pageSize` (0-indexed, max pageSize 100 for structured search, 1000 for full-text `find`)

`POST /search/products/search` returns `{ data: [{ id: string }] }` — objects, not plain strings, and **no total field**. Fetch the total separately via `POST /search/products/count` with the same filter body (returns `{ count: int }`). Run both in parallel.

---

## Common parameters

| Parameter | Type | Where | Meaning |
|---|---|---|---|
| `context` | **header** | MAPI + Search | Language/market context. Default `"en"`. Custom context IDs start with lowercase `"l"` (not digit `"1"`) followed by a number, e.g. `"l3600"`. Use `GET /global-settings/context` (Bearer auth) to list available values. Pass as `context: <value>` request header. |
| `context-fallback` | **header** | MAPI + Search | Send `"true"` on every MAPI/Search request. When a product has no translation for the requested context, the API returns the fallback language's value instead of null/empty. All `mapiGet` and `mapiPostBody` helpers send this by default. |
| `archiveState` | query param | MAPI | `ACTIVE` (default), `ARCHIVED`, or `ALL` |
| `subCategories` | query param | PAPI `/categories/{id}/products` | `true` to include nested subcategories — always use this |

The `context` header should be exposed as an optional parameter on any tool that reads language-sensitive data (product names, attribute values, descriptions). When omitted, Bluestone defaults to `"en"`.

---

## Product types

| Type | Meaning |
|---|---|
| `GROUP` | Parent product. Has variants listed under it. Response includes `variants: [id, ...]` |
| `VARIANT` | Child of a GROUP. Has `variantParentId` pointing to its parent. |
| `SINGLE` | Standalone product with no variants. |

Variants should always be displayed nested under their parent GROUP, never as top-level items.

## Product states

| API value | UI label | Meaning |
|---|---|---|
| `PLAYGROUND_ONLY` | Draft | Created and edited in working state, not yet synced/published |

Other state values are not yet confirmed. The `mapProductState()` function in `src/tools.ts` maps known API values to their UI labels before returning them to the model. Add new mappings there as they are discovered. Unknown values are passed through as-is.

## General Information fields (native product fields)

These are system fields present on every product, independent of how a user has configured their column setup. Available in the METADATA view of `list/views/by-ids`:

| Field | Type | Notes |
|---|---|---|
| `name` | context-keyed object | `{ value: { en: "...", nl: "..." } }` — extract the requested context key |
| `number` | string | Product SKU / item number |
| `type` | string | `SINGLE`, `GROUP`, or `VARIANT` |
| `state` | string | `PLAYGROUND_ONLY` (Draft), others TBD |
| `archived` | boolean | Whether the product is archived |
| `lastUpdate` | epoch ms | Last modification timestamp |
| `createDate` | epoch ms | Creation timestamp |

These are distinct from **Attributes**, which are custom per-organisation and require a separate definitions fetch to resolve IDs to human-readable names.

---

## Attribute types

Bluestone has four attribute types, each with its own create/update endpoint:

| Type | Notes |
|---|---|
| `simple` | Plain text, number, date, boolean |
| `dictionary` | Predefined list of values; values live at `/definitions/dictionary/{id}/values` |
| `column` | Table/matrix of values |
| `matrix` | Multi-dimensional values |
| `compound` | A group of sub-definitions; see `/compoundDefinitions` |

When setting attributes via MAPI, the endpoint varies by type (e.g. `/products/{id}/attributes/dictionary` vs `/products/{id}/attributes`). Always check the type before choosing the endpoint.

---

## Search endpoints

Base URL: `https://api.test.bluestonepim.com/search`. Same Bearer token auth as MAPI.

| Method | Path | Notes |
|---|---|---|
| GET | `/find` | Full-text search across product name, description, number, attributes. Params: `query`, `searchableFields`, `fuzziness` (ZERO/ONE/TWO/AUTO), `highlight`, `fragmentSize`, `page`, `pageSize` (max 1000). Returns `{ data: [string], total: int }`. |
| POST | `/products/search` | Structured search with rich filters: `typeFilter`, `categoryFilters`, `attributeFilters`, `publishStateFilter`, `validationStatusFilter`, date filters, score filters. `pageSize` max 100. **Returns `{ data: [{ id: string }] }` — objects with id, no total.** Pair with `/products/count` for totals. |
| POST | `/products/scroll/search` | Same as above but scroll-based pagination via `scrollId` — better for large result sets. |
| POST | `/products/count` | Count products matching a filter set. Same filter body as `/products/search`, no pagination params needed. Returns `{ count: int }`. Run in parallel with the search call. |
| POST | `/assets/search` | Search assets. Filters: name, products, categories, labels, media type, dimensions, file size. `resultsPerPage` max 100. |
| POST | `/assets/cursor` | Cursor-based asset search — better for streaming large asset lists. |
| POST | `/assets/count` | Count assets matching filters. |

**Key decision:** Use `GET /find` for the `search_products` tool (returns names natively). Use `POST /products/search` only when structured filtering (by type, category, validation state) is needed and IDs are sufficient.

---

## Confirmed MAPI response shapes

From direct testing and UI network inspection against `api.test.bluestonepim.com`:

**`GET /pim/catalogs`**
```json
{ "data": [{ "id", "name", "number", "description", "readOnly", "assets" }] }
```
No `totalCount`. No pagination metadata in response body.

**`GET /pim/catalogs/{id}/nodes`**
Returns the full nested tree rooted at the catalog node. Each node has `children: []` recursively. Not a flat list — must walk the tree to enumerate all nodes.

**`GET /pim/catalogs/nodes/{id}/products`**
```json
{ "data": [{ "productId", "productName" }] }
```
Minimal shape — no attributes, no product type, no pagination metadata. Use `page`/`pageSize` query params to page.

**`POST /search/products/search`** (confirmed via UI network inspection)
```json
{ "data": [{ "id": "69da487cd41d9dd3b63c0ed1" }] }
```
No `total` field. IDs are wrapped in objects, not plain strings. Always pair with `POST /search/products/count`.

**`POST /search/products/count`** (confirmed via UI network inspection)
```json
{ "count": 1 }
```
Uses the same filter body as `/search/products/search`. No page/pageSize needed.

**`POST /pim/products/list/views/by-ids` with `views: [{ type: "METADATA" }]`** (confirmed via UI network inspection)
```json
{
  "data": [{
    "id": "69da487cd41d9dd3b63c0ed1",
    "metadata": {
      "name": { "value": { "en": "T-shirt - Green" } },
      "number": "69da487cd41d9dd3b63c0ed1",
      "state": "PLAYGROUND_ONLY",
      "type": "SINGLE",
      "archived": false,
      "lastUpdate": 1775955888298,
      "createDate": 1775913084713
    }
  }]
}
```
`name` is a context-keyed object, not a plain string. Extract with `name.value[context] ?? name.value["en"]`. Known `state` values: `PLAYGROUND_ONLY` (shown as "Draft" in the UI). Other states TBD.

**Note on `POST /pim/products/list/by-ids`:** The UI also calls this endpoint (without `/views/`), which returns a simpler flat response with `name` as a plain string plus `type`, `state`, and other native fields at the top level. This endpoint is **not in the official PIM API spec** and is therefore not used in the MCP. We use `list/views/by-ids` instead and extract the context key from the name object manually.

**`GET /pim/products/{id}/groupedAttributes`**
```json
{
  "data": [{
    "groupId": "<id>",
    "attributes": [{
      "definitionId": "<id>",
      "values": ["string value"],      // for plain attributes
      "dictionary": ["<option-id>"],   // for dictionary attributes
      "readOnly": false
    }]
  }]
}
```
All IDs — `groupId`, `definitionId`, and dictionary option values are opaque IDs. To display human-readable names, resolve via `GET /pim/definitions` (for attribute names) and `GET /pim/definitions/dictionary/{id}/values/list` (for dictionary option labels).

---

## Key endpoints by resource

### Products

| Method | Path | API | Notes |
|---|---|---|---|
| POST | `/products/list` | PAPI | Search/filter products org-wide. Supports `sort`, pagination. |
| POST | `/products/by-ids` | PAPI | Fetch multiple products by ID array |
| POST | `/products/by-numbers` | PAPI | Fetch by item number array |
| GET | `/products/{id}` | PAPI | Single product by ID |
| POST | `/products` | MAPI | Create product |
| PATCH | `/products/{id}` | MAPI | Update product (name, etc.) |
| GET | `/products/{id}/overview` | MAPI | Condensed product summary — likely better for AI than full response |
| POST | `/products/{id}/copy` | MAPI | Clone a product |
| PUT | `/products/archive/by-ids` | MAPI | Archive multiple products |
| PUT | `/products/unarchive/by-ids` | MAPI | Unarchive multiple products |

### Product attributes

| Method | Path | API | Notes |
|---|---|---|---|
| GET | `/products/{id}/attributes` | MAPI | All attributes for a product |
| GET | `/products/{id}/groupedAttributes` | MAPI | Same but grouped by attribute group — cleaner for display |
| POST | `/products/{id}/attributes` | MAPI | Add a simple attribute |
| PUT | `/products/{id}/attributes/{definitionId}` | MAPI | Update a simple attribute value |
| DELETE | `/products/{id}/attributes/{definitionId}` | MAPI | Remove an attribute |
| POST | `/products/{id}/attributes/dictionary` | MAPI | Add a dictionary attribute |
| POST | `/products/{id}/attributes/dictionary/{definitionId}/values` | MAPI | Set dictionary attribute values |

### Product categories

| Method | Path | API | Notes |
|---|---|---|---|
| GET | `/products/{id}/categories` | MAPI | List categories a product belongs to |
| POST | `/products/{id}/categories` | MAPI | Assign product to one or more categories |
| DELETE | `/products/{id}/categories/{categoryId}` | MAPI | Remove product from a category |
| POST | `/products/categories/by-ids` | MAPI | Bulk assign products to a category |

### Product variants

| Method | Path | API | Notes |
|---|---|---|---|
| PUT | `/products/{id}/variants/{variantProductId}` | MAPI | Add a SINGLE product as a variant under a GROUP |
| DELETE | `/products/{id}/variants/{variantProductId}` | MAPI | Remove a variant from its group |
| POST | `/products/{id}/variants` | MAPI | Set the group for a product (convert SINGLE → VARIANT) |

### Catalogs and categories (MAPI)

| Method | Path | Notes |
|---|---|---|
| GET | `/catalogs` | List all catalogs (`page`, `pageSize`, `archiveState`) |
| GET | `/catalogs/{id}/nodes` | Full category tree for a catalog |
| GET | `/catalogs/nodes/{id}` | Single category node |
| GET | `/catalogs/nodes/{id}/children` | Direct children of a node |
| POST | `/catalogs/nodes` | Create a new category node |
| PATCH | `/catalogs/nodes/{id}` | Update a category node |
| DELETE | `/catalogs/nodes/{id}` | Delete a category node |
| GET | `/catalogs/nodes/{id}/products` | Products in a category (MAPI version) |
| POST | `/catalogs/nodes/{id}/products` | Add products to a category node |
| DELETE | `/catalogs/nodes/{id}/products/{productId}` | Remove a product from a category |

### Attribute definitions

| Method | Path | API | Notes |
|---|---|---|---|
| GET | `/attributes` | PAPI | List attribute definitions (`id`, pagination, `context`) |
| GET | `/attributes/by-numbers` | PAPI | Fetch by number array |
| GET | `/definitions` | MAPI | Full attribute definition list (richer than PAPI) |
| GET | `/definitions/{id}` | MAPI | Single attribute definition |
| GET | `/definitions/simple` | MAPI | Only simple-type definitions |
| GET | `/definitions/dictionary/{id}/values/list` | MAPI | List allowed values for a dictionary attribute |

### Relations (product connections)

| Method | Path | Notes |
|---|---|---|
| GET | `/relations` | MAPI — list relation types (e.g. "accessories", "related") |
| GET | `/products/{id}/connections` | Connections on a specific product |
| POST | `/products/{id}/connections/products/{relationId}` | Create a connection between two products |
| DELETE | `/products/{id}/connections/products/{relationId}/{connectedProductId}` | Remove a connection |

---

## Deprecated — do not use

| Endpoint | EOL |
|---|---|
| `POST /products/{id}/{action}` (`changeStatus`) | 2026-11-10 |
| `POST /products/states/by-ids` | 2026-11-10 |
| `POST /validate/product` | 2026-12-20 |

---

## Useful utility endpoints

| Endpoint | API | What it returns |
|---|---|---|
| `GET /global-settings/context` | Global Settings (Bearer) | Available contexts (languages/markets). Returns `{ data: [{ id, name, locale, fallback, initial, archived }] }`. `initial: true` marks the default context. Filter out `archived: true`. |
| `GET /syncs` | PAPI | Publish history and sync states |
| `GET /differences/products` | PAPI | Products changed since last sync (useful for "what changed?") |
| `GET /async/status/{taskId}` | MAPI | Status of a background/bulk operation |
| `GET /technical/version` | MAPI | Service version |
