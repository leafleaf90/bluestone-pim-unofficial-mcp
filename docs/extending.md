# Extending the MCP server

All tools live in `src/tools.ts` inside the `createMcpServer()` factory function. This file is shared by both the local STDIO entry point (`src/index.ts`) and the Vercel handler (`api/mcp.ts`).

Before writing a new tool, read [mcp-patterns.md](mcp-patterns.md) for the required description, response format, and error handling rules. The skeletons below are the minimal starting point; the patterns doc explains what goes in each field and why.

---

## Adding a new read tool (PAPI)

Copy this skeleton into `src/tools.ts` inside `createMcpServer`, before the `return server` line:

```typescript
server.registerTool(
  "your_tool_name",
  {
    description:
      "What this tool does and when to call it. " +
      "Mention which other tool to call first if an ID is needed. " +
      "State what to suppress unless the user specifically asks.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      someId: z.string().describe("The ID; get this from your_other_tool"),
    },
  },
  async ({ someId }) => {
    const data = await papiGet<YourResponseType>(`/your-endpoint/${someId}`, creds);

    return {
      content: [
        {
          type: "text" as const,
          // Lead with a plain-text summary, then JSON. See mcp-patterns.md.
          text: `Found ${data.totalCount} items.\n\n` + JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);
```

Then rebuild:

```bash
npm run build
# Restart Claude Desktop (local); remote deploys pick up automatically on next Vercel deploy
```

---

## Adding new MAPI write tools

MAPI is already wired up: the Bearer token cache, `getBearerToken()`, and `mapiPost()` helper are all in `src/tools.ts`. To add a new write tool, register it inside `createMcpServer`.

The token is fetched automatically on first use, cached per `clientId`, and refreshed 60 seconds before expiry (tokens last 1 hour). You never need to manage auth.

### Available MAPI helpers

```typescript
// POST: create a resource
// Returns the parsed response body and the resource-id header (ID of the created resource)
mapiPost<T>(path: string, body: unknown, creds: Credentials): Promise<{ data: T; resourceId: string | null }>
```

For other HTTP methods (PATCH, PUT, DELETE), add a helper following the same pattern as `mapiPost` in `src/tools.ts`. For example, a `mapiPatch` helper for updates:

```typescript
async function mapiPatch(path: string, body: unknown, creds: Credentials): Promise<void> {
  const token = await getBearerToken(creds);
  let res: Response;
  try {
    res = await fetch(`${MAPI_BASE}${path}`, {
      method: "PATCH",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: timeoutSignal(),
    });
  } catch (err) { wrapFetchError(err, "Bluestone MAPI"); }
  if (!res!.ok) {
    const responseText = await res!.text();
    throw new Error(mapiErrorMessage(res!.status, responseText));
  }
}
```

### Example: update a product name

```typescript
server.registerTool(
  "update_product_name",
  {
    description: "Update the name of a product in Bluestone PIM. Use the product ID from list_products_in_category. Always confirm the new name with the user before calling.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    inputSchema: {
      productId: z.string().describe("The product ID to update"),
      newName: z.string().describe("The new product name"),
    },
  },
  async ({ productId, newName }) => {
    await mapiPatch(`/pim/products/${productId}`, { name: newName }, creds);
    return {
      content: [{ type: "text" as const, text: `Product renamed to "${newName}".` }],
    };
  }
);
```

---

## Deploying to Vercel

The Vercel deployment is already set up in `api/mcp.ts` and `vercel.json`. See [setup-developer.md](setup-developer.md), Option B for the user-facing config.

To deploy:

```bash
npm install -g vercel   # one-time
vercel                  # follow prompts, deploy to production with --prod
```

The server has no persistent storage. Each request creates a new `McpServer` instance with credentials from the encrypted Bearer token. MAPI OAuth tokens are cached in memory on warm Vercel instances for performance but are not persisted to disk and are not shared across instances.
