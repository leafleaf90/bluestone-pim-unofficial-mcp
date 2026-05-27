import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  compileProductSearchQuery,
  describeSearchFilters,
  type CategoryScope,
  type ProductSearchFilters,
} from "./query-builder/compile.js";
import { resolveRequirementResults } from "./completeness/resolve-requirements.js";
import {
  buildValidationPresentationHint,
  countValidationIssuesByKind,
  fetchAttributeDefinitionNames,
  shapeValidationIssue,
  type RawValidationIssue,
  type ShapedValidationIssue,
} from "./validation/shape-issues.js";
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
  matrix?: {
    columns?: Array<{ id: string; value: string }>;
    rows?: Array<{ id: string; value: string }>;
  };
}

interface MapiAttributeDefinition {
  id: string;
  name: string;
  number: string;
  groupId?: string;
  group?: string;
  description?: string;
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
  selectedValuesLimit?: number;
  filterParentDefinitionId?: string;
}

interface MapiAttributeDefinitionsResponse {
  data: MapiAttributeDefinition[];
}

interface MapiDictionaryValue {
  id: string;
  definitionId: string;
  number?: string;
  metadata?: string;
  toBeRemoved?: boolean;
  value?: { value: Record<string, string> };
  createdDate?: number;
  lastUpdate?: number;
}

interface MapiDictionaryValuesResponse {
  data: MapiDictionaryValue[];
}

interface MapiDictionaryValueCountResponse {
  count: number;
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

interface MapiRelatedProduct {
  relationId: string;
  relatedId: string;
  reverse?: boolean;
}

interface MapiAttribute {
  definitionId: string;
  values?: string[];
  dictionary?: string[];
  readOnly: boolean;
}

interface MapiProductDetail {
  id: string;
  number?: string;
  name?: string;
  description?: string | null;
  state?: string;
  contextStates?: Record<string, unknown>;
  archived?: boolean;
  lastUpdate?: number;
  createDate?: number;
  dataSynced?: boolean;
  readOnly?: boolean;
  relatedProducts?: MapiRelatedProduct[];
  relatedCategories?: string[];
  attributes?: MapiAttribute[];
  labels?: string[];
  categories?: string[];
  assets?: string[];
  productBundles?: unknown[];
  productVariants?: unknown[];
  variantParentId?: string;
  quantity?: number | null;
  type?: string;
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

interface MapiCompletenessScore {
  entityId: string;
  score: number;
  context: string;
  date: number;
  sourceEventId: string | null;
  validationStatus: string;
  entityLastUpdate: number;
}

interface MapiCompletenessScoresResponse {
  data: MapiCompletenessScore[];
}

interface MapiCompletenessRequirementResult {
  requirementId: string;
  weight: number;
  requirementStatus: string;
}

interface MapiCompletenessScoreDetail {
  entityId: string;
  score: number;
  context: string;
  date: number;
  sourceEventId: string | null;
  requirementsResults: MapiCompletenessRequirementResult[];
  pimLastUpdate: number;
}

interface QueryBuilderSearchResponse {
  data: Array<{ id: string }>;
  errors?: Array<{
    errorType: string;
    message: string;
    location?: string;
  }>;
}

interface QueryBuilderCountResponse {
  count: number;
}

interface MapiCategoryAttributeMetadata {
  assignedOn?: string;
  attributeDefinitionId: string;
  attributeDefinitionName?: string;
  attributeValue?: string;
  copySetOn?: string;
  lockedSetOn?: string;
  mandatorySetOn?: string;
  column?: Record<string, string>;
  matrix?: Record<string, Record<string, string>>;
  readOnly?: boolean;
}

interface MapiCategoryAttributesMetadataResponse {
  data: MapiCategoryAttributeMetadata[];
}

interface MapiCategoryBasic {
  id: string;
  name?: string;
  number?: string;
  description?: string;
}

interface MapiCategoryBasicListResponse {
  data: MapiCategoryBasic[];
}

interface MapiProductVariantAttribute {
  copy?: boolean;
  locked?: boolean;
  mandatory?: boolean;
  definingAttributes?: boolean;
}

interface MapiProductValidationIssuesListResponse {
  data: RawValidationIssue[];
}

interface MapiBulkValidationListResponse {
  data: Array<{
    entityId: string;
    validations: RawValidationIssue[];
  }>;
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
const MAPI_COMPLETENESS_SCORE_BASE = `${API_BASE}/completeness-score`;
const MAPI_QUERY_BUILDER_BASE = `${API_BASE}/query-builder`;
const MAPI_TOKEN_URL = IS_PRODUCTION
  ? "https://idp.bluestonepim.com/op/token"
  : "https://idp.test.bluestonepim.com/op/token";

const DEFAULT_PRODUCT_LIMIT = 50;
const MAX_PRODUCT_LIMIT = 200;
const DEFAULT_DEFINITION_LIMIT = 100;
const MAX_DEFINITION_LIMIT = 500;
const MAX_DEFINITION_ENUM_DETAIL = 500;
const DEFAULT_CATEGORY_LIMIT = 200;
const MAX_CATEGORY_LIMIT = 500;
const DEFAULT_PAGE = 1;
const DEFAULT_COMPLETENESS_LIMIT = 100;
const MAX_COMPLETENESS_LIMIT = 500;
const MAX_COMPLETENESS_PRODUCT_IDS = 100;
const MAX_VALIDATION_PRODUCT_IDS = 100;
const MAX_VLA_ATTRIBUTE_PROBE = 50;
const DEFAULT_CLA_CATEGORY_LIMIT = 50;
const MAX_CLA_CATEGORY_LIMIT = 1000;
const MAPI_DEFINITIONS_FETCH_PAGE_SIZE = 1000;
const DEFAULT_DICTIONARY_VALUE_LIMIT = 100;
const MAX_DICTIONARY_VALUE_LIMIT = 500;

const ATTRIBUTE_DATA_TYPES = [
  "boolean",
  "integer",
  "decimal",
  "date",
  "time",
  "date_time",
  "location",
  "single_select",
  "multi_select",
  "text",
  "formatted_text",
  "pattern",
  "multiline",
  "column",
  "matrix",
  "dictionary",
] as const;

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

async function mapiPatch(
  path: string,
  body: unknown,
  creds: Credentials
): Promise<void> {
  const token = await getBearerToken(creds);
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
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
}

async function mapiPut<T>(
  path: string,
  body: unknown,
  creds: Credentials,
  options?: { context?: string }
): Promise<T> {
  const token = await getBearerToken(creds);
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    "context-fallback": "true",
  };
  if (options?.context) {
    headers["context"] = options.context;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(mapiErrorMessage(res.status, text));
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
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
  options?: {
    context?: string;
    query?: Record<string, string | number | boolean | undefined>;
  }
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
  let requestUrl = url;
  if (options?.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) {
        params.set(key, String(value));
      }
    }
    const queryString = params.toString();
    if (queryString) {
      requestUrl += `${url.includes("?") ? "&" : "?"}${queryString}`;
    }
  }
  const res = await fetch(requestUrl, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(mapiErrorMessage(res.status, body));
  }
  return res.json() as Promise<T>;
}

async function mapiGetFull<T>(
  url: string,
  creds: Credentials,
  options?: { context?: string }
): Promise<T> {
  const token = await getBearerToken(creds);
  const headers: Record<string, string> = {
    accept: "application/full+json",
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

async function mapiGetOptional<T>(
  url: string,
  creds: Credentials,
  options?: {
    context?: string;
    query?: Record<string, string | number | boolean | undefined>;
  }
): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const token = await getBearerToken(creds);
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "context-fallback": "true",
  };
  if (options?.context) {
    headers["context"] = options.context;
  }
  let requestUrl = url;
  if (options?.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) {
        params.set(key, String(value));
      }
    }
    const queryString = params.toString();
    if (queryString) {
      requestUrl += `${url.includes("?") ? "&" : "?"}${queryString}`;
    }
  }
  const res = await fetch(requestUrl, { headers });
  if (res.status === 404) {
    return { ok: false, status: 404 };
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(mapiErrorMessage(res.status, body));
  }
  return { ok: true, data: (await res.json()) as T };
}

function shapeCategoryLevelAttribute(attribute: MapiCategoryAttributeMetadata) {
  return {
    definitionId: attribute.attributeDefinitionId,
    name: attribute.attributeDefinitionName ?? attribute.attributeDefinitionId,
    ...(attribute.attributeValue !== undefined && { value: attribute.attributeValue }),
    propagated: Boolean(attribute.copySetOn),
    locked: Boolean(attribute.lockedSetOn),
    mandatory: Boolean(attribute.mandatorySetOn),
    ...(attribute.column &&
      Object.keys(attribute.column).length > 0 && { column: attribute.column }),
    ...(attribute.matrix &&
      Object.keys(attribute.matrix).length > 0 && { matrix: attribute.matrix }),
  };
}

async function shapeProductValidationIssues(
  issues: RawValidationIssue[],
  creds: Credentials
): Promise<ShapedValidationIssue[]> {
  const definitionIds = issues
    .map((issue) => issue.validationDetails?.definitionId)
    .filter((value): value is string => typeof value === "string");
  const nameByDefinitionId = await fetchAttributeDefinitionNames(
    definitionIds,
    creds,
    mapiGet,
    MAPI_PIM_BASE
  );
  return issues.map((issue) => shapeValidationIssue(issue, nameByDefinitionId));
}

function validationIssuesSummaryText(
  issueCount: number,
  issuesByKind: Record<string, number>
): string {
  if (issueCount === 0) {
    return "No validation issues.";
  }
  const parts: string[] = [];
  if (issuesByKind.CLA > 0) {
    parts.push(`${issuesByKind.CLA} CLA`);
  }
  if (issuesByKind.VLA > 0) {
    parts.push(`${issuesByKind.VLA} VLA`);
  }
  const other =
    issueCount - (issuesByKind.CLA ?? 0) - (issuesByKind.VLA ?? 0);
  if (other > 0) {
    parts.push(`${other} other`);
  }
  return parts.join(", ");
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

// Map raw API state values to the labels shown in the Bluestone PIM UI.
function mapProductState(state: string): string {
  const states: Record<string, string> = {
    PLAYGROUND_ONLY: "Draft",
  };
  return states[state] ?? state;
}

function computeCompletenessSummary(
  scores: number[],
  options?: { filterMin?: number; filterMax?: number }
): {
  totalWithScores: number;
  atZero: number;
  partial: number;
  fullyComplete: number;
  averageScore: number | null;
  filterMin: number | null;
  filterMax: number | null;
} {
  const filterMin = options?.filterMin ?? null;
  const filterMax = options?.filterMax ?? null;
  let atZero = 0;
  let partial = 0;
  let fullyComplete = 0;
  let scoreSum = 0;

  for (const score of scores) {
    scoreSum += score;
    if (score === 0) {
      atZero += 1;
    } else if (score === 100) {
      fullyComplete += 1;
    } else {
      partial += 1;
    }
  }

  return {
    totalWithScores: scores.length,
    atZero,
    partial,
    fullyComplete,
    averageScore: scores.length > 0 ? Math.round(scoreSum / scores.length) : null,
    filterMin,
    filterMax,
  };
}

function productNumberConflictMessage(error: unknown, number: string): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const match = error.message.match(/Bluestone MAPI error 409:\s*(\{[\s\S]*\})/);
  if (!match) {
    return null;
  }
  try {
    const body = JSON.parse(match[1]) as {
      error?: string;
      conflictingEntities?: Array<{ entityId?: string }>;
    };
    if (!body.error?.includes(`Product with number '${number}' already defined`)) {
      return null;
    }
    const existingProductId = body.conflictingEntities?.[0]?.entityId;
    return (
      `Cannot create product with number "${number}" because that number already exists in Bluestone PIM` +
      (existingProductId ? ` on product ${existingProductId}` : "") +
      ". This onboarding flow is currently create-only, not update or upsert. Review the existing product before deciding whether to skip it or handle it in a future update flow."
    );
  } catch {
    return null;
  }
}

function includesSearch(value: string | undefined, search: string): boolean {
  return (value ?? "").toLowerCase().includes(search.toLowerCase());
}

