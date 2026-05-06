import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VERSION } from "./version.js";

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

interface PapiProductMedia {
  previewUri: string;
  downloadUri: string;
  labels: string[];
}

interface PapiProduct {
  id: string;
  type: "GROUP" | "VARIANT" | "SINGLE";
  name: string;
  number: string;
  media?: PapiProductMedia[];
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

interface MapiCatalogNode {
  id: string;
  name?: string;
  number?: string;
  description?: string;
  parentId?: string;
  readOnly?: boolean;
  children?: MapiCatalogNode[];
  childNodes?: MapiCatalogNode[];
  nodes?: MapiCatalogNode[];
}

interface MapiCatalogNodesResponse {
  data: MapiCatalogNode[] | MapiCatalogNode;
}

interface MapiAttributeDefinitionEnumValue {
  valueId?: string;
  value: string;
  number?: string;
  metadata?: string;
}

interface MapiAttributeDefinitionRestrictions {
  enum?: {
    type?: string;
    values?: MapiAttributeDefinitionEnumValue[];
  };
  range?: {
    min?: string;
    max?: string;
    step?: string;
  };
  text?: Record<string, unknown>;
}

interface MapiAttributeDefinition {
  id: string;
  name: string;
  number: string;
  groupId?: string;
  group?: string;
  externalSource: boolean;
  internal: boolean;
  isCompound: boolean;
  toBeRemoved: boolean;
  contextAware: boolean;
  dataType?: string;
  restrictions?: MapiAttributeDefinitionRestrictions;
  charset?: string;
  unit?: string;
  contentType?: string;
  readOnly: boolean;
}

interface MapiAttributeDefinitionsResponse {
  data: MapiAttributeDefinition[];
}


interface SearchProductsResponse {
  // data is an array of objects, not plain strings.
  // total is NOT present: use POST /search/products/count separately.
  data: Array<{ id: string }>;
}

interface SearchCountResponse {
  count: number;
}

interface MapiProductMetadata {
  // name is context-keyed: { value: { en: "...", nl: "..." } }
  name?: { value: Record<string, string> };
  number?: string;
  type?: string;   // "SINGLE" | "GROUP" | "VARIANT"
  state?: string;  // "PLAYGROUND_ONLY" (Draft), others TBD
  archived?: boolean;
  lastUpdate?: number;
  createDate?: number;
}

interface MapiProductView {
  id: string;
  metadata?: MapiProductMetadata;
}

interface MapiProductViewsResponse {
  data: MapiProductView[];
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

const IS_PRODUCTION = process.env.ENVIRONMENT === "production";
const API_BASE = IS_PRODUCTION
  ? "https://api.bluestonepim.com"
  : "https://api.test.bluestonepim.com";
const PAPI_BASE = `${API_BASE}/v1`;
const MAPI_PIM_BASE = `${API_BASE}/pim`;
const MAPI_SEARCH_BASE = `${API_BASE}/search`;
const MAPI_GLOBAL_SETTINGS_BASE = `${API_BASE}/global-settings`;
const MAPI_TOKEN_URL = IS_PRODUCTION
  ? "https://idp.bluestonepim.com/op/token"
  : "https://idp.test.bluestonepim.com/op/token";

const DEFAULT_PRODUCT_LIMIT = 50;
const MAX_PRODUCT_LIMIT = 200;
const DEFAULT_DEFINITION_LIMIT = 100;
const MAX_DEFINITION_LIMIT = 500;
const DEFAULT_CATEGORY_LIMIT = 200;
const MAX_CATEGORY_LIMIT = 500;
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

// mapiPostBody: POST that returns a JSON response body (not a mutation with resource-id).
async function mapiPostBody<T>(
  url: string,
  body: unknown,
  creds: Credentials,
  options?: { context?: string }
): Promise<T> {
  const token = await getBearerToken(creds);
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    // context-fallback instructs the API to return fallback-language data when
    // the requested context has no translation, rather than returning null/empty.
    "context-fallback": "true",
  };
  if (options?.context) {
    headers["context"] = options.context;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(mapiErrorMessage(res.status, text));
  }
  return res.json() as Promise<T>;
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
    "context-fallback": "true",
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

// ─── Mappers ──────────────────────────────────────────────────────────────────

// Map raw API state values to the labels shown in the Bluestone PIM UI.
function mapProductState(state: string): string {
  const states: Record<string, string> = {
    PLAYGROUND_ONLY: "Draft",
  };
  return states[state] ?? state;
}

function includesSearch(value: string | undefined, search: string): boolean {
  return (value ?? "").toLowerCase().includes(search.toLowerCase());
}

function extractCatalogNodes(
  response: MapiCatalogNodesResponse | MapiCatalogNode[] | MapiCatalogNode
): MapiCatalogNode[] {
  if (Array.isArray(response)) {
    return response;
  }
  if ("data" in response) {
    const data = response.data;
    if (Array.isArray(data)) {
      return data;
    }
    return data ? [data] : [];
  }
  return [response];
}

function childCatalogNodes(node: MapiCatalogNode): MapiCatalogNode[] {
  return node.children ?? node.childNodes ?? node.nodes ?? [];
}

function flattenCatalogNodes(
  nodes: MapiCatalogNode[],
  parentPath: string[] = [],
  depth = 0,
  parentId?: string
): Array<{
  id: string;
  name: string;
  path: string;
  depth: number;
  parentId?: string;
  number?: string;
  description?: string;
  readOnly?: true;
}> {
  return nodes.flatMap((node) => {
    const name = node.name ?? node.number ?? node.id;
    const pathParts = [...parentPath, name];
    const category = {
      id: node.id,
      name,
      path: pathParts.join(" > "),
      depth,
      ...(parentId && { parentId }),
      ...(node.number && { number: node.number }),
      ...(node.description && { description: node.description }),
      ...(node.readOnly && { readOnly: true as const }),
    };
    return [
      category,
      ...flattenCatalogNodes(childCatalogNodes(node), pathParts, depth + 1, node.id),
    ];
  });
}

// ─── Server factory ───────────────────────────────────────────────────────────

export function createMcpServer(creds: Credentials): McpServer {
  const server = new McpServer(
    {
      name: "bluestone-pim",
      version: VERSION,
    },
    {
      instructions:
        "Bluestone PIM MCP - Beta / Bluestone PIM Labs\n\n" +
        "This is an early Bluestone PIM Labs community MCP integration for Bluestone PIM. It is currently limited.\n\n" +
        "What it can do right now:\n" +
        "- List available language/market contexts (list_contexts)\n" +
        "- List all catalogs, working state (list_catalogs)\n" +
        "- List category trees within a catalog for onboarding and placement decisions (list_category_tree)\n" +
        "- List attribute definitions for product data onboarding and field mapping (list_attribute_definitions)\n" +
        "- List products in a catalog including all sub-categories, working state (list_products_in_category)\n" +
        "- List published catalogs only (list_published_catalogs)\n" +
        "- List published products in a category, includes image URL per product (list_published_products_in_category)\n" +
        "- Fetch and display a product image inline (get_product_image)\n" +
        "- Create a new product by name, optionally assigned to a catalog category (create_product)\n\n" +
        "What it cannot do yet:\n" +
        "- Fetch full product detail or attributes\n" +
        "- Set product attributes or media\n" +
        "- Update or delete products\n\n" +
        "Working state vs published: the default read tools return working state data, " +
        "which includes unpublished changes and is what enrichment teams work with. " +
        "Use the list_published_* tools when the user specifically asks about live/published data.\n\n" +
        "Context (language/market): read tools accept an optional context parameter. " +
        "If the user asks to see data in a specific language, call list_contexts first to find the right context ID, " +
        "then pass it to subsequent tool calls. The default context is 'en' (English).\n\n" +
        "Always confirm the product name with the user before calling create_product.\n\n" +
        "For any request about product data onboarding, importing, import planning, supplier data, spreadsheets, CSV files, Excel files, field mapping, attribute mapping, category mapping, or preparing products before creation, do not answer from generic onboarding knowledge first. Immediately call list_attribute_definitions and list_catalogs before responding. " +
        "If the user needs category placement beyond the catalog root, call list_category_tree for the relevant catalog. " +
        "Do not ask the user whether you should pull the current catalogs or data model: use these tools proactively because that is the purpose of this server. " +
        "Use those read-only results to present a suggested mapping with confident matches, uncertain matches, missing attributes, category suggestions, and validation notes. " +
        "Keep onboarding replies concise and action-oriented. If the user has not provided source data yet, ask them to upload or paste source data such as .xlsx, .xls, .csv, .tsv, spreadsheet columns, sample rows, JSON, XML, or product fields next. " +
        "Do not produce a long generic onboarding playbook or list import mechanics unless the user explicitly asks for a process, workshop plan, or detailed onboarding guide. " +
        "Do not create products or change attributes during onboarding unless the user explicitly moves beyond planning and confirms a write action.\n\n" +
        "IMPORTANT: All Bluestone PIM data must come from the tools in this server. " +
        "Do not attempt to fetch Bluestone data using HTTP requests, bash commands, code artifacts, or any other method. " +
        "The tools handle authentication and API access internally. " +
        "Direct API calls will fail because credentials are only available inside the tool execution context.\n" +
        "Do not search the web for Bluestone product images. When the user asks to see a product image, call get_product_image with the imageUrl from the product list.",
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
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
        "Use the catalog id directly as the nodeId when calling list_products_in_category, or as catalogId when calling list_category_tree. " +
        "Call this first before browsing products or mapping new product data, supplier data, spreadsheet rows, CSV rows, Excel rows, or import files to categories. " +
        "Do not attempt to fetch catalog data via HTTP, bash, or code. Use this tool directly.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
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
      const effectiveContext = context ?? "en";
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
              `Found ${count} catalog${count === 1 ? "" : "s"} (working state, context: ${effectiveContext}).\n\n` +
              JSON.stringify({ totalCount: count, context: effectiveContext, catalogs }, null, 2),
          },
        ],
      };
    }
  );

  // Tool: list_category_tree
  server.registerTool(
    "list_category_tree",
    {
      description:
        "List the working-state category tree for a Bluestone PIM catalog. " +
        "Call list_catalogs first, then pass the catalog id as catalogId. " +
        "Use this for product data onboarding, import planning, supplier spreadsheets, CSV files, Excel files, and any request where incoming products need to be matched to existing categories. " +
        "Returns a flattened tree with path and depth so category suggestions can be shown clearly. " +
        "Suppress raw IDs in user-facing replies unless the user asks for them or needs to confirm an exact target. " +
        "If no categories are returned, tell the user the catalog may only have a root node or the client may not have access.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: {
        catalogId: z
          .string()
          .describe("The catalog ID from list_catalogs."),
        catalogName: z
          .string()
          .optional()
          .describe("Human-readable catalog name from list_catalogs. Included in the response summary for context."),
        search: z
          .string()
          .optional()
          .describe("Optional case-insensitive search across category name, number, and path. Use this to narrow a large tree."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_CATEGORY_LIMIT)
          .optional()
          .describe(
            `Categories per page (default ${DEFAULT_CATEGORY_LIMIT}, max ${MAX_CATEGORY_LIMIT}). ` +
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
    async ({ catalogId, catalogName, search, limit, page, context }) => {
      const effectiveLimit = limit ?? DEFAULT_CATEGORY_LIMIT;
      const effectivePage = page ?? DEFAULT_PAGE;
      const effectiveContext = context ?? "en";
      const label = catalogName ?? catalogId;

      const data = await mapiGet<MapiCatalogNodesResponse | MapiCatalogNode[] | MapiCatalogNode>(
        `${MAPI_PIM_BASE}/catalogs/${catalogId}/nodes`,
        creds,
        { context }
      );

      const categories = flattenCatalogNodes(extractCatalogNodes(data));
      const filtered = search
        ? categories.filter(
            (category) =>
              includesSearch(category.name, search) ||
              includesSearch(category.number, search) ||
              includesSearch(category.path, search)
          )
        : categories;

      const total = filtered.length;
      const start = (effectivePage - 1) * effectiveLimit;
      const pagedCategories = filtered.slice(start, start + effectiveLimit);
      const hasMore = start + pagedCategories.length < total;

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Found ${total} categor${total === 1 ? "y" : "ies"} in "${label}" (working state, context: ${effectiveContext}). ` +
              `Returned ${pagedCategories.length} on page ${effectivePage}` +
              (hasMore
                ? `. Call again with page=${effectivePage + 1} to fetch more.`
                : ".") +
              "\n\n" +
              JSON.stringify(
                {
                  catalog: label,
                  catalogId,
                  context: effectiveContext,
                  search: search ?? null,
                  total,
                  page: effectivePage,
                  returned: pagedCategories.length,
                  hasMore,
                  categories: pagedCategories,
                },
                null,
                2
              ),
          },
        ],
      };
    }
  );

  // Tool: list_attribute_definitions
  server.registerTool(
    "list_attribute_definitions",
    {
      description:
        "List attribute definitions in the Bluestone PIM working-state data model. " +
        "Use this before product data onboarding, importing, import planning, supplier data review, spreadsheet mapping, CSV mapping, Excel mapping, field mapping, attribute mapping, or deciding whether an incoming field already has a matching attribute. " +
        "Returns shaped definition metadata: id, number, name, group, type, unit, context awareness, enum values, and validation restrictions. " +
        "Suppress raw IDs and full enum lists in user-facing replies unless the user asks for implementation detail. " +
        "When mapping incoming data, present confident matches, uncertain matches, fields with no good match, and validation issues such as enum or range mismatches. " +
        "If no incoming source fields are available yet, ask the user to upload or paste .xlsx, .xls, .csv, .tsv, spreadsheet columns, sample rows, JSON, XML, or product fields instead of giving a generic onboarding playbook.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe("Optional case-insensitive search across attribute name, number, group, data type, and unit."),
        group: z
          .string()
          .optional()
          .describe("Optional case-insensitive group filter, for example \"Marketing\" or \"Dimensions\"."),
        dataType: z
          .string()
          .optional()
          .describe("Optional exact data type filter, for example \"text\", \"decimal\", \"single_select\", or \"dictionary\"."),
        includeReadOnly: z
          .boolean()
          .optional()
          .describe("Whether to include read-only definitions (default false)."),
        includeRemoved: z
          .boolean()
          .optional()
          .describe("Whether to include definitions marked to be removed (default false)."),
        includeCompound: z
          .boolean()
          .optional()
          .describe("Whether to include compound definitions (default true)."),
        maxEnumValues: z
          .number()
          .int()
          .min(0)
          .max(100)
          .optional()
          .describe("Maximum enum values to include per select attribute (default 25, max 100). Use 0 to omit enum values."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_DEFINITION_LIMIT)
          .optional()
          .describe(
            `Definitions per page (default ${DEFAULT_DEFINITION_LIMIT}, max ${MAX_DEFINITION_LIMIT}). ` +
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
    async ({
      search,
      group,
      dataType,
      includeReadOnly,
      includeRemoved,
      includeCompound,
      maxEnumValues,
      limit,
      page,
    }) => {
      const effectiveLimit = limit ?? DEFAULT_DEFINITION_LIMIT;
      const effectivePage = page ?? DEFAULT_PAGE;
      const effectiveMaxEnumValues = maxEnumValues ?? 25;
      const shouldIncludeCompound = includeCompound ?? true;

      const data = await mapiGet<MapiAttributeDefinitionsResponse>(
        `${MAPI_PIM_BASE}/definitions`,
        creds
      );

      const filtered = (data.data ?? [])
        .filter((definition) => includeReadOnly || !definition.readOnly)
        .filter((definition) => includeRemoved || !definition.toBeRemoved)
        .filter((definition) => shouldIncludeCompound || !definition.isCompound)
        .filter((definition) =>
          group ? includesSearch(definition.group, group) : true
        )
        .filter((definition) =>
          dataType ? definition.dataType === dataType : true
        )
        .filter((definition) =>
          search
            ? includesSearch(definition.name, search) ||
              includesSearch(definition.number, search) ||
              includesSearch(definition.group, search) ||
              includesSearch(definition.dataType, search) ||
              includesSearch(definition.unit, search)
            : true
        );

      const total = filtered.length;
      const start = (effectivePage - 1) * effectiveLimit;
      const pagedDefinitions = filtered.slice(start, start + effectiveLimit);
      const hasMore = start + pagedDefinitions.length < total;

      const definitions = pagedDefinitions.map((definition) => {
        const enumValues = definition.restrictions?.enum?.values ?? [];
        const enumValuesIncluded = Math.min(enumValues.length, effectiveMaxEnumValues);
        return {
          id: definition.id,
          number: definition.number,
          name: definition.name,
          ...(definition.group && { group: definition.group }),
          ...(definition.groupId && { groupId: definition.groupId }),
          isCompound: definition.isCompound,
          contextAware: definition.contextAware,
          ...(definition.dataType && { dataType: definition.dataType }),
          ...(definition.unit && { unit: definition.unit }),
          ...(definition.contentType && { contentType: definition.contentType }),
          ...(definition.charset && { charset: definition.charset }),
          ...(definition.readOnly && { readOnly: true }),
          ...(definition.internal && { internal: true }),
          ...(definition.externalSource && { externalSource: true }),
          ...(definition.restrictions?.range && { range: definition.restrictions.range }),
          ...(definition.restrictions?.text && { textRestrictions: definition.restrictions.text }),
          ...(definition.restrictions?.enum && {
            enum: {
              ...(definition.restrictions.enum.type && { type: definition.restrictions.enum.type }),
              totalValues: enumValues.length,
              values: enumValues.slice(0, effectiveMaxEnumValues).map((value) => ({
                ...(value.valueId && { valueId: value.valueId }),
                value: value.value,
                ...(value.number && { number: value.number }),
                ...(value.metadata && { metadata: value.metadata }),
              })),
              truncated: enumValues.length > enumValuesIncluded,
            },
          }),
        };
      });

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Found ${total} attribute definition${total === 1 ? "" : "s"} (working state). ` +
              `Returned ${definitions.length} on page ${effectivePage}` +
              (hasMore
                ? `. Call again with page=${effectivePage + 1} to fetch more.`
                : ".") +
              "\n\n" +
              JSON.stringify(
                {
                  filters: {
                    search: search ?? null,
                    group: group ?? null,
                    dataType: dataType ?? null,
                    includeReadOnly: includeReadOnly ?? false,
                    includeRemoved: includeRemoved ?? false,
                    includeCompound: shouldIncludeCompound,
                    maxEnumValues: effectiveMaxEnumValues,
                  },
                  total,
                  page: effectivePage,
                  returned: definitions.length,
                  hasMore,
                  definitions,
                },
                null,
                2
              ),
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
        "List products in a Bluestone PIM catalog, including all sub-categories. " +
        "Returns working state data, including unpublished changes. " +
        "Call list_catalogs first, then pass the catalog id as categoryId. " +
        "Returns product IDs and names only, no attributes. " +
        "Pass categoryName (the catalog name from list_catalogs) so it appears in the response summary. " +
        "After displaying the product list, ask the user if they would like to create a new product in this catalog. " +
        "If they say yes, call create_product and pass the same categoryId so the product is assigned automatically. " +
        "If 0 products are returned and the user expected some, the categoryId may be incorrect. Suggest calling list_catalogs to verify.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: {
        categoryId: z
          .string()
          .describe(
            "The catalog ID from list_catalogs. Pass it directly here to list products in that catalog."
          ),
        categoryName: z
          .string()
          .optional()
          .describe(
            "Human-readable catalog name from list_catalogs. Included in the response summary for context."
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
    async ({ categoryId, categoryName, limit, page, context }) => {
      const effectiveLimit = limit ?? DEFAULT_PRODUCT_LIMIT;
      const effectivePage = page ?? DEFAULT_PAGE;
      const label = categoryName ?? categoryId;
      const effectiveContext = context ?? "en";

      // The category filter body is shared between the search and count calls.
      const filterBody = {
        categoryFilters: [{ categoryId, type: "IN_ANY_CHILD" }],
      };

      // Step 1: Run the paginated search and a total count in parallel.
      // The search response contains only IDs: no total count field.
      // Total comes from a separate /count endpoint with the same filter body.
      const [searchResponse, countResponse] = await Promise.all([
        mapiPostBody<SearchProductsResponse>(
          `${MAPI_SEARCH_BASE}/products/search?archiveState=ACTIVE`,
          { ...filterBody, page: effectivePage - 1, pageSize: effectiveLimit },
          creds,
          { context }
        ),
        mapiPostBody<SearchCountResponse>(
          `${MAPI_SEARCH_BASE}/products/count`,
          filterBody,
          creds,
          { context }
        ),
      ]);

      const productIds = (searchResponse.data ?? []).map((p) => p.id);
      const total = countResponse.count ?? 0;

      if (productIds.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `No products found in "${label}" (working state, context: ${effectiveContext}).\n\n` +
                JSON.stringify(
                  { category: label, context: effectiveContext, total: 0, page: effectivePage, returned: 0, hasMore: false, products: [] },
                  null,
                  2
                ),
            },
          ],
        };
      }

      // Step 2: Resolve IDs to product data via POST /pim/products/list/views/by-ids.
      // Note: the UI uses POST /pim/products/list/by-ids (simpler flat response with name
      // as a plain string) but that endpoint is not in the official PIM API spec.
      // We use list/views/by-ids with the METADATA view instead: name comes back as
      // { value: { en: "...", nl: "..." } } and we extract the requested context key.
      const viewsResponse = await mapiPostBody<MapiProductViewsResponse>(
        `${MAPI_PIM_BASE}/products/list/views/by-ids?archiveState=ACTIVE`,
        {
          ids: productIds,
          views: [{ type: "METADATA" }],
        },
        creds,
        { context }
      );

      const products = (viewsResponse.data ?? []).map((p) => {
        // Extract name for the requested context, falling back to English, then any value.
        const nameValues = p.metadata?.name?.value ?? {};
        const name =
          nameValues[effectiveContext] ??
          nameValues["en"] ??
          Object.values(nameValues)[0] ??
          "";
        return {
          id: p.id,
          name,
          ...(p.metadata?.number && { number: p.metadata.number }),
          ...(p.metadata?.type && { type: p.metadata.type }),
          ...(p.metadata?.state && { state: mapProductState(p.metadata.state) }),
        };
      });

      const returned = products.length;
      const hasMore = total > effectivePage * effectiveLimit;

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Found ${total} product${total === 1 ? "" : "s"} in "${label}" (working state, includes sub-categories, context: ${effectiveContext}). ` +
              `Returned ${returned} on page ${effectivePage}` +
              (hasMore
                ? `. Call again with page=${effectivePage + 1} to fetch more.`
                : ".") +
              "\n\n" +
              JSON.stringify(
                {
                  category: label,
                  context: effectiveContext,
                  total,
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
        "Returns only data that has been synced/published. Does not include unpublished changes. " +
        "Use list_catalogs instead when the user is working on enrichment or wants to see current working state. " +
        "Returns category IDs for use with list_published_products_in_category.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
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
        "Returns only data that has been synced/published. Does not include unpublished changes. " +
        "Use list_products_in_category instead when the user is working on enrichment or wants working state. " +
        "Call list_published_catalogs first to get valid category IDs.\n\n" +
        "Product types in the response: GROUP (parent with variants), VARIANT (child of a GROUP), SINGLE (standalone). " +
        "Each product includes an imageUrl (preview) when a media asset is present. " +
        "When the user asks to see a product image, call get_product_image with that imageUrl. Do not search the web. " +
        "If the requested catalog is not found in the published results, call list_catalogs to check whether it exists in working state, and inform the user it has not been published yet.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
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
            "Human-readable category name from list_published_catalogs. Included in the response summary."
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

      const products = data.results.map((p) => {
        const mainMedia =
          p.media?.find((m) => m.labels.includes("Main")) ?? p.media?.[0];
        return {
          id: p.id,
          name: p.name,
          number: p.number,
          type: p.type,
          ...(mainMedia ? { imageUrl: mainMedia.previewUri } : {}),
        };
      });

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

  // Tool: get_product_image
  server.registerTool(
    "get_product_image",
    {
      description:
        "Fetch and display a product image inline in chat. " +
        "Use the imageUrl returned by list_published_products_in_category. " +
        "Call this when the user asks to see a product image or wants a visual preview. " +
        "Do not call this automatically for every product in a list. Only call it when the user explicitly asks to see an image. " +
        "Do not search the web for product images. Do not use the imageUrl as a markdown image link. Always call this tool. " +
        "The tool result will tell you exactly what to say to the user about where to find the image. " +
        "If the fetch fails, tell the user the image could not be loaded and give them the imageUrl to open directly in their browser.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: {
        imageUrl: z
          .string()
          .url()
          .describe(
            "The preview image URL from list_published_products_in_category (the imageUrl field on a product)."
          ),
        productName: z
          .string()
          .optional()
          .describe("Product name used as alt text. Pass it when available."),
      },
    },
    async ({ imageUrl, productName }) => {
      let res: Response;
      try {
        res = await fetch(imageUrl);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to fetch image: ${message}`);
      }
      if (!res.ok) {
        throw new Error(`Image fetch failed (${res.status}). The URL may have expired or be unavailable.`);
      }
      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
      const name = productName ?? "Product image";

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Image fetched: ${name}.\n\n` +
              `IMPORTANT: You can see this image in your context window, but the user cannot see it inline in the chat. ` +
              `The image is hidden inside a collapsed tool result panel that the user has to manually expand. ` +
              `Do not say "there it is" or imply the image is visible to them. ` +
              `Instead, tell the user they can open the image directly at this URL: ${imageUrl}`,
          },
          {
            type: "image" as const,
            data: base64,
            mimeType,
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
        "The product name is required. Always confirm the name with the user before calling this tool. " +
        "Returns the name and ID of the newly created product. " +
        "If categoryId is provided, the product will also be assigned to that catalog category after creation. " +
        "Category assignment is a separate step: if it fails, the product still exists and the failure is reported separately. " +
        "If product creation itself fails, report the error to the user and do not retry without their confirmation. " +
        "After creating, tell the user the product was created and suggest they open Bluestone PIM to continue enriching it.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe("The product name. Must be confirmed by the user before calling."),
        categoryId: z
          .string()
          .optional()
          .describe(
            "Optional catalog category ID to assign the product to after creation. " +
            "Pass the categoryId from list_products_in_category or list_catalogs."
          ),
      },
    },
    async ({ name, categoryId }) => {
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

      if (categoryId) {
        try {
          await mapiPost<Record<string, unknown>>(
            `/pim/catalogs/nodes/${categoryId}/products`,
            { productId: resourceId },
            creds
          );
          return {
            content: [
              {
                type: "text" as const,
                text: `Product "${name}" created and assigned to catalog category ${categoryId}. ID: ${resourceId}`,
              },
            ],
          };
        } catch (err) {
          // Product was created: report success and note the assignment failure.
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Product "${name}" created successfully. ID: ${resourceId}\n\n` +
                  `Note: category assignment to ${categoryId} failed. You can assign it manually in Bluestone PIM. Error: ${message}`,
              },
            ],
          };
        }
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

