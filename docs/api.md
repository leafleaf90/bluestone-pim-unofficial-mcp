# Bluestone API reference

## Environments

| Environment | Base URL |
|---|---|
| Test | `https://api.test.bluestonepim.com` |
| Production | `https://api.bluestonepim.com` (when ready) |

---

## Public API (PAPI) — read-only

Base path: `/v1`  
Authentication: static header `x-api-key`

This is the API used by the MCP server. No token refresh required.

### List categories

```
GET /v1/categories
```

```bash
curl --request GET \
     --url https://api.test.bluestonepim.com/v1/categories \
     --header 'accept: application/json' \
     --header 'x-api-key: YOUR_KEY'
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
      "description": "",
      "attributes": [...],
      "categoryAttributes": [...]
    }
  ]
}
```

Key fields:
- `id` — used as `categoryId` in product requests
- `order` — display order (0 = first)
- `attributes` — attribute definitions available for products in this category
- `categoryAttributes` — attributes that describe the category itself

---

### List products in a category

```
GET /v1/categories/{categoryId}/products?subCategories=true
```

```bash
curl --request GET \
     --url 'https://api.test.bluestonepim.com/v1/categories/aaa000000000000000000001/products?subCategories=true' \
     --header 'accept: application/json' \
     --header 'x-api-key: YOUR_KEY'
```

Query parameters:
- `subCategories=true` — include products from nested subcategories (always use this)

Response shape:
```json
{
  "totalCount": 13,
  "results": [
    {
      "id": "bbb000000000000000000001",
      "type": "GROUP",
      "name": "Example Product Name",
      "number": "bbb000000000000000000001",
      "lastUpdate": 1774341927942,
      "createDate": 1774337867081,
      "attributes": [
        {
          "id": "...",
          "name": "Length",
          "groupName": "Dimensions",
          "dataType": "decimal",
          "unit": "mm",
          "values": ["3000"],
          "definingAttribute": false
        }
      ],
      "media": [
        {
          "id": "23b32451-b403-435a-9918-8f7f0ec557d5",
          "downloadUri": "https://media.test.bluestonepim.com/.../photo.jpg",
          "previewUri": "https://media.test.bluestonepim.com/.../photo.jpg?f=jpg&w=400",
          "name": "Product hero shot",
          "fileName": "323300004.jpg",
          "contentType": "image/jpeg",
          "labels": ["PPE-accessible", "pb"],
          "createdAt": 1631884720598,
          "updatedAt": 1724059213810
        }
      ],
      "variants": ["id1", "id2"],
      "categories": ["cat-id-1", "cat-id-2"]
    }
  ]
}
```

Key fields on each product:
- `type` — `GROUP`, `VARIANT`, or `SINGLE`
- `number` — the item number (human-readable, e.g. `"59215"`)
- `lastUpdate` — Unix timestamp in milliseconds
- `attributes[].values` — array of string values (empty if not set)
- `attributes[].dictionary` — for dictionary-type attributes, the selected value(s)
- `attributes[].definingAttribute` — true if this attribute differentiates variants within a GROUP
- `variants` — IDs of child VARIANT products (only on GROUP type)
- `variantParentId` — ID of parent GROUP (only on VARIANT type)
- `media[].previewUri` — publicly accessible thumbnail URL (`?f=jpg&w=400`). Passed through in MCP tool responses so Claude can render images inline.
- `media[].downloadUri` — full-resolution URL. Not included in MCP tool responses (no use case in chat).
- `media[].name` — descriptive name of the asset (e.g. "Product hero shot"). Falls back to `labels[0]` then `fileName` if absent.

---

## Management API (MAPI) — read/write

Base path: `/`  
Authentication: OAuth2 Bearer token (client credentials flow)

The MAPI is used for write operations. The server obtains a Bearer token automatically using the `MAPI_CLIENT_ID` and `MAPI_CLIENT_SECRET` credentials, caches it per client ID, and refreshes it 60 seconds before expiry (tokens last 1 hour).

### Create product

```
POST /pim/products
Header: authorization: Bearer <token>
Body: { "name": "..." }
```

The created product's ID is returned in the `resource-id` response header (the body is empty).

See [extending.md](extending.md) for how to add further MAPI write tools.

---

## Testing API calls directly

Use these curl commands to verify connectivity independent of the MCP server:

```bash
# List categories
curl -s \
  --url https://api.test.bluestonepim.com/v1/categories \
  --header 'accept: application/json' \
  --header 'x-api-key: your-papi-key-here' \
  | python3 -m json.tool

# List products in "Products" category
curl -s \
  --url 'https://api.test.bluestonepim.com/v1/categories/aaa000000000000000000001/products?subCategories=true' \
  --header 'accept: application/json' \
  --header 'x-api-key: your-papi-key-here' \
  | python3 -m json.tool
```