function shapeAttributeDefinition(
  definition: MapiAttributeDefinition,
  maxEnumValues?: number
): Record<string, unknown> {
  const enumRestrictions = definition.restrictions?.enum;
  const includeEnum = enumRestrictions && maxEnumValues !== 0;
  const enumValues = enumRestrictions?.values ?? [];
  const enumLimit =
    maxEnumValues === undefined ? enumValues.length : Math.min(enumValues.length, maxEnumValues);
  const matrix = definition.restrictions?.matrix;

  return {
    id: definition.id,
    number: definition.number,
    name: definition.name,
    ...(definition.description && { description: definition.description }),
    ...(definition.group && { group: definition.group }),
    ...(definition.groupId && { groupId: definition.groupId }),
    isCompound: definition.isCompound,
    contextAware: definition.contextAware,
    ...(definition.dataType && { dataType: definition.dataType }),
    ...(definition.unit && { unit: definition.unit }),
    ...(definition.contentType && { contentType: definition.contentType }),
    ...(definition.charset && { charset: definition.charset }),
    ...(definition.selectedValuesLimit !== undefined && {
      selectedValuesLimit: definition.selectedValuesLimit,
    }),
    ...(definition.filterParentDefinitionId && {
      filterParentDefinitionId: definition.filterParentDefinitionId,
    }),
    ...(definition.readOnly && { readOnly: true }),
    ...(definition.internal && { internal: true }),
    ...(definition.externalSource && { externalSource: true }),
    ...(definition.toBeRemoved && { toBeRemoved: true }),
    ...(definition.restrictions?.range && { range: definition.restrictions.range }),
    ...(definition.restrictions?.text && { textRestrictions: definition.restrictions.text }),
    ...(matrix && {
      matrix: {
        columns: matrix.columns ?? [],
        rows: matrix.rows ?? [],
      },
    }),
    ...(includeEnum && enumRestrictions && {
      enum: {
        ...(enumRestrictions.type && { type: enumRestrictions.type }),
        totalValues: enumValues.length,
        values: enumValues.slice(0, enumLimit).map((value) => ({
          ...(value.valueId && { valueId: value.valueId }),
          value: value.value,
          ...(value.number && { number: value.number }),
          ...(value.metadata && { metadata: value.metadata }),
        })),
        ...(enumValues.length > enumLimit && { truncated: true }),
      },
    }),
    ...(definition.dataType === "dictionary" && {
      dictionaryValuesNote:
        "Dictionary allowed values are not included in this response. Call list_dictionary_values to browse values or get_dictionary_value for one value.",
    }),
  };
}

function applyAttributeDefinitionClientFilters(
  definitions: MapiAttributeDefinition[],
  options: {
    search?: string;
    group?: string;
    dataType?: string;
    includeReadOnly?: boolean;
    includeRemoved?: boolean;
    includeCompound?: boolean;
  }
): MapiAttributeDefinition[] {
  const shouldIncludeCompound = options.includeCompound ?? true;

  return definitions
    .filter((definition) => options.includeReadOnly || !definition.readOnly)
    .filter((definition) => options.includeRemoved || !definition.toBeRemoved)
    .filter((definition) => shouldIncludeCompound || !definition.isCompound)
    .filter((definition) =>
      options.group ? includesSearch(definition.group, options.group) : true
    )
    .filter((definition) =>
      options.dataType ? definition.dataType === options.dataType : true
    )
    .filter((definition) =>
      options.search
        ? includesSearch(definition.name, options.search) ||
          includesSearch(definition.number, options.search) ||
          includesSearch(definition.group, options.search) ||
          includesSearch(definition.dataType, options.search) ||
          includesSearch(definition.unit, options.search)
        : true
    );
}

async function fetchAllAttributeDefinitions(
  creds: Credentials,
  options?: { includeRemoved?: boolean; context?: string }
): Promise<MapiAttributeDefinition[]> {
  const allDefinitions: MapiAttributeDefinition[] = [];
  let page = 0;

  while (true) {
    const response = await mapiGet<MapiAttributeDefinitionsResponse>(
      `${MAPI_PIM_BASE}/definitions`,
      creds,
      {
        context: options?.context,
        query: {
          page,
          pageSize: MAPI_DEFINITIONS_FETCH_PAGE_SIZE,
          ...(options?.includeRemoved ? {} : { excludeToBeRemoved: true }),
        },
      }
    );
    const batch = response.data ?? [];
    allDefinitions.push(...batch);
    if (batch.length < MAPI_DEFINITIONS_FETCH_PAGE_SIZE) {
      break;
    }
    page += 1;
  }

  return allDefinitions;
}

function resolveMultiLanguageValue(
  value: { value?: Record<string, string> } | undefined,
  context: string
): string {
  const values = value?.value ?? {};
  return values[context] ?? values.en ?? Object.values(values)[0] ?? "";
}

