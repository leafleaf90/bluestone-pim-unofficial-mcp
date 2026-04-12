# MCP Tool Patterns

Rules and patterns to follow when adding or modifying tools in this server. Read this before touching `src/tools.ts`. For skeletons and build commands, see [extending.md](extending.md). For the reasoning behind these decisions, see [mcp-design.md](mcp-design.md).

---

## Philosophy

Four principles guide every tool in this server:

1. **Tools serve models, not developers.** Descriptions, response text, and error messages are read by a language model at inference time. Write them accordingly.
2. **Surface summaries, not raw data.** Lead every response with a plain-text summary line. Models are less likely to paste raw JSON into chat when the key facts are already stated.
3. **Fail with user-actionable messages.** Errors go through the model to the user. "PAPI error 401" is useless. "Your API key may be invalid or expired" is not.
4. **Guide the model, not just the user.** Descriptions tell the model when to call a tool, what to do with the result, and what to suppress unless asked.

---

## Tool descriptions

Descriptions are the model's only documentation for a tool. They determine when the tool is called and how its output is used.

### Say when to call the tool, not just what it does

Include the trigger condition and any required sequencing.

```
// Bad
"List products in a category."

// Good
"List products in a Bluestone PIM catalog. Call list_catalogs first to get valid category IDs."
```

### Say what to suppress unless asked

Without this, models dump every field into chat.

```
"Full attribute values are included; surface them only when the user asks for details on a specific product."
```

### Include display instructions for hierarchical data

If the response has a structure the model needs to reproduce in chat, describe it explicitly.

```
"Show GROUP products with their VARIANT children listed beneath them. Never show VARIANTs at the top level."
```

### Do not add session_init reminders to data tools

The `session_init` description already enforces first-call behaviour. Repeating the reminder on every other tool is noise that trains the model to second-guess whether it already called it.

### Write tools must require user confirmation

Any tool that creates, updates, or deletes data must include:

```
"Always confirm [the action] with the user before calling this tool."
```

---

## Response format

### Read tools: summary line + JSON

```typescript
return {
  content: [
    {
      type: "text" as const,
      text:
        `Found ${count} products in "${label}" (working state).\n\n` +
        JSON.stringify(data, null, 2),
    },
  ],
};
```

The summary line states the key facts. The JSON is present for the model to query when the user asks for specifics.

**Always label the data source in the summary line.** Append `(working state)` for MAPI reads, `(published)` for PAPI reads. This lets the model tell the user which version of the data they are looking at without requiring them to know which tool was called.

```
// MAPI tools
"Found 3 catalogs (working state)."
"Found products in \"Pasta\" (working state). Returned 8 on page 1."

// PAPI tools
"Found 3 published catalogs."
"Found 24 published products in \"Pasta\"."
```

### Write tools: plain text only

```typescript
return {
  content: [
    {
      type: "text" as const,
      text: `Product "${name}" created successfully. ID: ${resourceId}`,
    },
  ],
};
```

No JSON wrapper. A mutation has no structured data for the model to reason over. A confirmation string is all that is needed.

---

## Tool annotations

Every tool must declare annotations. They tell compliant clients how to handle the tool: whether to auto-execute it, whether to warn the user, and whether calling it twice is safe.

```typescript
annotations: {
  readOnlyHint: true,   // true for reads; false for any tool that writes, updates, or deletes
  destructiveHint: false, // true if the action is hard to undo (create, delete, overwrite)
  idempotentHint: true,   // true if calling twice has the same effect as calling once
}
```

Rules:
- Read tools: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`
- Write tools (create/update/delete): `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`
- An update that is safe to retry (e.g. setting a field to the same value) may set `idempotentHint: true`

**A note on `destructiveHint: true` for create operations.** Strictly speaking, `destructiveHint` is intended for actions that are hard to undo or that overwrite data (deletes, overwrites). Creating a new product is not destructive in that sense: nothing is removed and the product can be cleaned up. There is a reasonable argument for setting `destructiveHint: false` on `create_product`. We keep it `true` as a conservative default because: (a) it prompts the client (Claude Desktop) to ask the user to confirm before calling the tool, which is good UX for a first-time user naming something in a live PIM; and (b) the extra confirmation turn is a small cost compared to an accidental creation in a shared catalog. If this turns out to be friction for experienced users, flip it to `false`.

Annotations are hints to the client, not enforced by the protocol. But omitting them leaves the client to assume worst-case defaults, which means unnecessary confirmation prompts on read tools and no extra caution on writes.

---

## Input schema

Use Zod for all parameters. The `.describe()` call is the model's only documentation for each parameter.

```typescript
inputSchema: {
  categoryId: z.string()
    .describe("The category ID; get this from list_catalogs"),
  limit: z.number().int().min(1).max(200).optional()
    .describe("Max products to return (default 50). Call again with a higher offset for more."),
}
```

Rules:
- Every parameter must have a `.describe()`.
- ID parameters must tell the model where to obtain them.
- Optional parameters must state their default and what to do if the result is insufficient.

---

## Pagination

Any tool that returns a list must accept `limit` and `page`. Both APIs use 0-indexed pagination internally; the tool always exposes 1-indexed `page` to the model and subtracts 1 before passing to Bluestone. PAPI uses `itemsOnPage`/`pageNo`; MAPI uses `page`/`pageSize`. See `docs/mcp-design.md` for the full comparison.

```typescript
inputSchema: {
  limit: z.number().int().min(1).max(MAX_PRODUCT_LIMIT).optional()
    .describe(`Products per page (default ${DEFAULT_PRODUCT_LIMIT}, max ${MAX_PRODUCT_LIMIT}). If hasMore is true, call again with page incremented by 1.`),
  page: z.number().int().min(1).optional()
    .describe("Page number to fetch, 1-indexed (default 1)."),
}
```

Always include pagination metadata in the response JSON and in the summary line:

```typescript
const effectiveLimit = limit ?? DEFAULT_PRODUCT_LIMIT;
const effectivePage = page ?? 1;
const totalPages = Math.ceil(data.totalCount / effectiveLimit);
const hasMore = effectivePage < totalPages;

