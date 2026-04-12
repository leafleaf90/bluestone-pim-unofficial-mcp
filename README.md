# Bluestone PIM — Unofficial MCP Server

An unofficial, open-source MCP server that connects AI assistants (Claude Desktop, Cursor, ChatGPT) to your Bluestone PIM organisation. Browse catalogs, explore products, and create new products directly in chat.

> **Disclaimer:** This is a personal side project. It is not an official Bluestone PIM product and is not endorsed, supported, or affiliated with Bluestone PIM in any capacity. Use at your own risk.

## Quick start

You need a Bluestone PIM MAPI Client ID, MAPI Client Secret, and PAPI Key before you begin. Contact your Bluestone PIM administrator if you don't have these.

```bash
npm install
npm run build
# Restart Claude Desktop
```

For full setup instructions, see the [connect page](https://bluestone-mcp-inofficial.vercel.app/connect) or [docs/setup-developer.md](docs/setup-developer.md).

## What you can ask

- "Show me the catalogs in Bluestone PIM"
- "List all products in the first catalog you found"
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

## License

MIT