function shapeDictionaryValue(
  value: MapiDictionaryValue,
  context: string
): Record<string, unknown> {
  const label = resolveMultiLanguageValue(value.value, context);
  return {
    id: value.id,
    value: label,
    ...(value.number && { number: value.number }),
    ...(value.metadata && { metadata: value.metadata }),
    ...(value.toBeRemoved && { toBeRemoved: true }),
    ...(value.lastUpdate && { lastUpdate: value.lastUpdate }),
    ...(value.createdDate && { createdDate: value.createdDate }),
  };
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
        "Unofficial Bluestone PIM MCP - Beta / Bluestone PIM Labs\n\n" +
        "This is an early Bluestone PIM Labs community MCP integration for Bluestone PIM. It is currently limited.\n\n" +
        "What it can do right now:\n" +
        "- List available language/market contexts (list_contexts)\n" +
        "- List all catalogs, working state (list_catalogs)\n" +
        "- List category trees within a catalog for onboarding and placement decisions (list_category_tree)\n" +
        "- List attribute definitions for product data onboarding and field mapping (list_attribute_definitions)\n" +
        "- Fetch full detail for one attribute definition (get_attribute_definition)\n" +
        "- List dictionary values for a dictionary attribute (list_dictionary_values)\n" +
        "- Fetch one dictionary value by ID (get_dictionary_value)\n" +
        "- List products in a catalog including all sub-categories, working state (list_products_in_category)\n" +
        "- Search and filter products by completeness score, category scope, or failing requirements (search_products)\n" +
        "- Fetch full product detail including attributes, categories, assets, and relations (get_product)\n" +
        "- Read product completeness scores by context (list_product_completeness_scores)\n" +
        "- Fetch completeness requirement breakdown for one product and context (get_product_completeness_detail)\n" +
        "- List category level attributes on a catalog node (list_category_level_attributes)\n" +
        "- Find categories using an attribute as a CLA (list_categories_with_cla)\n" +
        "- List variant level attributes on a variant group (list_variant_level_attributes)\n" +
        "- Fetch variant level attribute settings for one attribute on a group (get_variant_level_attribute)\n" +
        "- Read product validation issues for sync/data quality (get_product_validation_issues, list_product_validation_issues)\n" +
        "- List published catalogs only (list_published_catalogs)\n" +
        "- List published products in a category, includes image URL per product (list_published_products_in_category)\n" +
        "- Fetch and display a product image inline (get_product_image)\n" +
        "- Create an attribute definition with name, data type, optional unit, and required initial enum values for select attributes (create_attribute_definition)\n" +
        "- Create a dictionary value for a dictionary attribute definition (create_dictionary_value)\n" +
        "- Append values to single_select and multi_select attribute definitions (append_select_attribute_values)\n" +
        "- Create a catalog category node with optional parent category (create_category_node)\n" +
        "- Create a new product by name, optionally assigned to a catalog category (create_product)\n" +
        "- Add an attribute value to a product (set_product_attribute)\n" +
        "- Assign an existing product to a catalog category (assign_product_to_category)\n" +
        "- Rename an existing product (update_product_name)\n\n" +
        "What it cannot do yet:\n" +
        "- Search products by attribute values, labels, relations, assets, or other advanced query-builder filters\n" +
        "- Set product media\n" +
        "- Create validation restrictions or attribute groups\n" +
        "- Delete products\n\n" +
        "Completeness scores: when the user asks whether a specific product is complete, what its completeness score is, or wants scores for known product IDs, call list_product_completeness_scores. " +
        "When the user wants to list or filter products by completeness score across a catalog or the whole organisation, for example all products below 80%, all complete products, or products in a category under a threshold, call search_products. " +
        "When the user then asks what is missing, which requirements failed, or wants a requirement breakdown for one product in one context, call get_product_completeness_detail. " +
        "Do not use list_products_in_category followed by manual score filtering as a workaround for completeness searches.\n\n" +
        "Completeness search presentation: when search_products returns multiple products with completeness scores, " +
        "do NOT reply with a plain markdown table in chat. " +
        "In Cursor, open a Canvas beside the chat with summary stat cards (total matching, count at 0%, count partially filled in the filtered range), " +
        "a filterable product table, color-coded type badges (single, variant, group), and horizontal completeness progress bars with percentages. " +
        "Keep chat to a short intro and point the user to the canvas. " +
        "Use score color bands: below 70% red, 70 to 89% orange, 90% and above green. " +
        "When the user asks what is missing, present get_product_completeness_detail results in a canvas with MISSING and PASSING requirement cards. " +
        "For one to three products, a concise inline summary is fine.\n\n" +
        "Validation vs completeness: completeness scores measure requirement pass/fail and produce a 0 to 100% score. " +
        "Validation issues measure sync and data-quality rules, including CLA lock or mandatory violations and VLA inheritance violations. " +
        "When the user asks why a product is invalid, fails sync, or violates category or variant rules, call get_product_validation_issues or list_product_validation_issues. " +
        "When they ask how complete a product is or which completeness requirements failed, call get_product_completeness_detail or search_products. " +
        "Both may be relevant for broad data quality questions.\n\n" +
        "Validation presentation: when get_product_validation_issues or list_product_validation_issues returns more than five issues, " +
        "or list_product_validation_issues finds issues on more than three products, do NOT use a plain markdown table in chat. " +
        "In Cursor, open a Canvas with summary stat cards (total issues, CLA count, VLA count, other count), kind filter pills, and issue cards grouped by CLA, VLA, and other. " +
        "Use canvases/bluestone-validation-issues.canvas.tsx as the reference layout. Keep chat to a short intro and point the user to the canvas.\n\n" +
        "Working state vs published: the default read tools return working state data, " +
        "which includes unpublished changes and is what enrichment teams work with. " +
        "Use the list_published_* tools when the user specifically asks about live/published data.\n\n" +
        "Context (language/market): read tools accept an optional context parameter. " +
        "If the user asks to see data in a specific language, call list_contexts first to find the right context ID, " +
        "then pass it to subsequent tool calls. The default context is 'en' (English).\n\n" +
        "Always confirm the product name and product number with the user before calling create_product. " +
        "Always confirm the exact missing category name and parent before calling create_category_node. " +
        "Always confirm the exact missing attribute name, data type, unit, and initial enum values for select attributes before calling create_attribute_definition. " +
        "Always confirm the exact dictionary or select values before calling create_dictionary_value or append_select_attribute_values. " +
        "Always confirm the exact product, attribute definition, and values before calling set_product_attribute. " +
        "Always confirm the exact product and target value before calling assign_product_to_category or update_product_name.\n\n" +
        "For any request about product data onboarding, supplier onboarding, importing, bulk import, one-time bulk import, Excel import, CSV import, import planning, supplier data, spreadsheets, CSV files, Excel files, field mapping, attribute mapping, category mapping, preparing products before creation, or misspelled Bluestone references such as Blueston, do not answer from generic onboarding knowledge first. Immediately call list_attribute_definitions, list_catalogs, and list_contexts before responding. " +
        "If the user needs category placement beyond the catalog root, call list_category_tree for the relevant catalog. " +
        "Do not ask the user whether you should pull the current catalogs or data model: use these tools proactively because that is the purpose of this server. " +
        "Use those read-only results to present a suggested mapping with a dedicated product identity section, confident matches, uncertain matches, missing attributes, category suggestions, and validation notes. " +
        "The product identity section must propose the source column to use as product number, the source column to use as product name, confidence for each, and offer the user a chance to choose a different number column. Product number is the unique key used by Bluestone PIM to detect whether a product already exists. " +
        "If the mapping shows that important source fields have no suitable existing attributes or categories, recommend a data-model update or draft a model specification for the user. If the user then approves creating missing simple attributes, category paths, dictionary values, or select values, move into the confirmed write phase and use the MCP write tools for those supported changes. Do not tell the user to create supported simple attributes, dictionary values, select values, or category nodes in the Bluestone UI. " +
        "Only use create_attribute_definition for an onboarding field after list_attribute_definitions has been checked and no suitable existing attribute can be mapped. Do not create duplicate attributes when a suitable existing attribute exists. After the user approves specific missing simple attributes, use create_attribute_definition to create them. Do not offer to create partial sample products as a workaround for missing model structure during phase 1 onboarding. " +
        "Only use create_category_node after list_catalogs and list_category_tree have been checked and the needed category path does not already exist. Do not create duplicate categories when a suitable existing category exists. After the user approves a missing category path, create the missing node or nodes with create_category_node before creating products that should be placed there. " +
        "Only use create_dictionary_value after list_attribute_definitions has shown the target attribute is dataType dictionary and the needed dictionary value does not already exist. Do not create duplicate dictionary values when a suitable existing value exists. " +
        "Only use append_select_attribute_values after list_attribute_definitions has shown the target attribute is dataType single_select or multi_select and the needed enum value does not already exist. This tool performs a guarded read-merge-PUT internally to preserve existing definition fields and enum values. Do not use generic PUT updates for select definitions. " +
        "Keep onboarding replies concise and action-oriented. If the user has not provided source data yet, ask them to upload or paste source data such as .xlsx, .xls, .csv, .tsv, spreadsheet columns, sample rows, JSON, XML, or product fields next. " +
        "Do not produce a long generic onboarding playbook or list import mechanics unless the user explicitly asks for a process, workshop plan, or detailed onboarding guide. " +
        "Do not suggest creating sample products during phase 1 onboarding. Do not create products or change attributes during onboarding unless the user explicitly moves beyond planning and confirms a write action. " +
        "When the user has already answered mapping decisions such as target catalog, number column, existing attribute mappings, missing attribute creation, or missing category placement, summarize the exact writes you can perform and ask for confirmation instead of restarting the planning discussion. " +
        "This MCP server can create simple attribute definitions, dictionary values, select enum values, category nodes, and set product attribute values. It cannot create validation restrictions, attribute groups, advanced model configuration, or media yet. If those are needed, say they must be created outside the current MCP tools, for example in Bluestone PIM by a model administrator or by a separate management API workflow. Do not suggest PAPI for model changes.\n\n" +
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
        "Call this first before browsing products or mapping new product data, supplier onboarding data, spreadsheet rows, CSV rows, Excel rows, bulk import files, or import files to categories. " +
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
        "Use this for product data onboarding, supplier onboarding, bulk import planning, supplier spreadsheets, CSV files, Excel files, and any request where incoming products need to be matched to existing categories. " +
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

  // Tool: create_category_node
  server.registerTool(
    "create_category_node",
    {
      description:
        "Create a new Bluestone PIM catalog category node in working state. " +
        "Use this only after list_catalogs and list_category_tree have shown that the needed category path does not already exist. " +
        "Do not use this to create a duplicate of a suitable existing category. " +
        "For approved onboarding mappings with a missing category, use this tool instead of telling the user to create the category in the Bluestone UI. " +
        "Omit parentId to create a root-level catalog/category node. Pass parentId to create a child category under an existing node. " +
        "Always present the proposed category name and parent category to the user and get explicit confirmation before calling this tool. " +
        "The API uses name validation, so duplicate names under the same parent may be rejected.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe("The category node name. Must be confirmed by the user before calling."),
        parentId: z
          .string()
          .optional()
          .describe(
            "Optional parent category node ID. Get this from list_catalogs or list_category_tree. Omit to create a root-level node."
          ),
        parentName: z
          .string()
          .optional()
          .describe("Human-readable parent category name or path for confirmation context. Pass it when available."),
      },
    },
    async ({ name, parentId, parentName }) => {
      const { resourceId } = await mapiPost<Record<string, unknown>>(
        "/pim/catalogs/nodes?validation=NAME",
        {
          name,
          ...(parentId && { parentId }),
        },
        creds
      );
      if (!resourceId) {
        throw new Error(
          "Category node was created but no resource-id was returned in the response headers."
        );
      }

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Category node "${name}" created successfully. ID: ${resourceId}` +
              (parentId
                ? ` Parent: ${parentName ? `"${parentName}" ` : ""}(${parentId}).`
                : " Created as a root-level node."),
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
        "Use this to browse or search the attribute model, map incoming fields during onboarding, or find a definitionId. " +
        "Returns shaped definition metadata with truncated enum values by default. " +
        "For full detail on one attribute, including all enum values and restrictions, call get_attribute_definition instead. " +
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
      const hasLocalTextFilters = Boolean(search || group || dataType);

      let definitionsSource: MapiAttributeDefinition[];
      let total: number;
      let pagedDefinitions: MapiAttributeDefinition[];
      let hasMore: boolean;

      if (hasLocalTextFilters) {
        const allDefinitions = await fetchAllAttributeDefinitions(creds, { includeRemoved });
        const filtered = applyAttributeDefinitionClientFilters(allDefinitions, {
          search,
          group,
          dataType,
          includeReadOnly,
          includeRemoved,
          includeCompound: shouldIncludeCompound,
        });
        total = filtered.length;
        const start = (effectivePage - 1) * effectiveLimit;
        pagedDefinitions = filtered.slice(start, start + effectiveLimit);
        hasMore = start + pagedDefinitions.length < total;
        definitionsSource = pagedDefinitions;
      } else {
        const response = await mapiGet<MapiAttributeDefinitionsResponse>(
          `${MAPI_PIM_BASE}/definitions`,
          creds,
          {
            query: {
              page: effectivePage - 1,
              pageSize: effectiveLimit,
              ...(includeRemoved ? {} : { excludeToBeRemoved: true }),
            },
          }
        );
        const filtered = applyAttributeDefinitionClientFilters(response.data ?? [], {
          includeReadOnly,
          includeRemoved,
          includeCompound: shouldIncludeCompound,
        });
        definitionsSource = filtered;
        total = filtered.length;
        hasMore = (response.data ?? []).length === effectiveLimit;
      }

      const definitions = definitionsSource.map((definition) =>
        shapeAttributeDefinition(definition, effectiveMaxEnumValues)
      );

      const summaryText = hasLocalTextFilters
        ? `Found ${total} attribute definition${total === 1 ? "" : "s"} (working state). Returned ${definitions.length} on page ${effectivePage}`
        : `Returned ${definitions.length} attribute definition${definitions.length === 1 ? "" : "s"} on page ${effectivePage} (working state)`;

      return {
        content: [
          {
            type: "text" as const,
            text:
              summaryText +
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
                  ...(hasLocalTextFilters && { total }),
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

  // Tool: get_attribute_definition
  server.registerTool(
    "get_attribute_definition",
    {
      description:
        "Fetch full working-state detail for one attribute definition. " +
        "Use this when the user asks about a specific attribute, needs all enum values, or wants restrictions for one field. " +
        "Call list_attribute_definitions first to find the definitionId when the user names an attribute but has not given an ID. " +
        "Also use this after get_product or get_product_completeness_detail when you need to resolve one definitionId to its name, data type, unit, or enum values. " +
        "Dictionary attributes do not include allowed values here. Call list_dictionary_values to browse values or get_dictionary_value for one value. " +
        "Suppress raw IDs in user-facing replies unless the user asks for implementation detail or a write action needs exact IDs.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: {
        definitionId: z
          .string()
          .describe(
            "The attribute definition ID. Get this from list_attribute_definitions, get_product, get_product_completeness_detail, or create_attribute_definition."
          ),
        attributeName: z
          .string()
          .optional()
          .describe("Human-readable attribute name for the response summary. Pass it when available."),
        maxEnumValues: z
          .number()
          .int()
          .min(0)
          .max(MAX_DEFINITION_ENUM_DETAIL)
          .optional()
          .describe(
            `Maximum enum values to return for select attributes (default all, max ${MAX_DEFINITION_ENUM_DETAIL}). Use 0 to omit enum values.`
          ),
        context: z
          .string()
          .optional()
          .describe(
            "Language/market context ID (e.g. \"en\", \"l3600\"). " +
            "Call list_contexts to see available values. Defaults to English if omitted."
          ),
      },
    },
    async ({ definitionId, attributeName, maxEnumValues, context }) => {
      const effectiveContext = context ?? "en";
      const definition = await mapiGet<MapiAttributeDefinition>(
        `${MAPI_PIM_BASE}/definitions/${definitionId}`,
        creds,
        { context }
      );

      const shaped = shapeAttributeDefinition(
        definition,
        maxEnumValues === 0 ? 0 : maxEnumValues
      );
      const label = attributeName ?? definition.name ?? definitionId;
      const enumTotal =
        typeof shaped.enum === "object" &&
        shaped.enum !== null &&
        "totalValues" in shaped.enum &&
        typeof shaped.enum.totalValues === "number"
          ? shaped.enum.totalValues
          : 0;

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Fetched attribute definition "${label}" (working state, context: ${effectiveContext}). ` +
              `Type: ${definition.dataType ?? "unknown"}` +
              (definition.unit ? `, unit: ${definition.unit}` : "") +
              (enumTotal > 0 ? `, ${enumTotal} enum value${enumTotal === 1 ? "" : "s"}` : "") +
              ".\n\n" +
              JSON.stringify(
                {
                  context: effectiveContext,
                  definition: shaped,
                },
                null,
                2
              ),
          },
        ],
      };
    }
  );

  // Tool: list_dictionary_values
  server.registerTool(
    "list_dictionary_values",
    {
      description:
        "List allowed values for a dictionary attribute definition. " +
        "Use this before create_dictionary_value to check whether a value already exists, during onboarding mapping, or when the user asks for dictionary options. " +
        "Call list_attribute_definitions or get_attribute_definition first to verify the attribute has dataType dictionary and to get dictionaryId. " +
        "For one known valueId from get_product, call get_dictionary_value instead. " +
        "Suppress raw value IDs in user-facing replies unless the user asks for implementation detail or a write action needs exact IDs.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: {
        dictionaryId: z
          .string()
          .describe(
            "The dictionary attribute definition ID from list_attribute_definitions or get_attribute_definition for an attribute with dataType dictionary."
          ),
        dictionaryName: z
          .string()
          .optional()
          .describe("Human-readable dictionary attribute name for the response summary."),
        search: z
          .string()
          .optional()
          .describe("Optional case-insensitive search across dictionary value label and number."),
        includeRemoved: z
          .boolean()
          .optional()
          .describe("Whether to include values marked to be removed (default false)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_DICTIONARY_VALUE_LIMIT)
          .optional()
          .describe(
            `Dictionary values per page (default ${DEFAULT_DICTIONARY_VALUE_LIMIT}, max ${MAX_DICTIONARY_VALUE_LIMIT}). ` +
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
            "Language/market context ID for value labels (e.g. \"en\"). " +
            "Call list_contexts to see available values. Defaults to English if omitted."
          ),
      },
    },
    async ({ dictionaryId, dictionaryName, search, includeRemoved, limit, page, context }) => {
      const effectiveLimit = limit ?? DEFAULT_DICTIONARY_VALUE_LIMIT;
      const effectivePage = page ?? DEFAULT_PAGE;
      const effectiveContext = context ?? "en";
      const dictionaryLabel = dictionaryName ?? dictionaryId;
      const excludeToBeRemoved = includeRemoved ? false : true;
      const listQuery = excludeToBeRemoved ? "?excludeToBeRemoved=true" : "";
      const listUrl = `${MAPI_PIM_BASE}/definitions/dictionary/${dictionaryId}/values/list${listQuery}`;
      const countUrl = `${MAPI_PIM_BASE}/definitions/dictionary/${dictionaryId}/values/count${listQuery}`;

      if (search) {
        const allValues: MapiDictionaryValue[] = [];
        let apiPage = 0;

        while (true) {
          const response = await mapiPostBody<MapiDictionaryValuesResponse>(
            listUrl,
            { page: apiPage, pageSize: MAPI_DEFINITIONS_FETCH_PAGE_SIZE },
            creds,
            { context }
          );
          const batch = response.data ?? [];
          allValues.push(...batch);
          if (batch.length < MAPI_DEFINITIONS_FETCH_PAGE_SIZE) {
            break;
          }
          apiPage += 1;
        }

        const filtered = allValues.filter((entry) => {
          const label = resolveMultiLanguageValue(entry.value, effectiveContext);
          return (
            includesSearch(label, search) ||
            includesSearch(entry.number, search)
          );
        });
        const total = filtered.length;
        const start = (effectivePage - 1) * effectiveLimit;
        const pagedValues = filtered.slice(start, start + effectiveLimit);
        const values = pagedValues.map((entry) => shapeDictionaryValue(entry, effectiveContext));
        const hasMore = start + pagedValues.length < total;

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Found ${total} dictionary value${total === 1 ? "" : "s"} for "${dictionaryLabel}" matching "${search}" (working state, context: ${effectiveContext}). ` +
                `Returned ${values.length} on page ${effectivePage}` +
                (hasMore
                  ? `. Call again with page=${effectivePage + 1} to fetch more.`
                  : ".") +
                "\n\n" +
                JSON.stringify(
                  {
                    dictionary: dictionaryLabel,
                    context: effectiveContext,
                    search,
                    total,
                    page: effectivePage,
                    returned: values.length,
                    hasMore,
                    values,
                  },
                  null,
                  2
                ),
            },
          ],
        };
      }

      const listBody = { page: effectivePage - 1, pageSize: effectiveLimit };
      const countBody = { page: 0, pageSize: 1 };

      const [listResponse, countResponse] = await Promise.all([
        mapiPostBody<MapiDictionaryValuesResponse>(listUrl, listBody, creds, { context }),
        mapiPostBody<MapiDictionaryValueCountResponse>(countUrl, countBody, creds, { context }),
      ]);

      const total = countResponse.count ?? 0;
      const values = (listResponse.data ?? []).map((entry) =>
        shapeDictionaryValue(entry, effectiveContext)
      );
      const hasMore = effectivePage * effectiveLimit < total;

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Found ${total} dictionary value${total === 1 ? "" : "s"} for "${dictionaryLabel}" (working state, context: ${effectiveContext}). ` +
              `Returned ${values.length} on page ${effectivePage}` +
              (hasMore
                ? `. Call again with page=${effectivePage + 1} to fetch more.`
                : ".") +
              "\n\n" +
              JSON.stringify(
                {
                  dictionary: dictionaryLabel,
                  context: effectiveContext,
                  total,
                  page: effectivePage,
                  returned: values.length,
                  hasMore,
                  values,
                },
                null,
                2
              ),
          },
        ],
      };
    }
  );

  // Tool: get_dictionary_value
  server.registerTool(
    "get_dictionary_value",
    {
      description:
        "Fetch one dictionary value for a dictionary attribute definition. " +
        "Use this when get_product returns a dictionary valueId and you need the human-readable label. " +
        "Call list_dictionary_values to browse all values or check whether a label already exists before create_dictionary_value. " +
        "Suppress raw IDs in user-facing replies unless the user asks for implementation detail.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: {
        dictionaryId: z
          .string()
          .describe(
            "The dictionary attribute definition ID from list_attribute_definitions or get_attribute_definition."
          ),
        valueId: z
          .string()
          .describe("The dictionary value ID from get_product, list_dictionary_values, or create_dictionary_value."),
        dictionaryName: z
          .string()
          .optional()
          .describe("Human-readable dictionary attribute name for the response summary."),
        context: z
          .string()
          .optional()
          .describe(
            "Language/market context ID for the value label (e.g. \"en\"). Defaults to English if omitted."
          ),
      },
    },
    async ({ dictionaryId, valueId, dictionaryName, context }) => {
      const effectiveContext = context ?? "en";
      const value = await mapiGet<MapiDictionaryValue>(
        `${MAPI_PIM_BASE}/definitions/dictionary/${dictionaryId}/values/${valueId}`,
        creds,
        { context }
      );
      const shaped = shapeDictionaryValue(value, effectiveContext);
      const dictionaryLabel = dictionaryName ?? dictionaryId;

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Fetched dictionary value "${shaped.value}" for "${dictionaryLabel}" (working state, context: ${effectiveContext}).\n\n` +
              JSON.stringify(
                {
                  dictionary: dictionaryLabel,
                  context: effectiveContext,
                  value: shaped,
                },
                null,
                2
              ),
          },
        ],
      };
    }
  );

  // Tool: create_attribute_definition
  server.registerTool(
    "create_attribute_definition",
    {
      description:
        "Create a new attribute definition in the Bluestone PIM working-state data model. " +
        "Use this only after list_attribute_definitions has shown that an onboarding source field has no suitable existing attribute. " +
        "Do not use this to create an alternative to a suitable existing attribute. " +
        "For approved onboarding mappings with a missing simple attribute, use this tool instead of telling the user to create the attribute in the Bluestone UI. " +
        "Always present the proposed attribute name, data type, unit, and initial enum values if relevant, then get explicit confirmation before calling this tool. " +
        "For single_select and multi_select, enumValues is required because Bluestone rejects select attributes without enum restrictions at creation time. " +
        "Do not fall back from single_select or multi_select to text unless the user explicitly approves that data type change. " +
        "This tool creates the definition with name, dataType, optional unit, and initial enum values for select attributes. " +
        "It does not create dictionary values, validation restrictions, groups, category nodes, or product attribute values. " +
        "After creating the attribute definition, return the new ID and tell the user it can be used with set_product_attribute.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe("The attribute definition name. Must be confirmed by the user before calling."),
        dataType: z
          .enum(ATTRIBUTE_DATA_TYPES)
          .describe(
            "The attribute data type. Supported values: " +
            ATTRIBUTE_DATA_TYPES.join(", ") +
            ". Must be confirmed by the user before calling."
          ),
        unit: z
          .string()
          .optional()
          .describe("Optional unit, for example kg, mm, kW, m3/h, or years. Omit when the attribute has no unit."),
        enumValues: z
          .array(
            z.object({
              value: z
                .string()
                .min(1)
                .describe("Enum value label to create on the select attribute."),
              number: z
                .string()
                .optional()
                .describe("Optional enum value number. Omit to let Bluestone generate or default it."),
              metadata: z
                .string()
                .optional()
                .describe("Optional metadata, for example a color hex code for color select values."),
            })
          )
          .min(1)
          .max(50)
          .optional()
          .describe("Required for single_select and multi_select attributes. Initial enum values confirmed by the user."),
      },
    },
    async ({ name, dataType, unit, enumValues }) => {
      const isSelect = dataType === "single_select" || dataType === "multi_select";
      if (isSelect && !enumValues?.length) {
        throw new Error(
          `Cannot create ${dataType} attribute "${name}" without initial enum values. Ask the user to confirm the allowed values, or explicitly approve a different data type. Do not fall back to text automatically.`
        );
      }
      if (!isSelect && enumValues?.length) {
        throw new Error(
          `enumValues can only be used when dataType is single_select or multi_select. Confirm the intended data type before creating "${name}".`
        );
      }

      const body = {
        dataType,
        name,
        ...(unit && { unit }),
        ...(isSelect && {
          restrictions: {
            enum: {
              values: enumValues?.map((value) => ({
                value: value.value,
                ...(value.number && { number: value.number }),
                ...(value.metadata && { metadata: value.metadata }),
              })),
            },
          },
        }),
      };
      const { resourceId } = await mapiPost<Record<string, unknown>>(
        "/pim/definitions",
        body,
        creds
      );
      if (!resourceId) {
        throw new Error(
          "Attribute definition was created but no resource-id was returned in the response headers."
        );
      }

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Attribute definition "${name}" created successfully. ID: ${resourceId}. ` +
              `Data type: ${dataType}${unit ? `, unit: ${unit}` : ""}` +
              (isSelect ? `, enum values: ${enumValues?.length ?? 0}` : "") +
              ".",
          },
        ],
      };
    }
  );

  // Tool: create_dictionary_value
  server.registerTool(
    "create_dictionary_value",
    {
      description:
        "Create a new value for a dictionary attribute definition in Bluestone PIM. " +
        "Use list_attribute_definitions or get_attribute_definition first to verify the target definition exists and has dataType dictionary. " +
        "Use list_dictionary_values to check whether the value already exists before creating a duplicate. " +
        "Use this only when an onboarding value cannot be mapped to an existing dictionary value. " +
        "Do not use this to create a duplicate of a suitable existing dictionary value. " +
        "Always present the dictionary attribute and new value to the user and get explicit confirmation before calling this tool. " +
        "After creating the dictionary value, use the returned ID as the value when calling set_product_attribute for that dictionary attribute.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
      inputSchema: {
        dictionaryId: z
          .string()
          .describe("The dictionary attribute definition ID. Get this from list_attribute_definitions for an attribute with dataType dictionary."),
        value: z
          .string()
          .min(1)
          .describe("The dictionary value label to create. Must be confirmed by the user before calling."),
        dictionaryName: z
          .string()
          .optional()
          .describe("Human-readable dictionary attribute name for confirmation context. Pass it when available."),
      },
    },
    async ({ dictionaryId, value, dictionaryName }) => {
      const { resourceId } = await mapiPost<Record<string, unknown>>(
        `/pim/definitions/dictionary/${dictionaryId}/values`,
        { value },
        creds
      );
      if (!resourceId) {
        throw new Error(
          "Dictionary value was created but no resource-id was returned in the response headers."
        );
      }

      const dictionaryLabel = dictionaryName ? `"${dictionaryName}" (${dictionaryId})` : dictionaryId;

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Dictionary value "${value}" created successfully for ${dictionaryLabel}. ` +
              `ID: ${resourceId}`,
          },
        ],
      };
    }
  );

  // Tool: append_select_attribute_values
  server.registerTool(
    "append_select_attribute_values",
    {
      description:
        "Append new enum values to a single_select or multi_select attribute definition. " +
        "Use list_attribute_definitions first to verify the target definition exists, has dataType single_select or multi_select, and does not already contain the needed values. " +
        "Always present the existing attribute, existing values, and proposed new values to the user and get explicit confirmation before calling this tool. " +
        "This tool is intentionally append-only: it fetches the full current definition, preserves all updateable fields and existing enum values, appends the new values, then sends the merged object with PUT. " +
        "Do not use this to rename, remove, or replace enum values. Do not create duplicates. Do not use generic PUT updates for select definitions.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
      inputSchema: {
        definitionId: z
          .string()
          .describe("The single_select or multi_select attribute definition ID. Get this from list_attribute_definitions."),
        values: z
          .array(
            z.object({
              value: z
                .string()
                .min(1)
                .describe("The display value to append."),
              metadata: z
                .string()
                .optional()
                .describe("Optional metadata, for example a color hex code for color select values."),
              number: z
                .string()
                .optional()
                .describe("Optional select value number. Omit to let Bluestone generate or default it."),
            })
          )
          .min(1)
          .max(50)
          .describe("New enum values to append. Existing enum values are preserved automatically."),
        attributeName: z
          .string()
          .optional()
          .describe("Human-readable attribute name for confirmation context. Pass it when available."),
        context: z
          .string()
          .optional()
          .describe(
            "Language/market context ID (e.g. \"en\", \"l3600\"). " +
            "Call list_contexts to see available values. Defaults to English if omitted."
          ),
      },
    },
    async ({ definitionId, values, attributeName, context }) => {
      const definition = await mapiGet<MapiAttributeDefinition>(
        `${MAPI_PIM_BASE}/definitions/${definitionId}`,
        creds,
        { context }
      );

      if (definition.dataType !== "single_select" && definition.dataType !== "multi_select") {
        throw new Error(
          `Attribute definition ${definitionId} is ${definition.dataType ?? "missing a data type"}, not single_select or multi_select.`
        );
      }

      const existingValues = definition.restrictions?.enum?.values ?? [];
      const existingValueNames = new Set(
        existingValues.map((value) => value.value.trim().toLowerCase())
      );
      const incomingValueNames = new Set<string>();

      for (const value of values) {
        const normalized = value.value.trim().toLowerCase();
        if (existingValueNames.has(normalized)) {
          throw new Error(
            `Enum value "${value.value}" already exists on "${definition.name}". Use the existing value instead of creating a duplicate.`
          );
        }
        if (incomingValueNames.has(normalized)) {
          throw new Error(
            `Enum value "${value.value}" is duplicated in the request. Remove duplicates and try again.`
          );
        }
        incomingValueNames.add(normalized);
      }

      const restrictions: MapiAttributeDefinitionRestrictions = JSON.parse(
        JSON.stringify(definition.restrictions ?? {})
      );
      restrictions.enum = {
        ...(restrictions.enum?.type && { type: restrictions.enum.type }),
        values: [
          ...existingValues.map((value) => ({
            ...(value.valueId && { valueId: value.valueId }),
            value: value.value,
            ...(value.number && { number: value.number }),
            ...(value.metadata && { metadata: value.metadata }),
          })),
          ...values.map((value) => ({
            value: value.value,
            ...(value.number && { number: value.number }),
            ...(value.metadata && { metadata: value.metadata }),
          })),
        ],
      };

      const body = {
        ...(definition.charset !== undefined && { charset: definition.charset }),
        ...(definition.contentType !== undefined && { contentType: definition.contentType }),
        ...(definition.contextAware !== undefined && { contextAware: definition.contextAware }),
        dataType: definition.dataType,
        ...(definition.description !== undefined && { description: definition.description }),
        ...(definition.externalSource !== undefined && { externalSource: definition.externalSource }),
        ...(definition.groupId !== undefined && { groupId: definition.groupId }),
        ...(definition.internal !== undefined && { internal: definition.internal }),
        name: definition.name,
        ...(definition.number !== undefined && { number: definition.number }),
        restrictions,
        ...(definition.unit !== undefined && { unit: definition.unit }),
      };

      await mapiPut<Record<string, unknown>>(
        `/pim/definitions/${definitionId}?validation=NAME`,
        body,
        creds,
        { context }
      );

      const label = attributeName ?? definition.name;
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Appended ${values.length} enum value${values.length === 1 ? "" : "s"} to "${label}" (${definitionId}). ` +
              `Total enum values: ${existingValues.length + values.length}.`,
          },
        ],
      };
    }
  );

  // Tool: set_product_attribute
  server.registerTool(
    "set_product_attribute",
    {
      description:
        "Add an attribute value to an existing Bluestone PIM product. " +
        "Use list_attribute_definitions first to get the definitionId and understand the data type, unit, enum values, and restrictions. " +
        "Use list_products_in_category or create_product to get the productId. " +
        "Always confirm the product, attribute definition, data type, and exact values with the user before calling this tool. " +
        "Values must be strings: decimal values like \"1.5\", boolean values like \"true\" or \"false\", and select values as enum value IDs from the attribute definition. " +
        "For multi_select, pass one string per selected enum value ID. " +
        "Do not call this during phase 1 onboarding mapping. Only call it after the user has approved the mapping and moved to a confirmed write phase.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
      inputSchema: {
        productId: z
          .string()
          .describe("The product ID to enrich. Get this from list_products_in_category or create_product."),
        definitionId: z
          .string()
          .describe("The attribute definition ID. Get this from list_attribute_definitions or create_attribute_definition."),
        values: z
          .array(z.string())
          .min(1)
          .describe(
            "Attribute value strings. Examples: decimal [\"1.5\"], boolean [\"true\"], single_select [\"enumValueId\"], multi_select [\"enumValueId1\", \"enumValueId2\"]."
          ),
        productName: z
          .string()
          .optional()
          .describe("Human-readable product name for confirmation context. Pass it when available."),
        attributeName: z
          .string()
          .optional()
          .describe("Human-readable attribute name for confirmation context. Pass it when available."),
      },
    },
    async ({ productId, definitionId, values, productName, attributeName }) => {
      await mapiPost<Record<string, unknown>>(
        `/pim/products/${productId}/attributes`,
        { definitionId, values },
        creds
      );

      const productLabel = productName ? `"${productName}" (${productId})` : productId;
      const attributeLabel = attributeName ? `"${attributeName}" (${definitionId})` : definitionId;

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Set attribute ${attributeLabel} on product ${productLabel}. ` +
              `Values: ${values.join(", ")}`,
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

  // Tool: search_products
  server.registerTool(
    "search_products",
    {
      description:
        "Search and filter Bluestone PIM products using the query builder. " +
        "Call this when the user wants to list products matching filters across a catalog or the whole organisation, " +
        "for example all products below 80% complete, all fully complete products, incomplete products in a catalog, or products failing specific completeness requirements. " +
        "Do NOT use this for a single known product's score: use list_product_completeness_scores instead. " +
        "Do NOT use list_products_in_category and filter scores manually. " +
        "Call list_catalogs to get categoryId when the user names a catalog. " +
        "Call list_contexts when the user asks about a specific language or market. " +
        "Completeness score filters require completenessContext. " +
        "Requirement ID filters require failingRequirementIds from get_product_completeness_detail. " +
        "Set includeCompletenessScores when the user wants scores shown alongside each result. Scores are included automatically when filtering by completeness score or failing requirements. " +
        "This tool does not support attribute, label, relation, or asset filters yet. " +
        "When the response includes completeness scores for more than three products, do NOT use a plain markdown table in chat. " +
        "In Cursor, present results in a Canvas with summary stat cards, a filterable table, type badges, and completeness progress bars. " +
        "Use the completenessSummary and presentationHint fields in the response. " +
        "For one to three products, a concise inline summary is fine. " +
        "Suppress raw IDs unless the user asks for implementation detail.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: {
        categoryId: z
          .string()
          .optional()
          .describe(
            "Catalog or category ID from list_catalogs or list_category_tree. " +
            "Required unless categoryScope is uncategorized or the search is organisation-wide with only completeness filters."
          ),
        categoryName: z
          .string()
          .optional()
          .describe("Human-readable catalog or category name for the response summary."),
        categoryScope: z
          .enum(["catalog_with_subcategories", "exact_category", "uncategorized"])
          .optional()
          .describe(
            "How to apply categoryId. catalog_with_subcategories includes all sub-categories (default when categoryId is set). " +
            "exact_category matches only that node. uncategorized finds products with no category and ignores categoryId."
          ),
        completenessContext: z
          .string()
          .optional()
          .describe(
            "Language/market context for completeness score or requirement filters (e.g. \"en\"). " +
            "Required when completenessScoreMin, completenessScoreMax, or failingRequirementIds is set. " +
            "Call list_contexts to see available values."
          ),
        completenessScoreMin: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe(
            "Minimum completeness score inclusive (0 to 100). Use with completenessScoreMax. " +
            "Example: min 0 and max 49 finds products below 50%."
          ),
        completenessScoreMax: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe(
            "Maximum completeness score inclusive (0 to 100). Use with completenessScoreMin. " +
            "Example: min 100 and max 100 finds fully complete products."
          ),
        failingRequirementIds: z
          .array(z.string())
          .optional()
          .describe(
            "Completeness requirement IDs where products do not meet all listed requirements. " +
            "Get IDs from get_product_completeness_detail failedRequirements. Requires completenessContext."
          ),
        includeCompletenessScores: z
          .boolean()
          .optional()
          .describe(
            "When true, fetch and include completeness scores for returned products in completenessContext. " +
            "Defaults to true when filtering by completeness score or failing requirements."
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
            "Language/market context for product names in the response (e.g. \"en\"). " +
            "Defaults to English if omitted. Separate from completenessContext."
          ),
      },
    },
    async ({
      categoryId,
      categoryName,
      categoryScope,
      completenessContext,
      completenessScoreMin,
      completenessScoreMax,
      failingRequirementIds,
      includeCompletenessScores,
      limit,
      page,
      context,
    }) => {
      const effectiveLimit = limit ?? DEFAULT_PRODUCT_LIMIT;
      const effectivePage = page ?? DEFAULT_PAGE;
      const effectiveContext = context ?? "en";

      const hasCompletenessScoreFilter =
        completenessScoreMin !== undefined || completenessScoreMax !== undefined;
      const hasFailingRequirements =
        failingRequirementIds !== undefined && failingRequirementIds.length > 0;
      const shouldIncludeScores =
        includeCompletenessScores ??
        (hasCompletenessScoreFilter || hasFailingRequirements);

      if (
        !categoryId &&
        categoryScope !== "uncategorized" &&
        !hasCompletenessScoreFilter &&
        !hasFailingRequirements
      ) {
        throw new Error(
          "At least one search filter is required: categoryId, categoryScope uncategorized, a completeness score range, or failingRequirementIds."
        );
      }

      if (hasCompletenessScoreFilter && !completenessContext) {
        throw new Error(
          "completenessContext is required when completenessScoreMin or completenessScoreMax is set."
        );
      }

      if (hasFailingRequirements && !completenessContext) {
        throw new Error(
          "completenessContext is required when failingRequirementIds is set."
        );
      }

      const filters: ProductSearchFilters = {};

      if (categoryId || categoryScope === "uncategorized") {
        filters.categoryId = categoryId;
        filters.categoryScope = categoryScope as CategoryScope | undefined;
      }

      if (hasCompletenessScoreFilter) {
        filters.completenessScore = {
          context: completenessContext!,
          ...(completenessScoreMin !== undefined && { min: completenessScoreMin }),
          ...(completenessScoreMax !== undefined && { max: completenessScoreMax }),
        };
      }

      if (hasFailingRequirements) {
        filters.failingRequirements = {
          context: completenessContext!,
          requirementIds: failingRequirementIds!,
        };
      }

      const query = compileProductSearchQuery(filters);
      const searchBody = {
        query,
        paging: {
          page: effectivePage - 1,
          pageSize: effectiveLimit,
        },
      };
      const countBody = { query };

      const [searchResponse, countResponse] = await Promise.all([
        mapiPostBody<QueryBuilderSearchResponse>(
          `${MAPI_QUERY_BUILDER_BASE}/products/search?archiveState=ACTIVE`,
          searchBody,
          creds,
          { context }
        ),
        mapiPostBody<QueryBuilderCountResponse>(
          `${MAPI_QUERY_BUILDER_BASE}/products/count?archiveState=ACTIVE`,
          countBody,
          creds,
          { context }
        ),
      ]);

      if (searchResponse.errors && searchResponse.errors.length > 0) {
        const details = searchResponse.errors
          .map((error) => error.message)
          .join("; ");
        throw new Error(`Product search query error: ${details}`);
      }

      const productIds = (searchResponse.data ?? []).map((product) => product.id);
      const total = countResponse.count ?? 0;
      const filterDescription = describeSearchFilters(filters);
      const scopeLabel = categoryName ?? categoryId;

      if (productIds.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `No products matched the search (${filterDescription}) (working state, context: ${effectiveContext}).\n\n` +
                JSON.stringify(
                  {
                    filters: filterDescription,
                    ...(scopeLabel && { category: scopeLabel }),
                    context: effectiveContext,
                    total: 0,
                    page: effectivePage,
                    returned: 0,
                    hasMore: false,
                    products: [],
                  },
                  null,
                  2
                ),
            },
          ],
        };
      }

      const viewsResponse = await mapiPostBody<MapiProductViewsResponse>(
        `${MAPI_PIM_BASE}/products/list/views/by-ids?archiveState=ACTIVE`,
        {
          ids: productIds,
          views: [{ type: "METADATA" }],
        },
        creds,
        { context }
      );

      let scoreByProductId = new Map<string, number>();
      if (shouldIncludeScores && completenessContext) {
        const scoresResponse = await mapiPostBody<MapiCompletenessScoresResponse>(
          `${MAPI_COMPLETENESS_SCORE_BASE}/scores/list`,
          {
            pageSize: productIds.length,
            page: 0,
            entityIds: productIds,
            contexts: [completenessContext],
          },
          creds
        );
        scoreByProductId = new Map(
          (scoresResponse.data ?? [])
            .filter((row) => row.context === completenessContext)
            .map((row) => [row.entityId, row.score])
        );
      }

      const products = (viewsResponse.data ?? []).map((product) => {
        const nameValues = product.metadata?.name?.value ?? {};
        const name =
          nameValues[effectiveContext] ??
          nameValues["en"] ??
          Object.values(nameValues)[0] ??
          "";
        const score = scoreByProductId.get(product.id);
        return {
          id: product.id,
          name,
          ...(product.metadata?.number && { number: product.metadata.number }),
          ...(product.metadata?.type && { type: product.metadata.type }),
          ...(product.metadata?.state && { state: mapProductState(product.metadata.state) }),
          ...(score !== undefined && { completenessScore: score }),
        };
      });

      const returned = products.length;
      const hasMore = total > effectivePage * effectiveLimit;
      const scores = products
        .map((product) => product.completenessScore)
        .filter((score): score is number => score !== undefined);
      const completenessSummary =
        scores.length > 0
          ? computeCompletenessSummary(scores, {
              filterMin: completenessScoreMin,
              filterMax: completenessScoreMax,
            })
          : undefined;
      const preferCanvas = scores.length > 3;

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Found ${total} product${total === 1 ? "" : "s"} matching ${filterDescription}` +
              (scopeLabel ? ` in "${scopeLabel}"` : "") +
              ` (working state, context: ${effectiveContext}). ` +
              `Returned ${returned} on page ${effectivePage}` +
              (hasMore
                ? `. Call again with page=${effectivePage + 1} to fetch more.`
                : ".") +
              (preferCanvas
                ? " Present these results in a Cursor Canvas with summary cards and a filterable table, not a plain markdown table."
                : "") +
              "\n\n" +
              JSON.stringify(
                {
                  filters: filterDescription,
                  ...(scopeLabel && { category: scopeLabel }),
                  context: effectiveContext,
                  ...(completenessContext && { completenessContext }),
                  total,
                  page: effectivePage,
                  returned,
                  hasMore,
                  ...(completenessSummary && { completenessSummary }),
                  ...(preferCanvas && {
                    presentationHint: {
                      preferCanvas: true,
                      layout: "completeness-product-list",
                      summaryCards: ["totalMatching", "atZero", "partial"],
                      tableColumns: ["name", "number", "type", "completenessScore"],
                      typeBadgeStyle: {
                        single: "neutral",
                        variant: "purple",
                        group: "blue",
                      },
                      completenessBar: true,
                      scoreColorBands: {
                        below70: "red",
                        from70to89: "orange",
                        from90: "green",
                      },
                    },
                  }),
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

  // Tool: get_product
  server.registerTool(
    "get_product",
    {
      description:
        "Fetch full working-state details for a Bluestone PIM product, including metadata, attributes, category IDs, asset IDs, relations, bundles, and variant information. " +
        "Use list_products_in_category first to get the productId, or use the ID returned by create_product. " +
        "Call this before writing product attributes or category changes when you need to inspect current values. " +
        "Attribute values are returned by definitionId only. Call get_attribute_definition or list_attribute_definitions if you need to resolve attribute names, data types, enum values, or dictionary context. " +
        "Suppress raw IDs in user-facing replies unless the user asks for implementation detail or a write action needs exact IDs.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: {
        productId: z
          .string()
          .describe("The product ID. Get this from list_products_in_category or create_product."),
        productName: z
          .string()
          .optional()
          .describe("Human-readable product name for the response summary. Pass it when available."),
        context: z
          .string()
          .optional()
          .describe(
            "Language/market context ID (e.g. \"en\", \"l3600\"). " +
            "Call list_contexts to see available values. Defaults to English if omitted."
          ),
      },
    },
    async ({ productId, productName, context }) => {
      const effectiveContext = context ?? "en";
      const product = await mapiGetFull<MapiProductDetail>(
        `${MAPI_PIM_BASE}/products/${productId}`,
        creds,
        { context }
      );

      const attributes = (product.attributes ?? []).map((attribute) => ({
        definitionId: attribute.definitionId,
        ...(attribute.values && { values: attribute.values }),
        ...(attribute.dictionary && { dictionary: attribute.dictionary }),
        ...(attribute.readOnly && { readOnly: true }),
      }));

      const label = productName ?? product.name ?? productId;

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Fetched product "${label}" (working state, context: ${effectiveContext}). ` +
              `Found ${attributes.length} attribute${attributes.length === 1 ? "" : "s"}, ` +
              `${product.categories?.length ?? 0} categor${(product.categories?.length ?? 0) === 1 ? "y" : "ies"}, ` +
              `and ${product.assets?.length ?? 0} asset${(product.assets?.length ?? 0) === 1 ? "" : "s"}.\n\n` +
              JSON.stringify(
                {
                  id: product.id,
                  context: effectiveContext,
                  ...(product.name && { name: product.name }),
                  ...(product.number && { number: product.number }),
                  ...(product.description && { description: product.description }),
                  ...(product.state && { state: mapProductState(product.state) }),
                  ...(product.type && { type: product.type }),
                  ...(product.variantParentId && { variantParentId: product.variantParentId }),
                  ...(product.quantity !== undefined && { quantity: product.quantity }),
                  ...(product.archived !== undefined && { archived: product.archived }),
                  ...(product.dataSynced !== undefined && { dataSynced: product.dataSynced }),
                  ...(product.readOnly !== undefined && { readOnly: product.readOnly }),
                  ...(product.lastUpdate && { lastUpdate: product.lastUpdate }),
                  ...(product.createDate && { createDate: product.createDate }),
                  attributes,
                  categories: product.categories ?? [],
                  relatedCategories: product.relatedCategories ?? [],
                  assets: product.assets ?? [],
                  relatedProducts: product.relatedProducts ?? [],
                  labels: product.labels ?? [],
                  productBundles: product.productBundles ?? [],
                  productVariants: product.productVariants ?? [],
                },
                null,
                2
              ),
          },
        ],
      };
    }
  );

  // Tool: list_product_completeness_scores
  server.registerTool(
    "list_product_completeness_scores",
    {
      description:
        "Fetch Bluestone PIM completeness scores for one or more known products. " +
        "Call this when the user asks whether a product is complete, what a product's completeness score is, or wants scores for specific product IDs they already have or can identify by name. " +
        "Scores are percentages (0 to 100) against configured completeness rules for a language/market context. " +
        "Use list_products_in_category or get_product to resolve product IDs when the user names a product but has not given an ID. " +
        "Call list_contexts when the user asks about a specific language or market, then pass those context IDs to filter results. " +
        "Omit contexts to return scores for every context. " +
        "When the user asks what is missing or wants a requirement breakdown for one product in one context, call get_product_completeness_detail instead. " +
        "Do NOT use this tool when the user wants to list or filter products by score across a catalog, for example all products above 80%, all incomplete products in a category, or every product under a threshold. " +
        "Use search_products for those catalog-wide completeness searches. " +
        "Surface scores in user-facing replies as a concise table or summary. " +
        "Suppress raw product IDs, timestamps, and validationStatus unless the user asks for implementation detail.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: {
        productIds: z
          .array(z.string())
          .min(1)
          .max(MAX_COMPLETENESS_PRODUCT_IDS)
          .describe(
            "Product IDs to fetch scores for. Get these from list_products_in_category, get_product, or create_product. " +
            `Max ${MAX_COMPLETENESS_PRODUCT_IDS} IDs per call.`
          ),
        contexts: z
          .array(z.string())
          .optional()
          .describe(
            "Optional language/market context IDs to filter by (e.g. \"en\", \"l3600\"). " +
            "Call list_contexts to see available values. Omit to return scores for all contexts."
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_COMPLETENESS_LIMIT)
          .optional()
          .describe(
            `Scores per page (default ${DEFAULT_COMPLETENESS_LIMIT}, max ${MAX_COMPLETENESS_LIMIT}). ` +
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
    async ({ productIds, contexts, limit, page }) => {
      const effectiveLimit = limit ?? DEFAULT_COMPLETENESS_LIMIT;
      const effectivePage = page ?? DEFAULT_PAGE;

      const body: {
        pageSize: number;
        page: number;
        entityIds: string[];
        contexts?: string[];
      } = {
        pageSize: effectiveLimit,
        page: effectivePage - 1,
        entityIds: productIds,
      };
      if (contexts && contexts.length > 0) {
        body.contexts = contexts;
      }

      const response = await mapiPostBody<MapiCompletenessScoresResponse>(
        `${MAPI_COMPLETENESS_SCORE_BASE}/scores/list`,
        body,
        creds
      );

      const scores = (response.data ?? []).map((row) => ({
        productId: row.entityId,
        context: row.context,
        score: row.score,
        validationStatus: row.validationStatus,
        scoredAt: row.date,
        productLastUpdate: row.entityLastUpdate,
      }));

      const uniqueProducts = new Set(scores.map((row) => row.productId)).size;
      const uniqueContexts = new Set(scores.map((row) => row.context)).size;
      const hasMore = scores.length === effectiveLimit;
      const contextLabel =
        contexts && contexts.length > 0
          ? ` in ${contexts.length === 1 ? `context "${contexts[0]}"` : `${contexts.length} contexts`}`
          : uniqueContexts > 0
            ? ` across ${uniqueContexts} context${uniqueContexts === 1 ? "" : "s"}`
            : "";

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Found completeness scores for ${productIds.length} requested product${productIds.length === 1 ? "" : "s"}${contextLabel} (working state). ` +
              `Returned ${scores.length} score${scores.length === 1 ? "" : "s"} covering ${uniqueProducts} product${uniqueProducts === 1 ? "" : "s"}` +
              (hasMore
                ? ` on page ${effectivePage}. Call again with page=${effectivePage + 1} to fetch more.`
                : ".") +
              "\n\n" +
              JSON.stringify(
                {
                  requestedProductIds: productIds,
                  ...(contexts && contexts.length > 0 && { contexts }),
                  page: effectivePage,
                  returned: scores.length,
                  hasMore,
                  scores,
                },
                null,
                2
              ),
          },
        ],
      };
    }
  );

  // Tool: get_product_completeness_detail
  server.registerTool(
    "get_product_completeness_detail",
    {
      description:
        "Fetch the completeness requirement breakdown for one product in one language/market context. " +
        "Call this when the user asks what is missing, which requirements failed, or wants detail on why a product's completeness score is below 100%. " +
        "Call list_product_completeness_scores first when you do not yet know the score, or when the user asks about multiple products or contexts. " +
        "Use list_products_in_category or get_product to resolve the productId when the user names a product but has not given an ID. " +
        "Call list_contexts when the user asks about a specific language or market. Defaults to English if context is omitted. " +
        "Requirement results include resolved names where available. Attribute-based requirements are resolved via completeness requirements and attribute definitions. " +
        "Present the breakdown in a Cursor Canvas when the user asks what is missing: overall completeness bar, MISSING requirement cards, PASSING requirement cards, and a variant scope line when multiple variants share the same gaps. " +
        "Surface failed requirement names clearly in user-facing replies. Suppress raw requirement IDs unless the user asks for implementation detail.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: {
        productId: z
          .string()
          .describe(
            "The product ID. Get this from list_products_in_category, get_product, create_product, or list_product_completeness_scores."
          ),
        productName: z
          .string()
          .optional()
          .describe("Human-readable product name for the response summary. Pass it when available."),
        context: z
          .string()
          .optional()
          .describe(
            "Language/market context ID (e.g. \"en\", \"l3600\"). " +
            "Call list_contexts to see available values. Defaults to English if omitted."
          ),
      },
    },
    async ({ productId, productName, context }) => {
      const effectiveContext = context ?? "en";
      const detail = await mapiGet<MapiCompletenessScoreDetail>(
        `${MAPI_COMPLETENESS_SCORE_BASE}/scores/${productId}/${effectiveContext}`,
        creds
      );

      const rawRequirements = (detail.requirementsResults ?? []).map((requirement) => ({
        requirementId: requirement.requirementId,
        weight: requirement.weight,
        status: requirement.requirementStatus,
      }));
      const requirements = await resolveRequirementResults(rawRequirements, creds, {
        completenessScoreBase: MAPI_COMPLETENESS_SCORE_BASE,
        pimBase: MAPI_PIM_BASE,
        mapiGet,
        mapiPostBody,
      });
      const failedRequirements = requirements.filter((requirement) => requirement.status === "FAILED");
      const passedRequirements = requirements.filter((requirement) => requirement.status === "PASSED");
      const label = productName ?? productId;
      const failedNames = failedRequirements.map((requirement) => requirement.name);

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Fetched completeness detail for "${label}" (working state, context: ${effectiveContext}). ` +
              `Score: ${detail.score}%. ` +
              `${passedRequirements.length} requirement${passedRequirements.length === 1 ? "" : "s"} passed, ` +
              `${failedRequirements.length} failed` +
              (failedNames.length > 0 ? `: ${failedNames.join("; ")}` : ".") +
              "\n\n" +
              JSON.stringify(
                {
                  productId: detail.entityId,
                  context: detail.context,
                  score: detail.score,
                  scoredAt: detail.date,
                  productLastUpdate: detail.pimLastUpdate,
                  passedCount: passedRequirements.length,
                  failedCount: failedRequirements.length,
                  failedRequirements,
                  passedRequirements,
                  requirements,
                },
                null,
                2
              ),
          },
        ],
      };
    }
  );

  // Tool: list_category_level_attributes
  server.registerTool(
    "list_category_level_attributes",
    {
      description:
        "List Category Level Attributes (CLAs) configured on one Bluestone PIM catalog node or category. " +
        "Returns attribute name, value, and propagate, lock, and mandatory flags for each CLA. " +
        "Call list_catalogs and list_category_tree first when the user names a category but has not given an ID. " +
        "Do not use for product attribute values (get_product), completeness scores (list_product_completeness_scores), " +
        "or org-wide CLA browse without a category (list_categories_with_cla). " +
        "When the user asks which products violate these rules, call get_product_validation_issues or list_product_validation_issues. " +
        "Suppress raw IDs in user-facing replies unless the user asks for implementation detail.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: {
        categoryId: z
          .string()
          .describe(
            "Catalog or category node ID from list_catalogs or list_category_tree."
          ),
        categoryName: z
          .string()
          .optional()
          .describe("Human-readable category name or path for the response summary."),
        context: z
          .string()
          .optional()
          .describe(
            "Language/market context ID (e.g. \"en\", \"l3600\"). " +
            "Call list_contexts to see available values. Defaults to English if omitted."
          ),
      },
    },
    async ({ categoryId, categoryName, context }) => {
      const effectiveContext = context ?? "en";
      const response = await mapiGet<MapiCategoryAttributesMetadataResponse>(
        `${MAPI_PIM_BASE}/catalogs/nodes/${categoryId}/attributes`,
        creds,
        { context, query: { archiveState: "ACTIVE" } }
      );
      const attributes = (response.data ?? []).map(shapeCategoryLevelAttribute);
      const label = categoryName ?? categoryId;
      const lockedCount = attributes.filter((attribute) => attribute.locked).length;
      const mandatoryCount = attributes.filter((attribute) => attribute.mandatory).length;
      const propagatedCount = attributes.filter((attribute) => attribute.propagated).length;

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Found ${attributes.length} category level attribute${attributes.length === 1 ? "" : "s"} on "${label}" (working state, context: ${effectiveContext}). ` +
              `${lockedCount} locked, ${mandatoryCount} mandatory, ${propagatedCount} propagated.\n\n` +
              JSON.stringify(
                {
                  categoryId,
                  category: label,
                  context: effectiveContext,
                  lockedCount,
                  mandatoryCount,
                  propagatedCount,
                  attributes,
                },
                null,
                2
              ),
          },
        ],
      };
    }
  );

  // Tool: list_categories_with_cla
  server.registerTool(
    "list_categories_with_cla",
    {
      description:
        "Find catalog nodes or categories that use a given attribute definition as a Category Level Attribute (CLA). " +
        "Call list_attribute_definitions or get_attribute_definition first to resolve the definitionId when the user names an attribute. " +
        "Do not use when the category is already known (list_category_level_attributes). " +
        "Suppress raw IDs in user-facing replies unless the user asks for implementation detail.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: {
        definitionId: z
          .string()
          .describe(
            "Attribute definition ID from list_attribute_definitions or get_attribute_definition."
          ),
        attributeName: z
          .string()
          .optional()
          .describe("Human-readable attribute name for the response summary."),
        context: z
          .string()
          .optional()
          .describe(
            "Language/market context ID. Call list_contexts when needed. Defaults to English if omitted."
          ),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Page number, 1-indexed (default 1)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_CLA_CATEGORY_LIMIT)
          .optional()
          .describe(
            `Categories per page (default ${DEFAULT_CLA_CATEGORY_LIMIT}, max ${MAX_CLA_CATEGORY_LIMIT}).`
          ),
      },
    },
    async ({ definitionId, attributeName, context, page, limit }) => {
      const effectiveContext = context ?? "en";
      const effectivePage = page ?? DEFAULT_PAGE;
      const effectiveLimit = limit ?? DEFAULT_CLA_CATEGORY_LIMIT;
      const response = await mapiGet<MapiCategoryBasicListResponse>(
        `${MAPI_PIM_BASE}/catalogs/nodes/attributeDefinition/${definitionId}`,
        creds,
        {
          context,
          query: {
            page: effectivePage - 1,
            pageSize: effectiveLimit,
            archiveState: "ACTIVE",
          },
        }
      );
      const categories = (response.data ?? []).map((category) => ({
        categoryId: category.id,
        name: category.name ?? category.number ?? category.id,
        ...(category.number && { number: category.number }),
      }));
      const label = attributeName ?? definitionId;
      const hasMore = categories.length === effectiveLimit;

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Found ${categories.length} categor${categories.length === 1 ? "y" : "ies"} using "${label}" as a CLA (working state, context: ${effectiveContext}, page ${effectivePage})` +
              (hasMore
                ? `. Call again with page=${effectivePage + 1} to fetch more.`
                : ".") +
              "\n\n" +
              JSON.stringify(
                {
                  definitionId,
                  attribute: label,
                  context: effectiveContext,
                  page: effectivePage,
                  limit: effectiveLimit,
                  returned: categories.length,
                  hasMore,
                  categories,
                },
                null,
                2
              ),
          },
        ],
      };
    }
  );

  // Tool: list_variant_level_attributes
  server.registerTool(
    "list_variant_level_attributes",
    {
      description:
        "List Variant Level Attributes (VLAs) configured on a variant group product: copy, locked, mandatory, and variant-defining flags. " +
        "The groupProductId must be a GROUP product. Call get_product first to confirm type and get the group ID. " +
        "There is no single list API: this tool probes each attribute on the group (up to 50 per call by default). " +
        "When truncated is true in the response, tell the user how many attributes were checked and offer to call again with offset to show the rest. " +
        "Do not use for variant product values (get_product) or a single known attribute (get_variant_level_attribute). " +
        "Suppress raw IDs in user-facing replies unless the user asks for implementation detail.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: {
        groupProductId: z
          .string()
          .describe(
            "Variant group product ID (type GROUP). From get_product or list_products_in_category."
          ),
        groupProductName: z
          .string()
          .optional()
          .describe("Human-readable group name for the response summary."),
        context: z
          .string()
          .optional()
          .describe(
            "Language/market context when reading group attributes. Defaults to English if omitted."
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            "Skip the first N attribute definitions on the group before probing (default 0). Use with truncated responses to fetch the next batch."
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_VLA_ATTRIBUTE_PROBE)
          .optional()
          .describe(
            `Maximum attribute definitions to probe per call (default ${MAX_VLA_ATTRIBUTE_PROBE}, max ${MAX_VLA_ATTRIBUTE_PROBE}).`
          ),
      },
    },
    async ({ groupProductId, groupProductName, context, offset, limit }) => {
      const effectiveContext = context ?? "en";
      const effectiveOffset = offset ?? 0;
      const effectiveLimit = limit ?? MAX_VLA_ATTRIBUTE_PROBE;
      const product = await mapiGetFull<MapiProductDetail>(
        `${MAPI_PIM_BASE}/products/${groupProductId}`,
        creds,
        { context }
      );

      if (product.type === "VARIANT") {
        throw new Error(
          `Product ${groupProductId} is a VARIANT, not a variant group. ` +
            "Use variantParentId from get_product as groupProductId, or open the parent GROUP product."
        );
      }
      if (product.type && product.type !== "GROUP") {
        throw new Error(
          `Product ${groupProductId} has type ${product.type}. list_variant_level_attributes requires a GROUP product.`
        );
      }

      const allDefinitionIds = [
        ...new Set((product.attributes ?? []).map((attribute) => attribute.definitionId)),
      ];
      const slice = allDefinitionIds.slice(
        effectiveOffset,
        effectiveOffset + effectiveLimit
      );
      const truncated = effectiveOffset + slice.length < allDefinitionIds.length;
      const nextOffset = truncated ? effectiveOffset + slice.length : undefined;

      const probeResults = await Promise.all(
        slice.map(async (definitionId) => {
          const result = await mapiGetOptional<MapiProductVariantAttribute>(
            `${MAPI_PIM_BASE}/products/${groupProductId}/variants/attributes/${definitionId}`,
            creds
          );
          if (!result.ok) {
            return null;
          }
          return { definitionId, config: result.data };
        })
      );
      const vlaConfigs = probeResults.filter(
        (entry): entry is { definitionId: string; config: MapiProductVariantAttribute } =>
          entry !== null
      );
      const nameByDefinitionId = await fetchAttributeDefinitionNames(
        vlaConfigs.map((entry) => entry.definitionId),
        creds,
        mapiGet,
        MAPI_PIM_BASE
      );
      const variantLevelAttributes = vlaConfigs.map(({ definitionId, config }) => ({
        definitionId,
        name: nameByDefinitionId.get(definitionId) ?? definitionId,
        copy: Boolean(config.copy),
        locked: Boolean(config.locked),
        mandatory: Boolean(config.mandatory),
        variantDefining: Boolean(config.definingAttributes),
      }));

      const label = groupProductName ?? product.name ?? groupProductId;
      const definingCount = variantLevelAttributes.filter(
        (attribute) => attribute.variantDefining
      ).length;
      const truncatedNote = truncated
        ? ` Checked ${slice.length} of ${allDefinitionIds.length} attributes on the group (offset ${effectiveOffset}).` +
          (nextOffset !== undefined
            ? ` Call again with offset=${nextOffset} to show the rest.`
            : "")
        : "";

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Found ${variantLevelAttributes.length} variant level attribute${variantLevelAttributes.length === 1 ? "" : "s"} on group "${label}" (working state). ` +
              `${definingCount} variant-defining.${truncatedNote}\n\n` +
              JSON.stringify(
                {
                  groupProductId,
                  group: label,
                  context: effectiveContext,
                  totalAttributesOnGroup: allDefinitionIds.length,
                  offset: effectiveOffset,
                  probed: slice.length,
                  truncated,
                  ...(nextOffset !== undefined && { nextOffset }),
                  variantDefiningCount: definingCount,
                  variantLevelAttributes,
                },
                null,
                2
              ),
          },
        ],
      };
    }
  );

  // Tool: get_variant_level_attribute
  server.registerTool(
    "get_variant_level_attribute",
    {
      description:
        "Fetch Variant Level Attribute (VLA) configuration for one attribute on one variant group product. " +
        "Returns copy, locked, mandatory, and variant-defining flags. " +
        "The groupProductId must be a GROUP product. Call get_product first to confirm type. " +
        "If the attribute is on the group but not configured as a VLA, the tool returns a clear message instead of an error. " +
        "Call list_variant_level_attributes to discover all VLAs on a group. " +
        "Suppress raw IDs in user-facing replies unless the user asks for implementation detail.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: {
        groupProductId: z
          .string()
          .describe("Variant group product ID (type GROUP)."),
        definitionId: z.string().describe("Attribute definition ID."),
        attributeName: z
          .string()
          .optional()
          .describe("Human-readable attribute name for the response summary."),
        groupProductName: z
          .string()
          .optional()
          .describe("Human-readable group name for the response summary."),
      },
    },
    async ({ groupProductId, definitionId, attributeName, groupProductName }) => {
      const result = await mapiGetOptional<MapiProductVariantAttribute>(
        `${MAPI_PIM_BASE}/products/${groupProductId}/variants/attributes/${definitionId}`,
        creds
      );
      const attrLabel = attributeName ?? definitionId;
      const groupLabel = groupProductName ?? groupProductId;

      if (!result.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Attribute "${attrLabel}" on group "${groupLabel}" is not configured as a variant level attribute (VLA), or the group or definition was not found. ` +
                "Call get_product to confirm the product type is GROUP and the attribute exists on the group. " +
                "Call list_variant_level_attributes to list all VLAs on the group.",
            },
          ],
        };
      }

      const config = result.data;
      const shaped = {
        definitionId,
        name: attrLabel,
        copy: Boolean(config.copy),
        locked: Boolean(config.locked),
        mandatory: Boolean(config.mandatory),
        variantDefining: Boolean(config.definingAttributes),
      };

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Fetched VLA settings for "${attrLabel}" on group "${groupLabel}" (working state). ` +
              `Copy: ${shaped.copy}, locked: ${shaped.locked}, mandatory: ${shaped.mandatory}, variant-defining: ${shaped.variantDefining}.\n\n` +
              JSON.stringify(
                {
                  groupProductId,
                  group: groupLabel,
                  variantLevelAttribute: shaped,
                },
                null,
                2
              ),
          },
        ],
      };
    }
  );

  // Tool: get_product_validation_issues
  server.registerTool(
    "get_product_validation_issues",
    {
      description:
        "Fetch sync validation issues for one Bluestone PIM product in one context. " +
        "Surfaces CLA, VLA, attribute restriction, compound, and dictionary filter violations. " +
        "Do not use for completeness requirement breakdown (get_product_completeness_detail) or bulk checks (list_product_validation_issues). " +
        "An empty issue list means the product has no validation issues in that context, not an API failure. " +
        "Call list_category_level_attributes when the user asks which CLA rule caused an issue (use categoryId from the issue). " +
        "Call list_variant_level_attributes when the user asks which VLA rule caused an issue (use variantParentId from the issue). " +
        "Do not conflate validation with completeness score. Both may matter for broad data quality questions. " +
        "When issueCount is greater than five, present results in a Cursor Canvas, not a plain markdown table. " +
        "Suppress raw IDs in user-facing replies unless the user asks for implementation detail.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: {
        productId: z
          .string()
          .describe(
            "Product ID from list_products_in_category, get_product, or create_product."
          ),
        productName: z
          .string()
          .optional()
          .describe("Human-readable product name for the response summary."),
        context: z
          .string()
          .optional()
          .describe(
            "Language/market context ID. Call list_contexts when needed. Defaults to English if omitted."
          ),
      },
    },
    async ({ productId, productName, context }) => {
      const effectiveContext = context ?? "en";
      const response = await mapiGet<MapiProductValidationIssuesListResponse>(
        `${MAPI_COMPLETENESS_SCORE_BASE}/validations/${productId}/${effectiveContext}`,
        creds
      );
      const rawIssues = response.data ?? [];
      const issues = await shapeProductValidationIssues(rawIssues, creds);
      const issuesByKind = countValidationIssuesByKind(issues);
      const label = productName ?? productId;
      const valid = issues.length === 0;
      const presentationHint = buildValidationPresentationHint({
        issueCount: issues.length,
      });

      return {
        content: [
          {
            type: "text" as const,
            text:
              (valid
                ? `Product "${label}" has no validation issues (working state, context: ${effectiveContext}).`
                : `Product "${label}" has ${issues.length} validation issue${issues.length === 1 ? "" : "s"} (working state, context: ${effectiveContext}): ${validationIssuesSummaryText(issues.length, issuesByKind)}.`) +
              (presentationHint
                ? " Present these results in a Cursor Canvas grouped by kind, not a plain markdown table."
                : "") +
              "\n\n" +
              JSON.stringify(
                {
                  productId,
                  product: label,
                  context: effectiveContext,
                  valid,
                  issueCount: issues.length,
                  issuesByKind,
                  issues,
                  ...(presentationHint && { presentationHint }),
                },
                null,
                2
              ),
          },
        ],
      };
    }
  );

  // Tool: list_product_validation_issues
  server.registerTool(
    "list_product_validation_issues",
    {
      description:
        "Fetch sync validation issues for up to 100 known product IDs in one context. " +
        "Surfaces CLA, VLA, and other validation violations across multiple products. " +
        "Do not use for catalog-wide discovery of invalid products (not supported yet). " +
        "Do not use for one product (get_product_validation_issues). " +
        "By default only products with issues are included. Set includeValidProducts to include products with zero issues. " +
        "When some requested IDs are missing from the response, the API omitted non-existent products. " +
        "When productsWithIssues is greater than three or total issues exceed ten, present results in a Cursor Canvas, not a plain markdown table. " +
        "Workflow: list_products_in_category, then call this tool with up to 100 IDs per call.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: {
        productIds: z
          .array(z.string())
          .min(1)
          .max(MAX_VALIDATION_PRODUCT_IDS)
          .describe(
            `Product IDs to validate. Min 1, max ${MAX_VALIDATION_PRODUCT_IDS} per call.`
          ),
        context: z
          .string()
          .optional()
          .describe(
            "Language/market context ID. Call list_contexts when needed. Defaults to English if omitted."
          ),
        includeValidProducts: z
          .boolean()
          .optional()
          .describe(
            "When true, include products with zero validation issues in the response JSON. Default false."
          ),
      },
    },
    async ({ productIds, context, includeValidProducts }) => {
      const effectiveContext = context ?? "en";
      const response = await mapiPostBody<MapiBulkValidationListResponse>(
        `${MAPI_COMPLETENESS_SCORE_BASE}/validations/by-ids`,
        { entityIds: productIds, context: effectiveContext },
        creds
      );

      const allDefinitionIds = (response.data ?? []).flatMap((entry) =>
        entry.validations.map((issue) => issue.validationDetails?.definitionId)
      ).filter((value): value is string => typeof value === "string");
      const nameByDefinitionId = await fetchAttributeDefinitionNames(
        allDefinitionIds,
        creds,
        mapiGet,
        MAPI_PIM_BASE
      );

      const products = [];
      let totalIssues = 0;
      for (const entry of response.data ?? []) {
        const issues = entry.validations.map((issue) =>
          shapeValidationIssue(issue, nameByDefinitionId)
        );
        if (!includeValidProducts && issues.length === 0) {
          continue;
        }
        totalIssues += issues.length;
        products.push({
          productId: entry.entityId,
          issueCount: issues.length,
          valid: issues.length === 0,
          issuesByKind: countValidationIssuesByKind(issues),
          issues,
        });
      }

      const returnedCount = response.data?.length ?? 0;
      const missingCount = productIds.length - returnedCount;
      const productsWithIssues = products.filter((product) => product.issueCount > 0).length;
      const presentationHint = buildValidationPresentationHint({
        issueCount: totalIssues,
        productCount: productsWithIssues,
      });

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Validated ${productIds.length} product${productIds.length === 1 ? "" : "s"} (working state, context: ${effectiveContext}). ` +
              `${productsWithIssues} with issues, ${totalIssues} total issue${totalIssues === 1 ? "" : "s"}` +
              (missingCount > 0 ? `, ${missingCount} ID${missingCount === 1 ? "" : "s"} not found` : "") +
              "." +
              (presentationHint
                ? " Present these results in a Cursor Canvas grouped by product and kind, not a plain markdown table."
                : "") +
              "\n\n" +
              JSON.stringify(
                {
                  context: effectiveContext,
                  requestedCount: productIds.length,
                  returnedCount,
                  ...(missingCount > 0 && { missingCount }),
                  productsWithIssues,
                  totalIssues,
                  products,
                  ...(presentationHint && { presentationHint }),
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
        "The product name is required. Product number is optional but strongly recommended for onboarding because it is the unique product key Bluestone uses to detect existing products. " +
        "Always confirm the name and product number with the user before calling this tool. " +
        "Returns the name and ID of the newly created product. " +
        "If categoryId is provided, the product will also be assigned to that catalog category after creation. " +
        "Category assignment is a separate step: if it fails, the product still exists and the failure is reported separately. " +
        "If product creation itself fails, report the error to the user and do not retry without their confirmation. If a product number already exists, tell the user this create-only flow will not update or upsert the existing product. " +
        "Do not call this during phase 1 onboarding, supplier data mapping, import planning, or bulk import planning. In those flows, stop at read-only mapping and validation unless the user explicitly moves to a confirmed write phase. " +
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
        number: z
          .string()
          .optional()
          .describe(
            "Optional product number. Strongly recommended for onboarding because it is the unique product key used to detect existing products. Must be confirmed by the user before calling."
          ),
        categoryId: z
          .string()
          .optional()
          .describe(
            "Optional catalog category ID to assign the product to after creation. " +
            "Pass the categoryId from list_products_in_category or list_catalogs."
          ),
      },
    },
    async ({ name, number, categoryId }) => {
      let resourceId: string | null;
      try {
        const result = await mapiPost<Record<string, unknown>>(
          "/pim/products",
          {
            name,
            ...(number && { number }),
          },
          creds
        );
        resourceId = result.resourceId;
      } catch (err) {
        const conflictMessage = number ? productNumberConflictMessage(err, number) : null;
        if (conflictMessage) {
          return {
            content: [
              {
                type: "text" as const,
                text: conflictMessage,
              },
            ],
          };
        }
        throw err;
      }
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
                text:
                  `Product "${name}" created and assigned to catalog category ${categoryId}. ID: ${resourceId}` +
                  (number ? ` Number: ${number}` : ""),
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
                  (number ? `Number: ${number}\n\n` : "") +
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
            text:
              `Product "${name}" created successfully. ID: ${resourceId}` +
              (number ? ` Number: ${number}` : ""),
          },
        ],
      };
    }
  );

  // Tool: assign_product_to_category
  server.registerTool(
    "assign_product_to_category",
    {
      description:
        "Assign an existing product to a Bluestone PIM catalog category. " +
        "Call list_catalogs and, when needed, list_category_tree first to get the categoryId. " +
        "Use list_products_in_category or a prior create_product result to get the productId. " +
        "Always confirm the product and target category with the user before calling this tool. " +
        "This only assigns category placement. It does not set product attributes, media, or publication status.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
      inputSchema: {
        productId: z
          .string()
          .describe("The product ID to assign. Get this from list_products_in_category or create_product."),
        categoryId: z
          .string()
          .describe("The catalog category ID to assign the product to. Get this from list_catalogs or list_category_tree."),
        productName: z
          .string()
          .optional()
          .describe("Human-readable product name for the confirmation message. Pass it when available."),
        categoryName: z
          .string()
          .optional()
          .describe("Human-readable category name or path for the confirmation message. Pass it when available."),
      },
    },
    async ({ productId, categoryId, productName, categoryName }) => {
      await mapiPost<Record<string, unknown>>(
        `/pim/catalogs/nodes/${categoryId}/products`,
        { productId },
        creds
      );

      const productLabel = productName ? `"${productName}" (${productId})` : productId;
      const categoryLabel = categoryName ? `"${categoryName}" (${categoryId})` : categoryId;

      return {
        content: [
          {
            type: "text" as const,
            text: `Assigned product ${productLabel} to catalog category ${categoryLabel}.`,
          },
        ],
      };
    }
  );

  // Tool: update_product_name
  server.registerTool(
    "update_product_name",
    {
      description:
        "Rename an existing product in Bluestone PIM. " +
        "Use list_products_in_category or a prior create_product result to get the productId. " +
        "Always confirm the exact old product and new name with the user before calling this tool. " +
        "This only updates the product name. It does not set attributes, category placement, media, or publication status.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
      inputSchema: {
        productId: z
          .string()
          .describe("The product ID to rename. Get this from list_products_in_category or create_product."),
        newName: z
          .string()
          .min(1)
          .describe("The new product name. Must be confirmed by the user before calling."),
        currentName: z
          .string()
          .optional()
          .describe("Current product name for confirmation context. Pass it when available."),
      },
    },
    async ({ productId, newName, currentName }) => {
      await mapiPatch(`/pim/products/${productId}`, { name: newName }, creds);

      return {
        content: [
          {
            type: "text" as const,
            text: currentName
              ? `Renamed product "${currentName}" to "${newName}". ID: ${productId}`
              : `Renamed product ${productId} to "${newName}".`,
          },
        ],
      };
    }
  );

  return server;
}

