# Bluestone PIM — MCP Server

Connects Claude Desktop to the Bluestone PIM Public API (PAPI), allowing you to query catalogs and products directly in chat.

## Quick start

```bash
npm install
npm run build
# Restart Claude Desktop
```

## What you can ask Claude

- "Show me the catalogs"
- "List products in the Products category"
- "Show me the details for ALTOSONIC V12"
- "What attributes does the Cable ladder OE125 3m group have?"

## Docs

| Document | Audience | Description |
|---|---|---|
| [docs/setup-local-nontechnical.md](docs/setup-local-nontechnical.md) | Non-technical users | Local setup only — step-by-step from scratch, no terminal experience needed |
| [docs/how-it-works.md](docs/how-it-works.md) | Developers | How MCP, transports, and auth work |
| [docs/setup-developer.md](docs/setup-developer.md) | Developers | Local (STDIO), deploying to Vercel, and connecting to an existing deployment |
| [docs/tools.md](docs/tools.md) | Developers | The two tools: what they do and how Claude uses them |
| [docs/api.md](docs/api.md) | Developers | Bluestone PAPI endpoints used |
| [docs/extending.md](docs/extending.md) | Developers | How to add new tools and MAPI write support |
| [CHANGELOG.md](CHANGELOG.md) | Developers | History of significant changes |
