# Bluestone API reference

## Environments

| Environment | Base URL |
|---|---|
| Test | `https://api.test.bluestonepim.com` |
| Production | `https://api.bluestonepim.com` (when ready) |

---

## Public API (PAPI): published data only

Base path: `/v1`  
Authentication: static header `x-api-key`  
Pagination: `itemsOnPage` + `pageNo` (0-indexed)

Returns only published/synced data. Used by the `list_published_*` tools.

### List published categories

```
GET /v1/categories
```

```bash
curl -s \
  --url https://api.test.bluestonepim.com/v1/categories \
  --header 'accept: application/json' \
  --header 'x-api-key: YOUR_KEY' \
  | python3 -m json.tool
```

Response shape:
```json
{
  "totalCount": 7,
  "results": [
    {
      "id": "aaa000000000000000000001",
      "order": 0,
      "name": "Products",
      "number": "aaa000000000000000000001",
      "description": ""
    }
  ]
}
```

---

### List published products in a category

```
GET /v1/categories/{categoryId}/products?subCategories=true&itemsOnPage={n}&pageNo={0-indexed}
```

```bash
curl -s \
  --url 'https://api.test.bluestonepim.com/v1/categories/aaa000000000000000000001/products?subCategories=true' \
  --header 'accept: application/json' \
  --header 'x-api-key: YOUR_KEY' \
  | python3 -m json.tool
```

Response shape:
```json
{
  "totalCount": 13,
  "results": [
    {
      "id": "bbb000000000000000000001",
      "type": "GROUP",
      "name": "Example Product Name",
      "number": "59215"
    }
  ]
}
```

---

## Management API (MAPI): working state read/write

Three API families share the same Bearer token and base domain:

| Family | Base path | Used for |
|---|---|---|
| PIM | `/pim` | Products, catalogs, categories |
| Search | `/search` | Full-text and structured product search |
| Global Settings | `/global-settings` | Contexts (languages/markets) |

Authentication: OAuth 2.0 client credentials flow. The server fetches a Bearer token from `https://idp.test.bluestonepim.com/op/token`, caches it per `clientId`, and refreshes it 60 seconds before expiry (tokens last 1 hour). In serverless mode the cache is per function instance and does not persist across cold starts.

Common request headers:
```
authorization: Bearer <token>
context: <context-id>          (optional, e.g. "en", "l3600")
context-fallback: true         (always sent; returns fallback-language data instead of null)
```

---

### List contexts

```
GET /global-settings/context
```

Response shape:
```json
{
  "data": [
    {
      "id": "en",
      "name": "English",
      "locale": "en-GB",
      "fallback": "",
      "initial": true,
      "archived": false
    }
  ]
}
```

---

### List catalogs

```
GET /pim/catalogs
```

Response shape:
```json
{
  "data": [
    {
      "id": "aaa000000000000000000001",
      "name": "Products",
      "number": "PROD",
      "description": "",
      "readOnly": false
    }
  ]
}
```

The catalog `id` is used directly as the `categoryId` in product search calls.

---

### Search products (IDs only)

```
POST /search/products/search?archiveState=ACTIVE
Body: {
  "categoryFilters": [{ "categoryId": "...", "type": "IN_ANY_CHILD" }],
  "page": 0,
  "pageSize": 50
}
```

Response shape:
```json
{
  "data": [{ "id": "bbb000000000000000000001" }, { "id": "bbb000000000000000000002" }]
}
```

Note: `data` contains objects with an `id` field, not plain strings. There is no `total` field; use the count endpoint below.

---

### Count products matching a filter

```
POST /search/products/count
Body: {
  "categoryFilters": [{ "categoryId": "...", "type": "IN_ANY_CHILD" }]
}
```

Response shape:
```json
{ "count": 47 }
```

---

### Resolve product IDs to metadata

```
POST /pim/products/list/views/by-ids?archiveState=ACTIVE
Body: {
  "ids": ["bbb000000000000000000001", "bbb000000000000000000002"],
  "views": [{ "type": "METADATA" }]
}
```

Response shape:
```json
{
  "data": [
    {
      "id": "bbb000000000000000000001",
      "metadata": {
        "name": { "value": { "en": "Example Product", "nl": "Voorbeeldproduct" } },
        "number": "59215",
        "type": "SINGLE",
        "state": "PLAYGROUND_ONLY",
        "archived": false,
        "lastUpdate": 1774341927942,
        "createDate": 1774337867081
      }
    }
  ]
}
```

Key fields:
- `metadata.name.value`: context-keyed object, not a plain string. Extract with `value[context] ?? value["en"] ?? Object.values(value)[0]`
- `metadata.state`: raw API value (e.g. `PLAYGROUND_ONLY`). Mapped to UI labels via `mapProductState()` in `src/tools.ts`
- `metadata.type`: `SINGLE`, `GROUP`, or `VARIANT`

Note: the Bluestone UI uses `POST /pim/products/list/by-ids` (returns name as a plain string), but that endpoint is not in the official PIM spec. This integration uses `list/views/by-ids` with the METADATA view instead.

---

### Create product

```
POST /pim/products
Body: { "name": "..." }
→ 201 Created
→ resource-id: <new-product-id>   (response header, body is empty)
```

```bash
curl -s -i \
  --request POST \
  --url https://api.test.bluestonepim.com/pim/products \
  --header 'accept: application/json' \
  --header 'content-type: application/json' \
  --header 'authorization: Bearer YOUR_TOKEN' \
  --data '{"name":"Test Product"}'
```

---

### Assign product to a catalog category

```
POST /pim/catalogs/nodes/{nodeId}/products
Body: { "productId": "..." }
→ 204 No Content   (no body, no resource-id header)
```

`nodeId` is the catalog category ID (same value used in search `categoryFilters`). Called after `POST /pim/products` when `categoryId` is provided to `create_product`.

```bash
curl -s -i \
  --request POST \
  --url https://api.test.bluestonepim.com/pim/catalogs/nodes/aaa000000000000000000001/products \
  --header 'content-type: application/json' \
  --header 'authorization: Bearer YOUR_TOKEN' \
  --data '{"productId":"bbb000000000000000000001"}'
```

---

## Product states

Raw state values from the API are mapped to UI labels by `mapProductState()` in `src/tools.ts`. Add new mappings there as they are discovered.

| API value | UI label |
|---|---|
| `PLAYGROUND_ONLY` | `Draft` |

---

## Testing API calls directly

```bash
# Get a Bearer token
curl -s \
  --request POST \
  --url https://idp.test.bluestonepim.com/op/token \
  --header 'content-type: application/x-www-form-urlencoded' \
  --data 'grant_type=client_credentials&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET' \
  | python3 -m json.tool

# List catalogs
curl -s \
  --url https://api.test.bluestonepim.com/pim/catalogs \
  --header 'accept: application/json' \
  --header 'authorization: Bearer YOUR_TOKEN' \
  | python3 -m json.tool

# Search products in a catalog
curl -s \
  --request POST \
  --url 'https://api.test.bluestonepim.com/search/products/search?archiveState=ACTIVE' \
  --header 'accept: application/json' \
  --header 'content-type: application/json' \
  --header 'authorization: Bearer YOUR_TOKEN' \
  --data '{"categoryFilters":[{"categoryId":"aaa000000000000000000001","type":"IN_ANY_CHILD"}],"page":0,"pageSize":10}' \
  | python3 -m json.tool
```
