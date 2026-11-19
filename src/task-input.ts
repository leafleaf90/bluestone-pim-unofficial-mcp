// Pure helpers for the task tools: input normalisation and response shaping.
// Kept free of network and MCP code so they can be tested directly.

export const MAX_TASK_PRODUCTS = 100;
export const MAX_LISTED_ROWS = 50;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const OFFSET_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Normalise a due date for the tasks API.
 *
 * - `YYYY-MM-DD` becomes that calendar day at noon UTC (`...T12:00:00Z`). A bare
 *   date has been rejected by the live API, and noon UTC keeps the day stable in
 *   every timezone.
 * - A full ISO-8601 date-time with `Z` or an offset is passed through unchanged.
 *
 * Returns null for anything else. The update endpoint silently ignores a due date
 * it cannot parse, so this check is the only protection against a lost change.
 */
export function normalizeTaskDueDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const dateOnly = DATE_ONLY.exec(text);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const probe = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    const real =
      probe.getUTCFullYear() === Number(y) &&
      probe.getUTCMonth() === Number(m) - 1 &&
      probe.getUTCDate() === Number(d);
    return real ? `${text}T12:00:00Z` : null;
  }
  if (OFFSET_DATE_TIME.test(text) && !Number.isNaN(Date.parse(text))) return text;
  return null;
}

/** First duplicated value in the list, or undefined. */
export function firstDuplicate(values: string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

/** Array from a bare array or a `{ data | <key>: [...] }` wrapper, else []. */
export function rowsOf(json: unknown, key = "data"): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const inner = (json as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner;
  }
  return [];
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const bool = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined);

function compact<T extends Record<string, unknown>>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as T;
}

export interface ShapedUser {
  id: string;
  name?: string;
  email?: string;
}

/** Users reduced to id, name and email. Pictures, status and timestamps are dropped. */
export function shapeUsers(json: unknown): ShapedUser[] {
  const out: ShapedUser[] = [];
  for (const row of rowsOf(json)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = str(r.id);
    if (!id) continue;
    out.push(compact({ id, name: str(r.name)?.trim(), email: str(r.email)?.trim() }));
  }
  return out;
}

export interface ShapedGroup {
  id: string;
  name?: string;
}

export function shapeUserGroups(json: unknown): ShapedGroup[] {
  const out: ShapedGroup[] = [];
  for (const row of rowsOf(json, "userGroups")) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = str(r.id);
    if (!id) continue;
    out.push(compact({ id, name: str(r.name)?.trim() }));
  }
  return out;
}

/** Case-insensitive match on name or email. An empty query matches everything. */
export function filterUsers(users: ShapedUser[], query?: string): ShapedUser[] {
  const needle = (query ?? "").trim().toLowerCase();
  if (!needle) return users;
  return users.filter(
    (u) => (u.name ?? "").toLowerCase().includes(needle) || (u.email ?? "").toLowerCase().includes(needle)
  );
}

export function filterGroups(groups: ShapedGroup[], query?: string): ShapedGroup[] {
  const needle = (query ?? "").trim().toLowerCase();
  if (!needle) return groups;
  return groups.filter((g) => (g.name ?? "").toLowerCase().includes(needle));
}

export function shapeTaskRow(row: unknown): Record<string, unknown> | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  return compact({
    id,
    title: str(r.title),
    status: str(r.status),
    assignee: str(r.assignee),
    assigneeType: str(r.assigneeType),
    creator: str(r.creator),
    dueDate: str(r.dueDate),
    context: str(r.context),
    isPrivate: bool(r.isPrivate),
    numberOfProducts: num(r.numberOfProducts),
    numberOfDoneProducts: num(r.numberOfDoneProducts),
  });
}

export function shapeTaskDetail(json: unknown): Record<string, unknown> | null {
  const data =
    json && typeof json === "object" && "data" in (json as object)
      ? (json as { data?: unknown }).data
      : json;
  const base = shapeTaskRow(data);
  if (!base) return null;
  const r = data as Record<string, unknown>;
  const products = Array.isArray(r.productsList)
    ? r.productsList
        .map((p) => {
          if (!p || typeof p !== "object") return null;
          const pr = p as Record<string, unknown>;
          const productId = str(pr.productId);
          return productId ? compact({ productId, isDone: bool(pr.isDone) }) : null;
        })
        .filter((p): p is NonNullable<typeof p> => p !== null)
    : [];
  return compact({
    ...base,
    description: str(r.description),
    creationDate: str(r.creationDate),
    products,
  });
}
