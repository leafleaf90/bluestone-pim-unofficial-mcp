import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ─── Credentials ──────────────────────────────────────────────────────────────

export interface Credentials {
  papiKey: string;
  mapiClientId: string;
  mapiClientSecret: string;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface CategoryAttribute {
  id: string;
  name: string;
  dataType: string;
  groupName: string;
  groupNumber?: string;
  number: string;
}

interface Category {
  id: string;
  order: number;
  name: string;
  number: string;
  description: string;
  attributes: CategoryAttribute[];
  categoryAttributes: CategoryAttribute[];
}

interface CategoriesResponse {
  totalCount: number;
  results: Category[];
}

interface ProductAttribute {
  id: string;
  name: string;
  groupName: string;
  dataType: string;
  unit?: string;
  values: string[];
  dictionary?: { value: string }[];
  definingAttribute?: boolean;
}

interface ProductMedia {
  id: string;
  downloadUri: string;
  previewUri: string;
  name?: string;
  fileName: string;
  contentType: string;
  labels: string[];
}

interface Product {
  id: string;
  type: "GROUP" | "VARIANT" | "SINGLE";
  name: string;
  number: string;
  lastUpdate: number;
  createDate: number;
  attributes: ProductAttribute[];
  media: ProductMedia[];
  variants: string[];
  variantParentId?: string;
  categories: string[];
}

interface ProductsResponse {
  totalCount: number;
  results: Product[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAPI_BASE = "https://api.test.bluestonepim.com/v1";
const MAPI_BASE = "https://api.test.bluestonepim.com";
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
  const res = await fetch(`${MAPI_BASE}${path}`, {
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

function formatAttributeValue(attr: ProductAttribute): string {
  if (attr.dictionary && attr.dictionary.length > 0) {
    return attr.dictionary.map((d) => d.value).join(", ");
  }
  if (attr.values && attr.values.length > 0) {
    const val = attr.values.join(", ");
    return attr.unit ? `${val} ${attr.unit}` : val;
  }
  return "(no value)";
}

function mapProduct(p: Product) {
  const attrs = p.attributes
    .filter((a) => a.values.length > 0 || (a.dictionary && a.dictionary.length > 0))
    .map((a) => ({
      group: a.groupName,
      name: a.name,
      value: formatAttributeValue(a),
      ...(a.definingAttribute && { definingAttribute: true }),
    }));
  return {
    name: p.name,
    number: p.number,
    type: p.type,
    id: p.id,
    lastUpdated: new Date(p.lastUpdate).toISOString(),
    ...(p.media.length > 0 && {
      media: p.media.map((m) => ({
        name: m.name ?? m.labels[0] ?? m.fileName,
        previewUri: m.previewUri,
        fileName: m.fileName,
        type: m.contentType,
      })),
    }),
    attributes: attrs,
  };
}

// ─── Server factory ───────────────────────────────────────────────────────────

export function createMcpServer(creds: Credentials): McpServer {
  const server = new McpServer(
    {
      name: "bluestone-pim",
      version: "1.0.0",
    },
    {
      instructions:
        "⚠️ Bluestone PIM MCP — Beta / Unofficial Experiment\n\n" +
        "This is an early, unofficial MCP integration for Bluestone PIM. It is currently very limited.\n\n" +
        "What it can do right now:\n" +
        "• List all catalogs in the organisation\n" +
        "• List all products within a catalog (incl. subcategories), with attributes and media info\n" +
        "• Create a new product (name only — no attributes or category assignment yet)\n\n" +
        "What it cannot do yet:\n" +
        "• Assign products to categories\n" +
        "• Set product attributes or media\n" +
        "• Update or delete products\n" +
        "• Anything beyond the three operations above\n\n" +
        "Always confirm the product name with the user before calling create_product.",
    }
  );

  // Tool 1: list_catalogs
  server.registerTool(
    "list_catalogs",
    {
      description:
        "List all catalogs in the Bluestone PIM organisation, sorted by display order. " +
        "Returns each catalog's name and ID. " +
        "Call this first to get category IDs before using list_products_in_category. " +
        "Category attribute definitions are included in the result — present them only if the user specifically asks about them.",
      inputSchema: {},
    },
    async () => {
      const data = await papiGet<CategoriesResponse>("/categories", creds);
      const sorted = [...data.results].sort((a, b) => a.order - b.order);
      const categories = sorted.map((cat) => ({
        name: cat.name,
        id: cat.id,
        ...(cat.attributes.length > 0 && {
          attributes: cat.attributes.map((a) => ({
            name: a.name,
            dataType: a.dataType,
            group: a.groupName,
          })),
        }),
      }));
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Found ${data.totalCount} catalog${data.totalCount === 1 ? "" : "s"} in this organisation.\n\n` +
              JSON.stringify({ totalCount: data.totalCount, categories }, null, 2),
          },
        ],
      };
    }
  );

  // Tool 2: list_products_in_category
  server.registerTool(
    "list_products_in_category",
    {
      description:
        "List products in a Bluestone PIM catalog (including subcategories). " +
        "Call list_catalogs first to get valid category IDs.\n\n" +
        "Product types:\n" +
        "• GROUP — a parent product with variants. Its variants are nested under it in the response.\n" +
        "• VARIANT — a child of a GROUP (e.g. a size or colour variant). Always displayed indented beneath its parent GROUP, never as a standalone item.\n" +
        "• SINGLE — a standalone product with no variants.\n\n" +
        "When displaying results: show GROUP products first with their VARIANT children listed beneath them. " +
        "SINGLE products stand alone. Never show VARIANTs at the top level.\n\n" +
        "Full attribute values are included — surface them when the user asks for details on a specific product. " +
        "Pass categoryName (the human-readable name from list_catalogs) so it appears in the response summary.",
      inputSchema: {
        categoryId: z.string().describe("The category ID to fetch products from"),
        categoryName: z
          .string()
          .optional()
          .describe(
            "Human-readable catalog name from list_catalogs — included in the response summary for context"
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

      // Bluestone PAPI pagination: itemsOnPage and pageNo are doubles, pageNo is 0-indexed.
      // The tool exposes 1-indexed pages to the model; we subtract 1 here.
      const data = await papiGet<ProductsResponse>(
        `/categories/${categoryId}/products?subCategories=true&itemsOnPage=${effectiveLimit}&pageNo=${effectivePage - 1}`,
        creds
      );

      // Separate products by type
      const groupMap = new Map<string, ReturnType<typeof mapProduct> & { variants: ReturnType<typeof mapProduct>[] }>();
      const singles: ReturnType<typeof mapProduct>[] = [];
      const variantsByParent = new Map<string, Product[]>();

      for (const p of data.results) {
        if (p.type === "VARIANT" && p.variantParentId) {
          const list = variantsByParent.get(p.variantParentId) ?? [];
          list.push(p);
          variantsByParent.set(p.variantParentId, list);
        } else if (p.type === "GROUP") {
          groupMap.set(p.id, { ...mapProduct(p), variants: [] });
        } else {
          singles.push(mapProduct(p));
        }
      }

      // Attach variants to their parent groups.
      // Variants whose GROUP is on a different page are included as standalone items
      // (the type field tells the model how to display them).
      const orphanVariants: ReturnType<typeof mapProduct>[] = [];
      for (const [parentId, variants] of variantsByParent) {
        const group = groupMap.get(parentId);
        if (group) {
          group.variants = variants.map(mapProduct);
        } else {
          orphanVariants.push(...variants.map(mapProduct));
        }
      }

      const products = [
        ...Array.from(groupMap.values()),
        ...singles,
        ...orphanVariants,
      ];

      const showing = data.results.length;
      const totalPages = Math.ceil(data.totalCount / effectiveLimit);
      const hasMore = effectivePage < totalPages;
      const label = categoryName ?? categoryId;

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Found ${data.totalCount} product${data.totalCount === 1 ? "" : "s"} in "${label}"` +
              (hasMore
                ? `, showing page ${effectivePage} of ${totalPages}. ` +
                  `Call again with page=${effectivePage + 1} to fetch more.`
                : `.`) +
              "\n\n" +
              JSON.stringify(
                {
                  catalog: label,
                  totalCount: data.totalCount,
                  page: effectivePage,
                  totalPages,
                  returned: showing,
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

  // Tool 3: create_product
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
        name: z.string().min(1).describe("The product name — must be confirmed by the user before calling"),
      },
    },
    async ({ name }) => {
      const { resourceId } = await mapiPost<Record<string, unknown>>("/pim/products", { name }, creds);
      if (!resourceId) {
        throw new Error("Product was created but no resource-id was returned in the response headers.");
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
