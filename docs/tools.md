# Tools

Claude uses tool descriptions to decide when and how to call each tool. The description is not just documentation — it is what Claude reads at runtime to understand the tool's purpose and how to present results.

---

## `session_init`

**Purpose:** Always called first at the start of every conversation, before any other tool. Returns a beta notice that Claude must show the user verbatim, then asks whether to proceed.

**Input:** None

**Why it exists:** Ensures the user knows this is an experimental integration with limited capabilities before any API calls are made.

---

## `list_catalogs`

**Purpose:** Fetch all categories in the Bluestone PIM organisation.

**Input:** None

**API call:**
```
GET /v1/categories
Header: x-api-key
```

**What Claude does with the result:**
- Presents categories sorted by their `order` field (the display order set in Bluestone)
- Shows category name and ID
- Only mentions category attributes if the user specifically asks

**Example prompts that trigger this tool:**
- "Show me the catalogs"
- "What categories are in the PIM?"
- "List the catalogs"

**Example output in chat:**

```
Here are the 7 categories in your Bluestone PIM:

1. Products — 69970cf452d7b36ee509a5f1
2. Channels — 6970581df08a12eba9d77077
3. ______________ — 69a7c6fb10e99d3efd412304
4. Archived Products — 69a6853c10e99d3efd411604
5. DPP — 69a688f054b2bc35386dae68
6. ______________ — 69a7c7042e4cc6df07cdee54
7. Supplier Data Onboarding — 69a7c70c2e4cc6df07cdee55

Which category would you like to see products from?
```

---

## `list_products_in_category`

**Purpose:** Fetch all products in a category and its subcategories.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `categoryId` | string | Yes | The category ID from `list_catalogs` |
| `categoryName` | string | No | Human-readable name (for display context) |

**API call:**
```
GET /v1/categories/{categoryId}/products?subCategories=true
Header: x-api-key
```

The `subCategories=true` parameter ensures products in nested subcategories are included.

**What Claude does with the result:**

The tool returns the full product data including all attribute values. Claude uses this to:
- List products with name, item number, and type (GROUP / VARIANT / SINGLE)
- Ask if the user wants to see details for any specific product
- If asked, display attribute values grouped by their attribute group (Dimensions, Marketing, ETIM, etc.)

**Product types:**

| Type | Meaning |
|---|---|
| `GROUP` | A parent product with variants. The `variantIds` field lists the variant IDs. |
| `VARIANT` | A specific variant of a GROUP product. The `variantOf` field points to the parent. |
| `SINGLE` | A standalone product with no variants. |

**Example prompts that trigger this tool:**
- "List products in the Products category"
- "Show me what's in Channels"
- "What products are in DPP?"

**Example follow-up prompts that Claude answers from the already-fetched data (no second tool call needed):**
- "Show me the details for ALTOSONIC V12"
- "What are the dimensions of OE125CQQ CL-900-3000 SS?"
- "Which of these are GROUP products?"

---

## `create_product`

**Purpose:** Create a new product in Bluestone PIM via the Management API (MAPI).

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | The product name — Claude will ask the user for this before calling |

**API call:**
```
POST /pim/products
Header: authorization: Bearer <token>
Body: { "name": "..." }
```

Authentication is handled automatically — the server fetches a Bearer token from the identity provider on first use, caches it in memory, and refreshes it 60 seconds before it expires (tokens last 1 hour). In serverless (Vercel) mode the cache is per function instance and does not persist across cold starts.

**What Claude does:**
- If the user hasn't provided a name, Claude asks before calling the tool
- On success, confirms the product was created and returns the new product ID (always present — taken from the `resource-id` response header)

**Example prompts that trigger this tool:**
- "Create a product called Test Widget"
- "Add a new product named OPTISONIC 5000"
- "Create a new product"  ← Claude will ask for the name before proceeding

---

## How Claude decides which tool to call

At startup, Claude Desktop sends a `tools/list` request to the MCP server. The server responds with the tool name, description, and input schema for each tool. Claude stores these and uses the descriptions to match user intent.

The input schema (defined with Zod) tells Claude what parameters to fill in and their types. Claude infers the values from the conversation — for example, it extracts the `categoryId` from the category the user mentioned, using the ID it received from `list_catalogs`.
