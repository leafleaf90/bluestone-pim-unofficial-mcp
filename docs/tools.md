# Tools

Claude uses tool descriptions to decide when and how to call each tool. The description is what Claude reads at runtime to understand the tool's purpose and how to present results.

---

## Prompting best practice

Always name the source in the first message of a new conversation:

```
Using Bluestone PIM, show me my catalogs
```

Not just:

```
Show me my catalogs
```

When Claude has code execution or artifact creation available alongside the MCP, it can try to fetch Bluestone data via HTTP or write a bash script instead of calling the MCP tool. It always fails because credentials are only available inside the tool execution context, but it wastes time and erodes trust. Naming the source in the first message removes the ambiguity and makes the MCP tools the obvious match.

If it goes wrong mid-conversation, redirect with: "Don't write code. Use the Bluestone PIM tools directly."

See `docs/mcp-patterns.md` for the server-side mitigations (IMPORTANT instruction in McpServer and per-tool description guards), and `docs/mcp-design.md` for the full explanation of why this is a partial fix.

---

---

## `list_contexts`

**Purpose:** List all available language and market contexts in the organisation.

**Input:** None

**API call:**
```
GET /global-settings/context
Header: authorization: Bearer <token>
```

**What Claude does with the result:**
- Presents context IDs, names, and locales
- Identifies the default context
- Tells the user to mention the context name or ID when they want results in a specific language

**Example prompts that trigger this tool:**
- "What languages are available?"
- "Switch to Dutch"
- "Show me contexts"

---

## `list_catalogs`

**Purpose:** Fetch all catalogs in the Bluestone PIM organisation. Returns working state data, including unpublished changes.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `context` | string | No | Language/market context ID (e.g. `"en"`, `"l3600"`). Defaults to `"en"`. |

**API call:**
```
GET /pim/catalogs
Header: authorization: Bearer <token>
Header: context: <context>
Header: context-fallback: true
```

**What Claude does with the result:**
- Lists catalogs with ID, name, and number
- Uses the catalog ID directly as `categoryId` in `list_products_in_category`

**Example prompts:**
- "Show me the catalogs"
- "List all catalogs"

---

## `list_products_in_category`

**Purpose:** List products in a catalog, including all sub-categories. Returns working state data, including unpublished changes. Uses a three-step process internally: search for IDs, count total, then resolve to product data.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `categoryId` | string | Yes | The catalog ID from `list_catalogs` |
| `categoryName` | string | No | Human-readable catalog name (shown in response summary) |
| `limit` | number | No | Products per page (default 50, max 200) |
| `page` | number | No | Page number, 1-indexed (default 1) |
| `context` | string | No | Language/market context ID. Defaults to `"en"`. |

**API calls (three steps):**

Step 1 + 2 run in parallel:
```
POST /search/products/search?archiveState=ACTIVE
Body: { categoryFilters: [{ categoryId, type: "IN_ANY_CHILD" }], page, pageSize }
→ returns { data: [{ id: string }] }   (IDs only, no total)

POST /search/products/count
Body: { categoryFilters: [{ categoryId, type: "IN_ANY_CHILD" }] }
→ returns { count: number }
```

Step 3:
```
POST /pim/products/list/views/by-ids?archiveState=ACTIVE
Body: { ids: [...], views: [{ type: "METADATA" }] }
→ returns { data: [{ id, metadata: { name: { value: { en, nl, ... } }, type, state, ... } }] }
```

Note: the Bluestone UI uses `POST /pim/products/list/by-ids` (simpler flat response with name as a plain string), but that endpoint is not in the official PIM API spec. This integration uses `list/views/by-ids` with the METADATA view instead. Name comes back as a context-keyed object (`{ value: { en: "...", nl: "..." } }`) and is resolved to the requested context with English as fallback.

**Product states:** Raw API state values are mapped to UI labels before being returned. Known mappings:

| API value | UI label |
|---|---|
| `PLAYGROUND_ONLY` | `Draft` |

Add new mappings in `mapProductState()` in `src/tools.ts` as they are discovered.

**What Claude does with the result:**
- Displays products with name, type, and state
- Shows pagination info and prompts to fetch more if `hasMore` is true
- After displaying the list, asks the user if they would like to create a new product in this catalog

