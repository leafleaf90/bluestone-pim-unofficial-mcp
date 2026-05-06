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

## Product onboarding prompts

Requests about onboarding, supplier onboarding, importing, bulk import, one-time bulk import, Excel import, CSV import, supplier data, spreadsheets, CSV files, Excel files, field mapping, attribute mapping, category mapping, preparing products before creation, or misspelled Bluestone references such as Blueston should use the read-only onboarding flow before giving advice:

1. Call `list_attribute_definitions`
2. Call `list_catalogs`
3. Call `list_contexts`
4. Call `list_category_tree` if category placement below the catalog root is needed
5. Present a product identity section, confident mappings, uncertain mappings, missing attributes, category suggestions, context notes, and validation notes

The product identity section should propose the source column to use as product `number`, the source column to use as product `name`, confidence for each, and a prompt asking whether the user wants to choose another number column. Product `number` is the unique key Bluestone PIM uses to detect existing products. This MCP onboarding flow is create-only for products, so a duplicate number should be reported as an existing product conflict rather than treated as an update or upsert.

No products or attributes should be created during this phase. Do not suggest creating partial sample products as a workaround for missing attributes or categories. If the mapping shows important model gaps, recommend a data-model update or draft a model specification for the user. After the user approves specific missing simple attributes, call `create_attribute_definition` to create them. Only create an attribute definition when the source field was not mapped to a suitable existing PIM attribute. After the user approves missing dictionary values, call `create_dictionary_value` to create them. Only create a dictionary value when the source value was not mapped to a suitable existing PIM dictionary value. After the user approves missing select values, call `append_select_attribute_values` to add them. Only append a select value when the source value was not mapped to a suitable existing enum value. After the user approves missing category paths, call `create_category_node` to create them. Only create a category when the source category was not mapped to a suitable existing PIM category.

This MCP server can create simple attribute definitions with name, data type, and optional unit, create dictionary values, append select enum values, create category nodes, and set product attribute values after a mapping is approved. It cannot create validation restrictions, attribute groups, or media yet. If those are needed, say they must be created outside the current MCP tools, for example in Bluestone PIM by a model administrator or by a separate management API workflow. Do not suggest PAPI for model changes.

Default UX: keep the first onboarding response short. Do not ask permission to pull the current Bluestone catalogs or data model, use the tools proactively. If the user has not provided source data yet, ask them to upload or paste source data such as `.xlsx`, `.xls`, `.csv`, `.tsv`, spreadsheet columns, CSV rows, sample products, JSON, XML, or product fields. Do not give a long generic onboarding playbook or list import mechanics unless the user explicitly asks for a process or workshop guide.

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
- Uses the catalog ID as `catalogId` in `list_category_tree` when category-level placement is needed

**Example prompts:**
- "Show me the catalogs"
- "List all catalogs"

---

## `list_category_tree`

**Purpose:** Fetch the working-state category tree for one catalog and return it as a flattened list with paths. This supports product onboarding when Claude needs to suggest where incoming products belong.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `catalogId` | string | Yes | Catalog ID from `list_catalogs` |
| `catalogName` | string | No | Human-readable catalog name (shown in response summary) |
| `search` | string | No | Case-insensitive filter across category name, number, and path |
| `limit` | number | No | Categories per page (default 200, max 500) |
| `page` | number | No | Page number, 1-indexed (default 1) |
| `context` | string | No | Language/market context ID. Defaults to `"en"`. |

**API call:**
```
GET /pim/catalogs/{catalogId}/nodes
Header: authorization: Bearer <token>
Header: context: <context>
Header: context-fallback: true
```

**What Claude does with the result:**
- Uses `path` and `depth` to present category placement suggestions clearly
- Suppresses raw IDs unless the user asks for implementation detail or needs to confirm an exact category
- Calls again with `search` or the next `page` if the category tree is large

**Example prompts:**
- "Map these products to existing categories"
- "Which category should these imported products go into?"
- "Show me the category tree for the Products catalog"

---

## `create_category_node`

**Purpose:** Create a catalog category node in working state.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Category node name confirmed by the user |
| `parentId` | string | No | Parent node ID from `list_catalogs` or `list_category_tree`. Omit to create a root-level node |
| `parentName` | string | No | Human-readable parent category name or path for confirmation context |

**API call:**
```
POST /pim/catalogs/nodes?validation=NAME
Header: authorization: Bearer <token>
Body: { "name": "CATEGORY_NAME", "parentId": "PARENT_ID_IF_NOT_ROOT" }
→ 201, resource-id header contains the new node ID
```

**What Claude does:**
- Calls `list_catalogs` and `list_category_tree` first to avoid duplicate categories
- Uses this only when a source category path was not mapped to a suitable existing PIM category
- Presents the proposed category name and parent category to the user for explicit confirmation
- Omits `parentId` for root-level nodes and passes `parentId` for child categories
- Returns the new category node ID from the `resource-id` header

---

