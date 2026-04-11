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

## Two APIs, two auth methods

| | PAPI (Page API) | MAPI (PIM API) |
|---|---|---|
| Base URL | `https://api.test.bluestonepim.com/v1` | `https://api.test.bluestonepim.com/pim` |
| Auth | `x-api-key` header (static) | `Authorization: Bearer <token>` (OAuth2 client credentials) |
| Access | Read-only | Full CRUD |
| Token URL | n/a | `https://idp.test.bluestonepim.com/op/token` |
| Helper in tools.ts | `papiGet()` | `mapiPost()` + `getBearerToken()` |

---

## Pagination — different params per API

**PAPI:** `itemsOnPage` + `pageNo` (doubles, **0-indexed**)
```
?itemsOnPage=50&pageNo=0   ← first page
?itemsOnPage=50&pageNo=1   ← second page
```
Expose as 1-indexed to the model; subtract 1 before passing to Bluestone.

**MAPI:** `page` + `pageSize` (integers; assumed 0-indexed — verify before use)
```
?page=0&pageSize=50
```

Both return `totalCount` in the response body alongside `results`.

---

## Common query parameters

| Parameter | Where | Meaning |
|---|---|---|
| `context` | PAPI + MAPI | Publication/channel context (language, market). Use `GET /contexts` (PAPI) to list available values. |
| `archiveState` | MAPI | `ACTIVE` (default), `ARCHIVED`, or `ALL` |
| `subCategories` | PAPI `/categories/{id}/products` | `true` to include nested subcategories — always use this |

---

## Product types

| Type | Meaning |
|---|---|
| `GROUP` | Parent product. Has variants listed under it. Response includes `variants: [id, ...]` |
| `VARIANT` | Child of a GROUP. Has `variantParentId` pointing to its parent. |
| `SINGLE` | Standalone product with no variants. |

Variants should always be displayed nested under their parent GROUP, never as top-level items.

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
| `GET /contexts` | PAPI | Available publication contexts (language/market) |
| `GET /syncs` | PAPI | Publish history and sync states |
| `GET /differences/products` | PAPI | Products changed since last sync (useful for "what changed?") |
| `GET /async/status/{taskId}` | MAPI | Status of a background/bulk operation |
| `GET /technical/version` | MAPI | Service version |
