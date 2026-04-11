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
    throw new Error(`Failed to obtain bearer token: ${res.status} ${res.statusText}`);
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
    throw new Error(`Bluestone PAPI error ${res.status}: ${body || res.statusText}`);
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
    const body = await res.text();
    throw new Error(`Bluestone MAPI error ${res.status}: ${body || res.statusText}`);
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

// ─── Server factory ───────────────────────────────────────────────────────────

export function createMcpServer(creds: Credentials): McpServer {
  let isFirstToolCall = true;

  function betaPrefix(): string {
    if (isFirstToolCall) {
      isFirstToolCall = false;
      return (
        "⚠️ SHOW THIS TO THE USER FIRST — Beta / Unofficial Experiment\n\n" +
        "This is an early, unofficial MCP integration for Bluestone PIM. It is currently very limited.\n\n" +
        "What it can do right now:\n" +
        "• List all categories (catalogs)\n" +
        "• List all products in a category (with attributes and media info)\n" +
        "• Create a new product (name only)\n\n" +
        "What it cannot do yet:\n" +
        "• Assign products to categories\n" +
        "• Set attributes or media\n" +
        "• Update or delete products\n\n" +
        "Present this to the user and ask if they want to proceed before using the data below.\n" +
        "─────────────────────────────────────\n\n"
      );
    }
    return "";
  }

  const server = new McpServer({
    name: "bluestone-pim",
    version: "1.0.0",
  });

  // Tool 0: session_init — must be called first in every conversation
  server.registerTool(
    "session_init",
    {
      description:
        "ALWAYS call this tool FIRST at the start of every conversation, before doing anything else " +
        "(before asking questions, before calling any other tool). " +
        "It returns a beta notice that must be shown to the user. " +
        "After showing the notice, ask the user if they want to proceed with their original request.",
      inputSchema: {},
    },
    () => ({
      content: [
        {
          type: "text" as const,
          text:
            "⚠️ Bluestone PIM MCP — Beta / Unofficial Experiment\n\n" +
            "This is an early, unofficial MCP integration for Bluestone PIM. It is currently very limited.\n\n" +
            "What it can do right now:\n" +
            "• List all categories (catalogs) in the organisation\n" +
            "• List all products within a category (incl. subcategories), with attributes and media info\n" +
            "• Create a new product (name only — no attributes or category assignment yet)\n\n" +
            "What it cannot do yet:\n" +
            "• Assign products to categories\n" +
            "• Set product attributes or media\n" +
            "• Update or delete products\n" +
            "• Anything beyond the three operations above\n\n" +
            "Show this notice to the user verbatim, then ask: " +
            "\"Would you like to go ahead with your original request?\" " +
            "Only proceed once they confirm.",
        },
      ],
    })
  );

  // Tool 1: list_catalogs
  server.registerTool(
    "list_catalogs",
    {
      description:
        "List all categories (catalogs) in the Bluestone PIM organisation, sorted by display order. " +
        "Returns each category's name and ID. Category attributes are included in the result — " +
        "present them only if the user specifically asks about them. " +
        "IMPORTANT: Call session_init first if this is the first tool call in the conversation.",
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
            text: betaPrefix() + JSON.stringify({ totalCount: data.totalCount, categories }, null, 2),
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
        "List all products in a Bluestone PIM category (including subcategories). " +
        "Returns product name, item number, type (GROUP/VARIANT/SINGLE), and ID. " +
        "Full attribute values are included — present them when the user asks for details on a specific product. " +
        "GROUP products are parent products with variants listed under them. " +
        "IMPORTANT: Call session_init first if this is the first tool call in the conversation.",
      inputSchema: {
        categoryId: z.string().describe("The category ID to fetch products from"),
        categoryName: z.string().optional().describe("Human-readable category name (for display)"),
      },
    },
    async ({ categoryId, categoryName }) => {
      const data = await papiGet<ProductsResponse>(
        `/categories/${categoryId}/products?subCategories=true`,
        creds
      );
      const products = data.results.map((p) => {
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
          ...(p.variantParentId && { variantOf: p.variantParentId }),
          ...(p.variants.length > 0 && { variantIds: p.variants }),
          ...(p.media.length > 0 && {
            media: p.media.map((m) => ({
              label: m.labels[0] ?? "Media",
              fileName: m.fileName,
              type: m.contentType,
            })),
          }),
          attributes: attrs,
        };
      });
      return {
        content: [
          {
            type: "text" as const,
            text: betaPrefix() + JSON.stringify(
              { category: categoryName ?? categoryId, totalCount: data.totalCount, products },
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
        "IMPORTANT: Call session_init first if this is the first tool call in the conversation. " +
        "The product name is required — always confirm the name with the user before calling this tool. " +
        "Returns the ID of the newly created product.",
      inputSchema: {
        name: z.string().min(1).describe("The product name — must be provided by the user"),
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
            text: betaPrefix() + JSON.stringify(
              { success: true, message: `Product "${name}" created successfully.`, id: resourceId },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  return server;
}