## `list_attribute_definitions`

**Purpose:** Fetch the working-state attribute definitions used for product data onboarding and field mapping.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `search` | string | No | Case-insensitive search across name, number, group, data type, and unit |
| `group` | string | No | Case-insensitive group filter |
| `dataType` | string | No | Exact data type filter, for example `text`, `decimal`, `single_select`, or `dictionary` |
| `includeReadOnly` | boolean | No | Include read-only definitions (default false) |
| `includeRemoved` | boolean | No | Include definitions marked to be removed (default false) |
| `includeCompound` | boolean | No | Include compound definitions (default true) |
| `maxEnumValues` | number | No | Maximum enum values per select attribute (default 25, max 100). Use 0 to omit values |
| `limit` | number | No | Definitions per page (default 100, max 500) |
| `page` | number | No | Page number, 1-indexed (default 1) |

**API call:**
```
GET /pim/definitions
Header: authorization: Bearer <token>
Header: context-fallback: true
```

**What Claude does with the result:**
- Maps incoming spreadsheet columns or user-provided product fields to existing attributes
- Presents confident matches, uncertain matches, fields with no good match, and suggested new attributes
- Flags validation issues such as enum mismatches, range mismatches, unit ambiguity, context-aware fields, and read-only fields
- Suppresses raw IDs and full enum lists unless the user asks for implementation detail

**Example prompts:**
- "Map this spreadsheet to our Bluestone PIM attributes"
- "Do we already have attributes for these supplier fields?"
- "Which attributes should I create for this product data?"

---

## `create_attribute_definition`

**Purpose:** Create a simple attribute definition in the working-state data model.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Attribute definition name confirmed by the user |
| `dataType` | string | Yes | One of the supported Bluestone attribute data types |
| `unit` | string | No | Optional unit, for example `kg`, `mm`, `kW`, `m3/h`, or `years` |

**API call:**
```
POST /pim/definitions
Header: authorization: Bearer <token>
Body: { "dataType": "decimal", "name": "Weight", "unit": "kg" }
→ 201, resource-id header contains the new definition ID
```

Supported `dataType` values: `boolean`, `integer`, `decimal`, `date`, `time`, `date_time`, `location`, `single_select`, `multi_select`, `text`, `formatted_text`, `pattern`, `multiline`, `column`, `matrix`, `dictionary`.

**What Claude does:**
- Calls `list_attribute_definitions` first to avoid duplicate attributes
- Uses this only when a source field was not mapped to a suitable existing PIM attribute
- Presents the proposed name, data type, and unit to the user for explicit confirmation
- Uses this only for simple definitions. It does not create enum values, dictionary values, validation restrictions, groups, category nodes, or product attribute values
- Returns the new definition ID from the `resource-id` header

---

## `create_dictionary_value`

**Purpose:** Create a value for a dictionary attribute definition.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `dictionaryId` | string | Yes | Dictionary attribute definition ID from `list_attribute_definitions` |
| `value` | string | Yes | Dictionary value label confirmed by the user |
| `dictionaryName` | string | No | Human-readable dictionary attribute name for confirmation context |

**API call:**
```
POST /pim/definitions/dictionary/{dictionaryId}/values
Header: authorization: Bearer <token>
Body: { "value": "NEW VALUE HERE" }
→ 201, resource-id header contains the new dictionary value ID
```

**What Claude does:**
- Calls `list_attribute_definitions` first to verify the target definition exists and has `dataType: "dictionary"`
- Uses this only when an onboarding value was not mapped to a suitable existing dictionary value
- Presents the dictionary attribute and new value to the user for explicit confirmation
- Uses the returned dictionary value ID later as the value in `set_product_attribute`

---

## `append_select_attribute_values`

**Purpose:** Append enum values to an existing `single_select` or `multi_select` attribute definition.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `definitionId` | string | Yes | Select attribute definition ID from `list_attribute_definitions` |
| `values` | array | Yes | New enum values to append. Each item has `value`, optional `metadata`, and optional `number` |
| `attributeName` | string | No | Human-readable attribute name for confirmation context |
| `context` | string | No | Language/market context ID. Defaults to `"en"` |

**API calls:**
```
GET /pim/definitions/{definitionId}
Header: authorization: Bearer <token>

PUT /pim/definitions/{definitionId}?validation=NAME
Header: authorization: Bearer <token>
Body: full merged definition with existing enum values preserved and new values appended
```

**Why this is guarded:** Bluestone exposes select-value updates through a PUT on the full definition. Sending only the new enum value would overwrite existing definition fields and enum values. This tool therefore reads the full definition, preserves updateable fields and existing enum values including `valueId`, `number`, and `metadata`, appends the new values, then writes the merged object.

**What Claude does:**
- Calls `list_attribute_definitions` first to verify the target has `dataType: "single_select"` or `dataType: "multi_select"`
- Uses this only when an onboarding value was not mapped to a suitable existing enum value
- Presents the existing attribute, current values, and proposed new values to the user for explicit confirmation
- Does not rename, remove, or replace enum values