// Query string passed to Bluestone (pageNo is 0-indexed):
// ?subCategories=true&itemsOnPage=${effectiveLimit}&pageNo=${effectivePage - 1}

text:
  `Found ${data.totalCount} items` +
  (hasMore
    ? `, showing page ${effectivePage} of ${totalPages}. Call again with page=${effectivePage + 1} to fetch more.`
    : ".") +
  "\n\n" +
  JSON.stringify({ totalCount, page: effectivePage, totalPages, returned: showing, hasMore, results }, null, 2)
```

**Cross-page GROUP/VARIANT splits:** With page-based pagination, a GROUP and some of its VARIANTs may land on different pages. Include orphaned VARIANTs (whose parent GROUP is not on the current page) as standalone items in the response; the `type` field tells the model how to display them.

---

## Error messages

Use the `papiErrorMessage` and `mapiErrorMessage` helpers in `src/tools.ts`. They map HTTP status codes to user-facing strings:

| Status | Message |
|---|---|
| 401 | "Authentication failed. Your [key/credentials] may be invalid or expired." |
| 403 | "Access denied. [Key/client] does not have permission for this resource." |
| 404 | "Resource not found." |
| 409 | "Conflict. A resource with this name or ID may already exist." |
| 429 | "Rate limit exceeded. Wait a moment and try again." |
| other | `Bluestone [PAPI/MAPI] error {status}: {body}` |

When adding a new API helper (e.g. `mapiPatch`, `mapiDelete`), call the appropriate helper in the error path. Do not throw raw status strings.

---

## Tool bypass: when the model reaches for code instead

When Claude has code execution or artifact creation available alongside the MCP, it sometimes reasons "I can fetch this via HTTP" and tries to call the Bluestone API directly using bash or an artifact. This always fails because the credentials only exist inside the MCP tool execution context, but it erodes trust and wastes the user's time.

Two defenses, applied in combination:

**1. Server-level instruction (highest priority)**

The `instructions` field on `McpServer` is sent during the MCP handshake and read before any tool call. It should explicitly block the detour:

```
"IMPORTANT: All Bluestone PIM data must come from the tools in this server. " +
"Do not attempt to fetch Bluestone data using HTTP requests, bash commands, code artifacts, or any other method. " +
"The tools handle authentication and API access internally. " +
"Direct API calls will fail because credentials are only available inside the tool execution context."
```

**2. Per-tool description guard on high-traffic entry points**

Add a one-sentence guard to the description of any tool that is the natural entry point for data access. `list_catalogs` and `list_products_in_category` are the common targets:

```
"Do not attempt to fetch catalog data via HTTP, bash, or code. Use this tool directly."
```

**What this does not fix**

These instructions reduce the frequency but are not a complete solution. When the model has strong code execution priors (e.g. the conversation was opened in Code mode, or the system prompt emphasizes code) it may still choose code over the MCP tool. The only reliable mitigation is user-side: phrasing requests as "Using Bluestone PIM, show me..." names the source explicitly and makes the MCP tools the obvious match. If the behavior occurs mid-conversation, redirecting with "Don't write code. Use the Bluestone PIM tools directly." usually corrects it.

Document this limitation where users will encounter it: in the Troubleshooting section of the connect page.

---

## Guardrails: don't offer what doesn't exist

After a mutation, models naturally suggest logical next steps: "would you like to add attributes or assign it to a category?" This is a problem when those tools don't exist: the user says yes, and the model either fails or backtracks, eroding trust.

For any write tool, explicitly state in the description what the model must NOT offer as a follow-up:

```
"After creating, do NOT offer to add attributes or assign the product to a category.
These tools do not exist yet. Instead, tell the user the product was created and 
suggest they open Bluestone PIM to continue enriching it."
```

The same applies when a tool's scope is intentionally narrow. If `create_product` only sets the name, tell the model that setting other fields is not available. Do not leave it to guess what comes next.

---

## Checklist: registering a new tool

- [ ] Description says **when** to call it, not just what it does
- [ ] Description says **what to suppress** unless the user asks
- [ ] Hierarchical data has **display instructions** in the description
- [ ] No **session_init reminder** in the description
- [ ] Write tools include **"confirm with user before calling"**
- [ ] Write tools specify **what NOT to offer as follow-up** if next steps aren't supported
- [ ] Response starts with a **plain-text summary line** with **(working state)** or **(published)** label
- [ ] Mutations return **plain text only** (no JSON)
- [ ] List tools have **limit + offset** input params
- [ ] List responses include **hasMore, offset, returned** in JSON
- [ ] Errors use **papiErrorMessage / mapiErrorMessage** helpers
- [ ] All input params have a **`.describe()` call**
- [ ] ID params tell the model **where to get them**
- [ ] Tool has **`annotations`** with `readOnlyHint`, `destructiveHint`, and `idempotentHint` set
