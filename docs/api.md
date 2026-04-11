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
      "id": "69970cf452d7b36ee509a5f1",
      "order": 0,
      "name": "Products",
      "number": "69970cf452d7b36ee509a5f1",
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
     --url 'https://api.test.bluestonepim.com/v1/categories/69970cf452d7b36ee509a5f1/products?subCategories=true' \
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
      "id": "69c23f4bf9025d5844a6b6eb",
      "type": "GROUP",
      "name": "Cable ladder OE125 3m",
      "number": "69c23f4bf9025d5844a6b6eb",
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
      "media": [...],
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
  --url 'https://api.test.bluestonepim.com/v1/categories/69970cf452d7b36ee509a5f1/products?subCategories=true' \
  --header 'accept: application/json' \
  --header 'x-api-key: your-papi-key-here' \
  | python3 -m json.tool
```