**Example prompts:**
- "List products in the Products catalog"
- "What's in the DPP catalog?"
- "Show me products in Dutch"

---

## `list_published_catalogs`

**Purpose:** List published (live) catalogs. Returns only data that has been synced. No unpublished changes.

**Input:** None

**API call:**
```
GET /v1/categories
Header: x-api-key
```

**What Claude does:**
- Lists published catalogs sorted by display order
- Uses these IDs with `list_published_products_in_category`

---

## `list_published_products_in_category`

**Purpose:** List published (live) products in a category. Returns only synced data. No unpublished changes.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `categoryId` | string | Yes | Category ID from `list_published_catalogs` |
| `categoryName` | string | No | Human-readable name (shown in response summary) |
| `limit` | number | No | Products per page (default 50, max 200) |
| `page` | number | No | Page number, 1-indexed (default 1) |

**API call:**
```
GET /v1/categories/{categoryId}/products?subCategories=true&itemsOnPage={limit}&pageNo={page-1}
Header: x-api-key
```

PAPI pagination uses 0-indexed `pageNo`; the tool subtracts 1 from the 1-indexed `page` input.

---

## `get_product_image`

**Purpose:** Fetch a product image from Bluestone's media CDN and return it as an inline image content block so it renders directly in chat.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `imageUrl` | string | Yes | The `imageUrl` field from a product in `list_published_products_in_category` |
| `productName` | string | No | Product name used as alt text |

**What Claude does:**
- Calls this only when the user explicitly asks to see a product image, not automatically for every product in a list
- Fetches the preview URL (already sized to 400px wide, JPEG format via the `?f=jpg&w=400` query params Bluestone appends)
- Returns the image as base64 so it renders inline in the client
- In Claude Desktop, the image appears inside the tool result panel under the "Get product image" step, not inline in the reply. The tool result text instructs Claude to tell the user where to find it and provides the direct CDN URL as a fallback so the user can open it in a browser.

**Design note:** See `docs/mcp-design.md` (Response shaping) for why image URLs are included in list responses but images are not fetched there, and why this is a separate on-demand tool rather than part of the list call. See the Behavior quirks section for the tool result panel rendering detail.

**Example prompts:**
- "Show me what T-shirt - Green looks like from Bluestone PIM"
- "Can I see the product image from Bluestone?"

**Prompting note:** Phrase image requests with "from Bluestone PIM" rather than just "show the image". Without a source reference, a model with web search available may search the web first before falling back to this tool.

---

## `create_product`

**Purpose:** Create a new product in Bluestone PIM. Optionally assigns it to a catalog category after creation.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Product name. Claude will confirm with the user before calling |
| `categoryId` | string | No | Catalog category ID to assign the product to after creation |

**API calls:**

Step 1: create the product:
```
POST /pim/products
Header: authorization: Bearer <token>
Body: { "name": "..." }
→ 201, resource-id header contains the new product ID
```

Step 2: assign to category (only if `categoryId` is provided):
```
POST /pim/catalogs/nodes/{categoryId}/products
Header: authorization: Bearer <token>
Body: { "productId": "..." }
→ 204 No Content
```

If the category assignment fails, the product creation is still reported as successful with a note explaining the assignment error.

**What Claude does:**
- Confirms the product name with the user before calling
- If called from `list_products_in_category`, the `categoryId` is passed automatically so the product is assigned to the same catalog
- On success, confirms creation (and assignment if applicable) and suggests opening Bluestone PIM to continue enriching the product

**Example prompts:**
- "Create a product called Test Widget"
- "Add a new product": Claude will ask for the name first
- After listing products: "Yes, create a product here": Claude will ask for the name and pass the `categoryId`

---

## How Claude decides which tool to call

At startup, Claude Desktop sends a `tools/list` request to the MCP server. The server responds with the tool name, description, and input schema for each tool. Claude stores these and uses the descriptions to match user intent.

The input schema (defined with Zod) tells Claude what parameters to fill in and their types. Claude infers the values from the conversation, for example it extracts the `categoryId` from the catalog the user mentioned, using the ID it received from `list_catalogs`.
