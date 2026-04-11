import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ─── Credentials ──────────────────────────────────────────────────────────────

export interface Credentials {
  papiKey: string;
  mapiClientId: string;
  mapiClientSecret: string;
}

// ─── Types: PAPI ──────────────────────────────────────────────────────────────

interface PapiCategory {
  id: string;
  order: number;
  name: string;
  number: string;
  description: string;
}

interface PapiCategoriesResponse {
  totalCount: number;
  results: PapiCategory[];
}

interface PapiProduct {
  id: string;
  type: "GROUP" | "VARIANT" | "SINGLE";
  name: string;
  number: string;
}

interface PapiProductsResponse {
  totalCount: number;
  results: PapiProduct[];
}

// ─── Types: MAPI ──────────────────────────────────────────────────────────────

interface MapiCatalog {
  id: string;
  name: string;
  number: string;
  description: string;
  readOnly: boolean;
}

interface MapiCatalogsResponse {
  data: MapiCatalog[];
}


interface MapiNodeProduct {
  productId: string;
  productName: string;
}

interface MapiNodeProductsResponse {
  data: MapiNodeProduct[];
}

interface MapiAttribute {
  definitionId: string;
  values?: string[];
  dictionary?: string[];
  readOnly: boolean;
}

interface MapiAttributeGroup {
  groupId: string;
  attributes: MapiAttribute[];
}

// Available for get_product tool (future).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface MapiGroupedAttributesResponse {
  data: MapiAttributeGroup[];
}

interface MapiContext {
  id: string;
  name: string;
  locale: string;
  fallback: string;
  initial: boolean;
  archived: boolean;
}

