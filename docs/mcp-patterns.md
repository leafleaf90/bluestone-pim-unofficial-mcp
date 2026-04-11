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
"Full attribute values are included — surface them only when the user asks for details on a specific product."
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
        `Found ${count} products in "${label}".\n\n` +
        JSON.stringify(data, null, 2),
    },
  ],
};
```

The summary line states the key facts. The JSON is present for the model to query when the user asks for specifics.

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

No JSON wrapper. A mutation has no structured data for the model to reason over — a confirmation string is all that is needed.

---

## Input schema

Use Zod for all parameters. The `.describe()` call is the model's only documentation for each parameter.

```typescript
inputSchema: {
  categoryId: z.string()
    .describe("The category ID — get this from list_catalogs"),
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

Any tool that returns a list must accept `limit` and `page`. Bluestone's PAPI uses `itemsOnPage` and `pageNo` (0-indexed doubles). The tool exposes 1-indexed pages to the model and subtracts 1 before passing to Bluestone.

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

**Cross-page GROUP/VARIANT splits:** With page-based pagination, a GROUP and some of its VARIANTs may land on different pages. Include orphaned VARIANTs (whose parent GROUP is not on the current page) as standalone items in the response — the `type` field tells the model how to display them.

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

When adding a new API helper (e.g. `mapiPatch`, `mapiDelete`), call the appropriate helper in the error path — do not throw raw status strings.

---

## Guardrails: don't offer what doesn't exist

After a mutation, models naturally suggest logical next steps — "would you like to add attributes or assign it to a category?" This is a problem when those tools don't exist: the user says yes, and the model either fails or backtracks, eroding trust.

For any write tool, explicitly state in the description what the model must NOT offer as a follow-up:

```
"After creating, do NOT offer to add attributes or assign the product to a category — 
these tools do not exist yet. Instead, tell the user the product was created and 
suggest they open Bluestone PIM to continue enriching it."
```

The same applies when a tool's scope is intentionally narrow. If `create_product` only sets the name, tell the model that setting other fields is not available — do not leave it to guess what comes next.

---

## Checklist: registering a new tool

- [ ] Description says **when** to call it, not just what it does
- [ ] Description says **what to suppress** unless the user asks
- [ ] Hierarchical data has **display instructions** in the description
- [ ] No **session_init reminder** in the description
- [ ] Write tools include **"confirm with user before calling"**
- [ ] Write tools specify **what NOT to offer as follow-up** if next steps aren't supported
- [ ] Response starts with a **plain-text summary line**
- [ ] Mutations return **plain text only** (no JSON)
- [ ] List tools have **limit + offset** input params
- [ ] List responses include **hasMore, offset, returned** in JSON
- [ ] Errors use **papiErrorMessage / mapiErrorMessage** helpers
- [ ] All input params have a **`.describe()` call**
- [ ] ID params tell the model **where to get them**
