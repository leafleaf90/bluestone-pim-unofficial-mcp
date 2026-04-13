# Bluestone PIM MCP Server

An open-source MCP server that connects AI assistants (Claude Desktop, Cursor, ChatGPT) to your Bluestone PIM organisation. Browse catalogs, explore products, and create new products directly in chat.

> **Bluestone Labs community project.** Not an official product. No SLA. Contributions and forks welcome.

## Quick start

You need a Bluestone PIM MAPI Client ID, MAPI Client Secret, and PAPI Key before you begin. Contact your Bluestone PIM administrator if you don't have these.

```bash
npm install
npm run build
# Restart Claude Desktop
```

For full setup instructions, see the [connect page](https://bluestone-mcp-unofficial.vercel.app/connect) or [docs/setup-developer.md](docs/setup-developer.md).

## What you can ask

- "Using Bluestone PIM, show me my catalogs"
- "List all products in the first catalog you found"
- "Show me products in Dutch"
- "Show me only published products in the Clothes catalog"
- "Create a new product called Summer Jacket"

## Docs

| Document | Audience | Description |
|---|---|---|
| [docs/setup-local-nontechnical.md](docs/setup-local-nontechnical.md) | Non-technical users | Local setup, step-by-step |
| [docs/how-it-works.md](docs/how-it-works.md) | Developers | MCP, transports, auth, and security model |
| [docs/setup-developer.md](docs/setup-developer.md) | Developers | Local (STDIO), Vercel deployment, connecting clients |
| [docs/tools.md](docs/tools.md) | Developers | Available tools and how the model uses them |
| [docs/compatibility.md](docs/compatibility.md) | Developers | Confirmed and expected client compatibility |
| [docs/extending.md](docs/extending.md) | Developers | Adding new tools |
| [docs/mcp-patterns.md](docs/mcp-patterns.md) | Developers | Required patterns and checklist for tool authors |
| [docs/api-quick-reference.md](docs/api-quick-reference.md) | Developers | Bluestone API endpoints and shapes |
| [CHANGELOG.md](CHANGELOG.md) | Developers | History of significant changes |

## For SI partners

If you implement Bluestone for clients, you can fork this repo and build your own MCP server tailored to your workflows. Add tools, extend the data model, deploy under your own Vercel instance.

A Bluestone Labs community project. Questions? Open an issue on GitHub or reach out on Slack.

Start with `src/tools.ts` (where tools are registered) and [docs/extending.md](docs/extending.md).

## For customers

This is a Bluestone Labs community project, not an official Bluestone product.

It works against the documented Bluestone APIs using your own credentials. If you run the server locally or deploy your own Vercel instance, your credentials stay entirely within your own infrastructure and are never stored by this project. See [docs/how-it-works.md](docs/how-it-works.md) for the full security model.

The shared test deployment at `bluestone-mcp-unofficial.vercel.app` is fine for a quick look. For anything beyond that, run your own instance (Option B in the [setup guide](docs/setup-developer.md)) so you control where credentials go. If your organisation has a security review process, loop them in before deploying.

## Author

Built by [Viktor Lövgren](https://www.linkedin.com/in/viktorlovgren/). A Bluestone Labs community project.

## License

MIT