interface MapiContextsResponse {
  data: MapiContext[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = "https://api.test.bluestonepim.com";
const PAPI_BASE = `${API_BASE}/v1`;
const MAPI_PIM_BASE = `${API_BASE}/pim`;
const MAPI_SEARCH_BASE = `${API_BASE}/search`;
const MAPI_GLOBAL_SETTINGS_BASE = `${API_BASE}/global-settings`;
const MAPI_TOKEN_URL = "https://idp.test.bluestonepim.com/op/token";

const DEFAULT_PRODUCT_LIMIT = 50;
const MAX_PRODUCT_LIMIT = 200;
const DEFAULT_PAGE = 1;

// ─── Token cache (per clientId for multi-tenant) ──────────────────────────────
//
// Note: in a serverless environment (Vercel) this cache is per cold-start instance
// and does not persist across invocations. Tokens will be re-fetched on each cold start.

const tokenCache = new Map<string, { value: string; expiresAt: number }>();

async function getBearerToken(creds: Credentials): Promise<string> {
  const cached = tokenCache.get(creds.mapiClientId);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.value;
  }
  const res = await fetch(MAPI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.mapiClientId,
      client_secret: creds.mapiClientSecret,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(mapiErrorMessage(res.status, body));
  }
  const { access_token, expires_in } = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  tokenCache.set(creds.mapiClientId, {
    value: access_token,
    expiresAt: Date.now() + expires_in * 1000,
  });
  return access_token;
}

// ─── Error helpers ────────────────────────────────────────────────────────────

function papiErrorMessage(status: number, body: string): string {
  switch (status) {
    case 401:
      return "Authentication failed (401). Your PAPI key may be invalid or expired.";
    case 403:
      return "Access denied (403). Your PAPI key does not have permission for this resource.";
    case 404:
      return `Resource not found (404).${body ? " " + body : ""}`;
    case 429:
      return "Rate limit exceeded (429). Wait a moment and try again.";
    default:
      return `Bluestone PAPI error ${status}: ${body || "Unknown error"}`;
  }
}

function mapiErrorMessage(status: number, body: string): string {
  switch (status) {
    case 401:
      return "Authentication failed (401). MAPI credentials may be invalid or expired.";
    case 403:
      return "Access denied (403). The MAPI client does not have permission for this operation.";
    case 404:
      return `Resource not found (404).${body ? " " + body : ""}`;
    case 409:
      return "Conflict (409). A resource with this name or ID may already exist.";
    case 429:
      return "Rate limit exceeded (429). Wait a moment and try again.";
    default:
      return `Bluestone MAPI error ${status}: ${body || "Unknown error"}`;
  }
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function papiGet<T>(path: string, creds: Credentials): Promise<T> {
  const res = await fetch(`${PAPI_BASE}${path}`, {
    headers: {
      accept: "application/json",
      "x-api-key": creds.papiKey,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(papiErrorMessage(res.status, body));
  }
  return res.json() as Promise<T>;
}

async function mapiPost<T>(
  path: string,
  body: unknown,
  creds: Credentials
): Promise<{ data: T; resourceId: string | null }> {
  const token = await getBearerToken(creds);
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(mapiErrorMessage(res.status, text));
  }
  const text = await res.text();
  const data = (text ? JSON.parse(text) : {}) as T;
  const resourceId = res.headers.get("resource-id");
  return { data, resourceId };
}

async function mapiGet<T>(
  url: string,
  creds: Credentials,
  options?: { context?: string }
): Promise<T> {
  const token = await getBearerToken(creds);
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${token}`,
  };
  if (options?.context) {
    headers["context"] = options.context;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(mapiErrorMessage(res.status, body));
  }
  return res.json() as Promise<T>;
}

// ─── Server factory ───────────────────────────────────────────────────────────

export function createMcpServer(creds: Credentials): McpServer {
  const server = new McpServer(
    {
      name: "bluestone-pim",
      version: "1.2.0",
    },
    {
      instructions:
        "Bluestone PIM MCP - Beta / Unofficial Experiment\n\n" +
        "This is an early, unofficial MCP integration for Bluestone PIM. It is currently limited.\n\n" +
        "What it can do right now:\n" +
        "- List available language/market contexts (list_contexts)\n" +
        "- List all catalogs and their full category tree, working state (list_catalogs)\n" +
        "- List products in a category node, working state (list_products_in_category)\n" +
        "- List published catalogs only (list_published_catalogs)\n" +
        "- List published products in a category (list_published_products_in_category)\n" +
        "- Create a new product by name (create_product)\n\n" +
        "What it cannot do yet:\n" +
        "- Fetch full product detail or attributes\n" +
        "- Set product attributes or media\n" +
        "- Update or delete products\n" +
        "- Assign products to categories\n\n" +
        "Working state vs published: the default read tools return working state data, " +
        "which includes unpublished changes and is what enrichment teams work with. " +
        "Use the list_published_* tools when the user specifically asks about live/published data.\n\n" +
        "Context (language/market): read tools accept an optional context parameter. " +
        "If the user asks to see data in a specific language, call list_contexts first to find the right context ID, " +
        "then pass it to subsequent tool calls. The default context is 'en' (English).\n\n" +
        "Always confirm the product name with the user before calling create_product.",
    }
  );

  // Tool: list_contexts
  server.registerTool(
    "list_contexts",
    {
      description:
        "List all available language and market contexts in this Bluestone PIM organisation. " +
        "Call this when the user asks to switch language or work in a different market context. " +
        "Returns context IDs, names, locales, and which context is the default. " +
        "Pass the context ID to other tools via their context parameter.",
      inputSchema: {},
    },
    async () => {
      const data = await mapiGet<MapiContextsResponse>(
        `${MAPI_GLOBAL_SETTINGS_BASE}/context`,
        creds
      );
      const contexts = data.data
        .filter((c) => !c.archived)
        .map((c) => ({
          id: c.id,
          name: c.name,
          locale: c.locale,
          ...(c.fallback && { fallback: c.fallback }),
          ...(c.initial && { default: true }),
        }));
      const defaultCtx = contexts.find((c) => c.default);
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Found ${contexts.length} context${contexts.length === 1 ? "" : "s"}. ` +
              `Default is "${defaultCtx?.name ?? "en"}" (${defaultCtx?.id ?? "en"}).\n\n` +
              JSON.stringify(contexts, null, 2),
          },
        ],
      };
    }
  );

  // Tool: list_catalogs
  server.registerTool(
    "list_catalogs",
    {
      description:
        "List all catalogs in the Bluestone PIM organisation. " +
        "Returns working state data, including unpublished changes. " +
        "Use the catalog id directly as the nodeId when calling list_products_in_category. " +
        "Call this first before browsing products.",
      inputSchema: {
        context: z
          .string()
          .optional()
          .describe(
            "Language/market context ID (e.g. \"en\", \"l3600\"). " +
            "Call list_contexts to see available values. Defaults to English if omitted."
          ),
      },
    },
    async ({ context }) => {
      const catalogsData = await mapiGet<MapiCatalogsResponse>(
        `${MAPI_PIM_BASE}/catalogs`,
        creds,
        { context }
      );

      const catalogs = catalogsData.data.map((cat) => ({
        id: cat.id,
        name: cat.name,
        number: cat.number,
        ...(cat.description && { description: cat.description }),
        ...(cat.readOnly && { readOnly: true }),
      }));

      const count = catalogs.length;
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Found ${count} catalog${count === 1 ? "" : "s"} (working state).\n\n` +
              JSON.stringify({ totalCount: count, catalogs }, null, 2),
          },
        ],
      };
    }
  );

  // Tool: list_products_in_category
  server.registerTool(
    "list_products_in_category",
    {
      description:
        "List products in a Bluestone PIM catalog. " +
        "Returns working state data, including unpublished changes. " +
        "Call list_catalogs first, then pass the catalog id directly as nodeId. " +
        "Returns a flat list of products with their IDs and names. " +
        "Full attribute detail is not included here. " +
        "Pass categoryName (the catalog name from list_catalogs) so it appears in the response summary.",
      inputSchema: {
        nodeId: z
          .string()
          .describe(
            "The catalog ID from list_catalogs. Pass it directly here to list products in that catalog."
          ),
        categoryName: z
          .string()
          .optional()
          .describe(
            "Human-readable catalog name from list_catalogs — included in the response summary for context."
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_PRODUCT_LIMIT)
          .optional()
          .describe(
            `Products per page (default ${DEFAULT_PRODUCT_LIMIT}, max ${MAX_PRODUCT_LIMIT}). ` +
            "If hasMore is true in the response, call again with page incremented by 1."
          ),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Page number to fetch, 1-indexed (default 1)."),
        context: z
          .string()
          .optional()
          .describe(
            "Language/market context ID (e.g. \"en\", \"l3600\"). " +
            "Call list_contexts to see available values. Defaults to English if omitted."
          ),
      },
    },
    async ({ nodeId, categoryName, limit, page, context }) => {
      const effectiveLimit = limit ?? DEFAULT_PRODUCT_LIMIT;
      const effectivePage = page ?? DEFAULT_PAGE;

      // MAPI pagination: page is 0-indexed, pageSize defaults to 1000.
      // The tool exposes 1-indexed pages to the model; we subtract 1 here.
      const params = new URLSearchParams({
        page: String(effectivePage - 1),
        pageSize: String(effectiveLimit),
      });

      const data = await mapiGet<MapiNodeProductsResponse>(
        `${MAPI_PIM_BASE}/catalogs/nodes/${nodeId}/products?${params}`,
        creds,
        { context }
      );

      const products = data.data.map((p) => ({
        id: p.productId,
        name: p.productName,
      }));

      const returned = products.length;
      // MAPI does not return totalCount for this endpoint.
      // If the page is full, there may be more results.
      const hasMore = returned === effectiveLimit;
      const label = categoryName ?? nodeId;

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Found products in "${label}" (working state). Returned ${returned} on page ${effectivePage}` +
              (hasMore
                ? `. Call again with page=${effectivePage + 1} to fetch more.`
                : ".") +
              "\n\n" +
              JSON.stringify(
                {
                  category: label,
                  page: effectivePage,
                  returned,
                  hasMore,
                  products,
                },
                null,
                2
              ),
          },
        ],
      };
    }
  );

  // Tool: list_published_catalogs
  server.registerTool(
    "list_published_catalogs",
    {
      description:
        "List published (live) catalogs in the Bluestone PIM organisation. " +
        "Returns only data that has been synced/published — does not include unpublished changes. " +
        "Use list_catalogs instead when the user is working on enrichment or wants to see current working state. " +
        "Returns category IDs for use with list_published_products_in_category.",
      inputSchema: {},
    },
    async () => {
      const data = await papiGet<PapiCategoriesResponse>("/categories", creds);
      const sorted = [...data.results].sort((a, b) => a.order - b.order);
      const catalogs = sorted.map((cat) => ({
        id: cat.id,
        name: cat.name,
        number: cat.number,
        ...(cat.description && { description: cat.description }),
      }));
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Found ${data.totalCount} published catalog${data.totalCount === 1 ? "" : "s"}.\n\n` +
              JSON.stringify({ totalCount: data.totalCount, catalogs }, null, 2),
          },
        ],
      };
    }
  );

  // Tool: list_published_products_in_category
  server.registerTool(
    "list_published_products_in_category",
    {
      description:
        "List published (live) products in a Bluestone PIM category. " +
        "Returns only data that has been synced/published — does not include unpublished changes. " +
        "Use list_products_in_category instead when the user is working on enrichment or wants working state. " +
        "Call list_published_catalogs first to get valid category IDs.\n\n" +
        "Product types in the response: GROUP (parent with variants), VARIANT (child of a GROUP), SINGLE (standalone).",
      inputSchema: {
        categoryId: z
          .string()
          .describe(
            "The category ID to fetch published products from. Get this from list_published_catalogs."
          ),
        categoryName: z
          .string()
          .optional()
          .describe(
            "Human-readable category name from list_published_catalogs — included in the response summary."
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_PRODUCT_LIMIT)
          .optional()
          .describe(
            `Products per page (default ${DEFAULT_PRODUCT_LIMIT}, max ${MAX_PRODUCT_LIMIT}). ` +
            "If hasMore is true in the response, call again with page incremented by 1."
          ),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Page number to fetch, 1-indexed (default 1)."),
      },
    },
    async ({ categoryId, categoryName, limit, page }) => {
      const effectiveLimit = limit ?? DEFAULT_PRODUCT_LIMIT;
      const effectivePage = page ?? DEFAULT_PAGE;

      // PAPI pagination: itemsOnPage and pageNo are doubles, pageNo is 0-indexed.
      const data = await papiGet<PapiProductsResponse>(
        `/categories/${categoryId}/products?subCategories=true&itemsOnPage=${effectiveLimit}&pageNo=${effectivePage - 1}`,
        creds
      );

      const products = data.results.map((p) => ({
        id: p.id,
        name: p.name,
        number: p.number,
        type: p.type,
      }));

      const totalPages = Math.ceil(data.totalCount / effectiveLimit);
      const hasMore = effectivePage < totalPages;
      const label = categoryName ?? categoryId;

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Found ${data.totalCount} published product${data.totalCount === 1 ? "" : "s"} in "${label}"` +
              (hasMore
                ? `, showing page ${effectivePage} of ${totalPages}. Call again with page=${effectivePage + 1} to fetch more.`
                : ".") +
              "\n\n" +
              JSON.stringify(
                {
                  category: label,
                  totalCount: data.totalCount,
                  page: effectivePage,
                  totalPages,
                  returned: products.length,
                  hasMore,
                  products,
                },
                null,
                2
              ),
          },
        ],
      };
    }
  );

  // Tool: create_product
  server.registerTool(
    "create_product",
    {
      description:
        "Create a new product in Bluestone PIM. " +
        "The product name is required — always confirm the name with the user before calling this tool. " +
        "Returns the name and ID of the newly created product. " +
        "After creating, do NOT offer to add attributes or assign the product to a category — these tools do not exist yet. " +
        "Instead, tell the user the product was created and suggest they open Bluestone PIM to continue enriching it.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe("The product name — must be confirmed by the user before calling."),
      },
    },
    async ({ name }) => {
      const { resourceId } = await mapiPost<Record<string, unknown>>(
        "/pim/products",
        { name },
        creds
      );
      if (!resourceId) {
        throw new Error(
          "Product was created but no resource-id was returned in the response headers."
        );
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Product "${name}" created successfully. ID: ${resourceId}`,
          },
        ],
      };
    }
  );

  return server;
}

// MAPI_SEARCH_BASE is reserved for the search_products tool (see TODO.md).
export { MAPI_SEARCH_BASE };