---

## `set_product_attribute`

**Purpose:** Add an attribute value to an existing product.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `productId` | string | Yes | Product ID from `list_products_in_category` or `create_product` |
| `definitionId` | string | Yes | Attribute definition ID from `list_attribute_definitions` or `create_attribute_definition` |
| `values` | string[] | Yes | Attribute values as strings |
| `productName` | string | No | Human-readable product name for confirmation context |
| `attributeName` | string | No | Human-readable attribute name for confirmation context |

**API call:**
```
POST /pim/products/{productId}/attributes
Header: authorization: Bearer <token>
Body: { "definitionId": "...", "values": ["..."] }
```

`values` are always sent as strings:

- Decimal: `["1.5"]`
- Boolean: `["true"]`
- Single select: `["enumValueId"]`
- Multi-select: `["enumValueId1", "enumValueId2"]`

For select and multi-select attributes, use enum value IDs from `list_attribute_definitions`, not display labels. For dictionary attributes, use dictionary value IDs from `create_dictionary_value` or other dictionary value sources.

**What Claude does:**
- Calls `list_attribute_definitions` first to verify the target definition, data type, unit, enum values, and restrictions
- Confirms the exact product, attribute, and values with the user before calling
- Uses this only after the onboarding mapping is approved and the user moves to a write phase

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

## `get_product`

**Purpose:** Fetch full working-state product details, including raw attribute values, category IDs, asset IDs, relations, bundles, and variant information.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `productId` | string | Yes | Product ID from `list_products_in_category` or `create_product` |
| `productName` | string | No | Human-readable product name (shown in response summary) |
| `context` | string | No | Language/market context ID. Defaults to `"en"`. |

**API call:**
```
GET /pim/products/{productId}
Header: accept: application/full+json
Header: authorization: Bearer <token>
Header: context: <context>
Header: context-fallback: true
```

**What Claude does:**
- Calls this before writing product attributes or category changes when current values need inspection
- Shows a concise product summary to the user
- Uses `list_attribute_definitions` to resolve attribute names, data types, enum values, and dictionary context when needed
- Suppresses raw IDs unless the user asks for implementation detail or a write action needs exact IDs

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
| `number` | string | No | Product number. Strongly recommended for onboarding because it is the unique product key |
| `categoryId` | string | No | Catalog category ID to assign the product to after creation |

**API calls:**

Step 1: create the product:
```
POST /pim/products
Header: authorization: Bearer <token>
Body: { "name": "...", "number": "..." }
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

If the product number already exists, Bluestone returns a `409` with the conflicting product ID. Claude reports that this onboarding flow is create-only and does not update or upsert the existing product.

**What Claude does:**
- Confirms the product name and product number with the user before calling
- If called from `list_products_in_category`, the `categoryId` is passed automatically so the product is assigned to the same catalog
- On success, confirms creation (and assignment if applicable) and suggests opening Bluestone PIM to continue enriching the product

**Example prompts:**
- "Create a product called Test Widget"
- "Add a new product": Claude will ask for the name first
- After listing products: "Yes, create a product here": Claude will ask for the name and pass the `categoryId`

---

## `assign_product_to_category`

**Purpose:** Assign an existing product to a catalog category.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `productId` | string | Yes | Product ID from `list_products_in_category` or `create_product` |
| `categoryId` | string | Yes | Category ID from `list_catalogs` or `list_category_tree` |
| `productName` | string | No | Human-readable product name for confirmation context |
| `categoryName` | string | No | Human-readable category name or path for confirmation context |

**API call:**
```
POST /pim/catalogs/nodes/{categoryId}/products
Header: authorization: Bearer <token>
Body: { "productId": "..." }
```

**What Claude does:**
- Calls `list_catalogs` and, if needed, `list_category_tree` to get the target category
- Confirms the exact product and target category with the user before calling
- Uses this only for category placement, not attribute enrichment or publication

---

## `update_product_name`

**Purpose:** Rename an existing product.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `productId` | string | Yes | Product ID from `list_products_in_category` or `create_product` |
| `newName` | string | Yes | New product name confirmed by the user |
| `currentName` | string | No | Current product name for confirmation context |

**API call:**
```
PATCH /pim/products/{productId}
Header: authorization: Bearer <token>
Body: { "name": "..." }
```

**What Claude does:**
- Confirms the exact current product and new name with the user before calling
- Uses this only for product rename, not attributes, category placement, media, or publication

---

## How Claude decides which tool to call

At startup, Claude Desktop sends a `tools/list` request to the MCP server. The server responds with the tool name, description, and input schema for each tool. Claude stores these and uses the descriptions to match user intent.

The input schema (defined with Zod) tells Claude what parameters to fill in and their types. Claude infers the values from the conversation, for example it extracts the `categoryId` from the catalog the user mentioned, using the ID it received from `list_catalogs`.
