# Setup: Developer guide

There are three ways to run the Bluestone PIM MCP server:

| Mode | Who runs it | What's needed |
|---|---|---|
| **Local (STDIO)** | You, on your own machine | Node.js installed locally |
| **Remote (Vercel)** | A deployed serverless function anyone can connect to | A Vercel deployment + credentials |

Jump to the option that fits:
- [Option A: Local setup](#option-a-local-setup-stdio) - run the server on your own machine
- [Option B: Deploy to Vercel](#option-b-deploy-to-vercel) - host the server so others can connect without Node.js
- [Option C: Connect via Claude Desktop](#option-c-connect-to-an-existing-vercel-deployment-claude-desktop) - someone else has already deployed it, connect with Claude Desktop
- [Option D: Connect via Cursor](#option-d-connect-to-an-existing-vercel-deployment-cursor) - someone else has already deployed it, connect with Cursor

---

## Option A: Local setup (STDIO)

### Prerequisites

- [Claude Desktop](https://claude.ai/download) (Mac or Windows)
- Node.js 18 or higher (`node --version` to check)

### 1. Install dependencies

```bash
cd bluestone-unofficial-mcp
npm install
```

### 2. Configure credentials

Add credentials to the `.env` file (use `.env.example` as the template):

```
PAPI_KEY=your-papi-key-here
MAPI_CLIENT_ID=your-mapi-client-id
MAPI_CLIENT_SECRET=your-mapi-client-secret
```

This file is excluded from git. Do not commit it.

### 3. Build

```bash
npm run build
```

This compiles `src/index.ts` → `build/src/index.js`. Claude Desktop runs the compiled output.

### 4. Configure Claude Desktop

The config file is at:

```
~/Library/Application Support/Claude/claude_desktop_config.json   (macOS)
%APPDATA%\Claude\claude_desktop_config.json                        (Windows)
```

Add the `mcpServers` entry:

```json
{
  "mcpServers": {
    "bluestone-pim": {
      "command": "node",
      "args": ["/absolute/path/to/bluestone-unofficial-mcp/build/src/index.js"],
      "env": {
        "PAPI_KEY": "your-papi-key-here",
        "MAPI_CLIENT_ID": "your-mapi-client-id",
        "MAPI_CLIENT_SECRET": "your-mapi-client-secret"
      }
    }
  }
}
```

The `env` block passes credentials to the server process securely.

### 5. Restart Claude Desktop

Quit and relaunch Claude Desktop. It reads the config on startup and launches the server as a child process.

---

## Option B: Deploy to Vercel

Follow this if you want to host your own instance of the server so others can connect without installing anything locally.

### 1. Install the Vercel CLI and deploy

```bash
npm install -g vercel   # one-time
vercel --prod           # follow prompts on first run
```

Vercel will give you a deployment URL, e.g. `https://your-project.vercel.app`.

### 2. Set the signing secret

`SIGNING_SECRET` is used to encrypt auth codes and Bearer tokens. Without it the server will refuse all auth requests.

Generate a value:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add it in Vercel: **Project → Settings → Environment Variables → Add**. Key: `SIGNING_SECRET`, value: the generated string. Redeploy after adding it:

```bash
vercel --prod
```

> **Rotation:** Rotate `SIGNING_SECRET` periodically (every 90 days is a reasonable baseline) and immediately if you suspect it has been compromised. When rotated, all existing Bearer tokens are invalidated; users will need to reconnect once to get a new token.

### 3. Share the URL with users

Give users your deployment URL (e.g. `https://your-project.vercel.app/mcp`) and point them to [Option C](#option-c-connect-to-an-existing-vercel-deployment) below.

---

## Option C: Connect to an existing Vercel deployment (Claude Desktop)

Follow this if someone else has already deployed the server and given you the URL.

> **Community test deployment:** `https://bluestone-mcp-unofficial.vercel.app/mcp`, available for testing if you don't have your own deployment yet.

### 1. Open the connector UI

Claude Desktop → **Settings** → **Customize** → **Connectors** → **Add custom connector**

### 2. Fill in the fields

- **Name**: `Bluestone PIM` (or anything you like)
- **URL**: the deployment URL, ending in `/mcp`

Then open **Advanced settings**:

- **Client ID**: your MAPI Client ID and PAPI key joined with a colon, no spaces:
  ```
  your-mapi-client-id:your-papi-key
  ```
  Example: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy`

- **Client Secret**: your MAPI Client Secret

### 3. Authorise

Click **Add**. A browser window opens briefly and closes. That is the OAuth authorisation flow completing. Normal behaviour.

The connector will appear in your list. Enable it with the toggle.

---

## Option D: Connect to an existing Vercel deployment (Cursor)

> **Community test deployment:** `https://bluestone-mcp-unofficial.vercel.app/mcp`, available for testing if you don't have your own deployment yet.

### 1. Add the server to your Cursor config

Edit `.cursor/mcp.json` (create it if it doesn't exist):

```json
{
  "mcpServers": {
    "bluestone-pim": {
      "type": "http",
      "url": "https://bluestone-mcp-unofficial.vercel.app/mcp"
    }
  }
}
```

Replace the URL with your own deployment URL if you have one.

### 2. Authorise

Cursor will open a browser window showing a **Connect to Bluestone PIM** form. Enter your credentials:

- **MAPI Client ID**: your MAPI Client ID (UUID format)
- **MAPI Client Secret**: your MAPI Client Secret
- **PAPI Key**: your PAPI key

Click **Authorise**. The browser window closes and Cursor completes the OAuth flow automatically.

> Cursor uses dynamic client registration (RFC 7591), which is why you see a form instead of the instant redirect that Claude Desktop does. Both flows produce the same encrypted Bearer token; the difference is only in how credentials are collected.

---

## How the remote credential flow works

The server supports two OAuth 2.1 + PKCE flows depending on the client.

**Claude Desktop (legacy flow)**

Claude Desktop encodes credentials directly in `client_id` as `{mapiClientId}:{papiKey}`:

1. Claude Desktop opens `/authorize` with the composite `client_id` and a PKCE S256 challenge
2. The server validates `redirect_uri` (must be localhost or HTTPS), extracts credentials from `client_id`, encrypts them into a short-lived AES-256-GCM auth code, and redirects back; the payload is opaque in the redirect URL, and `mapiClientSecret` is intentionally absent so it never travels in the redirect
3. Claude Desktop exchanges the code at `/token`, sending the PKCE verifier and `client_secret` (the MAPI secret)
4. The server decrypts the auth code, checks expiry, verifies the PKCE challenge, then encrypts all three credentials into a Bearer token using AES-256-GCM
5. All subsequent MCP requests carry that encrypted Bearer token; the server decrypts it, verifies the embedded expiration timestamp, and rejects it if expired. Nothing is stored on the server

**Cursor and other RFC 7591 clients (dynamic registration flow)**

1. Cursor POSTs to `/register` and receives an opaque `client_id`
2. Cursor opens a browser to `/authorize`; the server detects the opaque `client_id` and renders an HTML form
3. The user enters all three Bluestone credentials in the form: `mapiClientId`, `mapiClientSecret`, and PAPI key
4. The server verifies a CSRF token (to prevent cross-site form submission), encrypts all three credentials into an AES-256-GCM auth code, and redirects back to Cursor
5. Cursor exchanges the code at `/token` with only the PKCE verifier; the MAPI secret is already inside the encrypted auth code, so no `client_secret` param is needed

---

## Verifying it works

**Check Claude Desktop UI:**

Click the **+** button in the chat input bar, then select **Connectors**. You should see `bluestone-pim` listed with a blue toggle: that means the server is connected and active.

**Check the MCP logs (local only):**

```bash
tail -f ~/Library/Logs/Claude/mcp-server-bluestone-pim.log
```

---

## Rebuilding after changes (local only)

Whenever you edit `src/tools.ts` or `src/index.ts`:

```bash
npm run build
# Restart Claude Desktop
```

Claude Desktop must be restarted to pick up changes; it only reads the config and launches the server once at startup.

---

## Adding or updating examples

The Examples section on the connect page is driven by a `EXAMPLES` data array and a `renderClaudeWindow()` rendering function, both in `public/connect/index.html`. Each entry in `EXAMPLES` is a plain object describing one conversation. No framework, just data and a function.

### Example object shape

```javascript
{
  chatTitle: 'Clothes catalog',       // shown as the open chat title inside the mock window
  label: 'Browse a catalog and create a product',  // heading above the window
  turns: [ /* see turn types below */ ],
  screenshot: {                        // optional: shown below the window
    src: 'chat_examples/my-image.webp',
    caption: 'Alt text and caption',
  },
  missing: [                           // optional: "What's missing" section (HTML strings)
    '<strong>Feature name:</strong> explanation.',
  ],
  notes: [                             // optional: "About this conversation" section (HTML strings)
    '<strong>Observation:</strong> explanation.',
  ],
}
```

### Turn types

| Type | Fields | Renders as |
|---|---|---|
| `user` | `text` (HTML string) | Right-aligned dark bubble |
| `reply` | `text` (HTML string) | Left-aligned Claude response with copy/thumbs icons |
| `tool` | `name` (tool name), `display` (optional label override) | Grey tool-call line with `>` chevron |
| `form` | `pairs: [{ q, a }]` | Right-aligned bubble showing Q&A rows, labelled "Form responses". Use this to represent Claude Desktop's interactive option-picker UI |

Use `display` on tool turns to match the exact label Claude Desktop shows (e.g. `'Loaded tools, used Bluestone PIM integration'`). If omitted, the tool name is title-cased automatically.

HTML is rendered directly in `text`, `q`, `a`, and the `missing`/`notes` arrays, so you can use `<strong>`, `<code>`, `<br>`, `&mdash;`, etc.

### Adding a screenshot to an example

1. Drop the PNG or JPG into `public/connect/images/chat_examples/`
2. Run the optimizer:
   ```bash
   npm run optimize-images
   ```
   This converts to WebP, resizes to max 1400px wide, and deletes the original.
3. Set the `screenshot` field on the example object using the `.webp` filename.

### Adding or updating static screenshots (non-example images)

Screenshots outside the examples live in `public/connect/images/`. Same optimization workflow: drop PNG/JPG in, run `npm run optimize-images`, reference the `.webp` output.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `bluestone-pim` missing under + → Connectors | Config not read or server crashed at start | Check `~/Library/Logs/Claude/mcp-server-bluestone-pim.log` (local) or Vercel function logs (remote) |
| "Authorization with the MCP server failed" | Wrong credentials or malformed client_id | Double-check the `mapiClientId:papiKey` format: colon separator, no spaces |
| Tool call returns error | API key wrong or network issue | Test the curl in [api.md](api.md) directly |
| `Cannot find module` error | Build not run | Run `npm run build` |
| Changes not appearing | Claude Desktop not restarted | Quit and relaunch |
