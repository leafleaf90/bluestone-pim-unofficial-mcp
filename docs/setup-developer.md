# Setup: Developer guide

There are three ways to run the unofficial Bluestone PIM MCP server:

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

The task tools need extra permissions on the MAPI client: `TASKS` (ADD, READ, UPDATE, ASSIGN, plus the `*_PRIVATE` variants for private tasks), `USER / LIST` for `list_users`, and `USER_GROUP / READ` for `list_user_groups`. Without them those tools return a 403 that names the missing permission. The other tools are unaffected.

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

> **Minimum length:** `SIGNING_SECRET` must be at least 32 characters. Shorter values make the server refuse to issue or accept tokens.
>
> **Rotation without disruption:** set `SIGNING_SECRET` to the new value and put the old one in `SIGNING_SECRET_PREVIOUS`. New tokens use the new secret, existing tokens keep working until they expire (access tokens last under an hour). Remove `SIGNING_SECRET_PREVIOUS` after a day. Rotate every 90 days, and immediately if you suspect compromise: in that case skip `SIGNING_SECRET_PREVIOUS` (all tokens are invalidated and users reconnect once) or set `TOKEN_NOT_BEFORE` to the current Unix time in seconds to cut off everything issued earlier.

### Optional hardening variables

| Variable | Effect |
|---|---|
| `MCP_READ_ONLY=true` | Registers only read tools. Write tools are not exposed. |
| `REDIRECT_URI_ALLOWLIST` | Comma-separated exact redirect URIs to accept in addition to the built-in defaults (Claude, ChatGPT, VS Code, Cursor, loopback). A trailing `*` makes a prefix match. |
| `REDIRECT_URI_HOST_ALLOWLIST` | Comma-separated extra https hosts to trust for any path. Weaker than exact URIs, because an open redirect on an allowed host can leak codes. `*` opens the allowlist completely. |
| `EXTRA_REDIRECT_SCHEMES` | Custom URI schemes to accept. Only used when the allowlist is open (`REDIRECT_URI_HOST_ALLOWLIST=*`). |
| `MCP_ALLOWED_ORIGINS` | Comma-separated browser Origins allowed on `/mcp`, in addition to claude.ai, claude.com, chatgpt.com, vscode.dev, and cursor.com. Native clients send no Origin and are unaffected. `*` disables the check. |
| `ALLOW_LEGACY_CLIENT_ID_FLOW=false` | Disables the Claude Desktop flow that carries credentials in `client_id` (and therefore in URLs and platform logs). On by default for compatibility. |
| `LENIENT_TOKEN_REDIRECT_CHECK=true` | Temporary escape hatch: only compare `redirect_uri` and `client_id` at `/token` when the client sends them. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Optional shared store (`KV_REST_API_URL` and `KV_REST_API_TOKEN` also work). Enables cross-instance rate limits and failure throttling, single-use auth codes, rotating refresh tokens, and `/revoke`. Without it the server stays stateless. |
| `REQUIRE_SHARED_STORE=true` | Refuse requests when no shared store is configured, and answer 503 (with `Retry-After`) when the store errors at runtime instead of falling back to per-instance memory. Without it, a store outage degrades single-use codes, refresh reuse detection and revocation to per-instance only. Recommended for shared deployments. |
| `SIGNING_SECRET_PREVIOUS` | Old signing secret(s) accepted during rotation. |
| `TOKEN_NOT_BEFORE` | Unix timestamp in seconds. Tokens and refresh tokens issued earlier are rejected. |
| `ENABLE_ELICITATION=true` | Ask the client to confirm bulk and schema writes through MCP elicitation on stateless HTTP too. Only for clients known to keep the response stream open. The default on HTTP is a preview plus confirmation token. |
| `IMAGE_HOST_ALLOWLIST` | Comma-separated domain suffixes `get_product_image` may fetch, in addition to `bluestonepim.com`. |
| `PUBLIC_BASE_URL` | Public URL of the deployment (for example `https://my-mcp.example.com`). Used in OAuth metadata instead of the request Host header. Recommended outside Vercel. |
| `ALLOW_HEADER_AUTH=true` | Accepts raw credentials in `x-papi-key`, `x-mapi-client-id`, and `x-mapi-client-secret` headers. Local development only. Off by default. |

> Registered client IDs are signed with the same secret, so they follow the same rotation rules. Without `SIGNING_SECRET_PREVIOUS`, clients such as Cursor register again automatically on the next connection.

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
2. The server checks `redirect_uri` against the allowlist, extracts credentials from `client_id`, encrypts them into a short-lived single-use AES-256-GCM auth code, and redirects back; `mapiClientSecret` is intentionally absent so it never travels in the redirect
3. Claude Desktop exchanges the code at `/token`, sending the PKCE verifier, the same `redirect_uri` and `client_id`, and `client_secret` (the MAPI secret). The server validates the secret against Bluestone before issuing a token
4. The server decrypts the auth code, checks expiry, binding, and the PKCE challenge, then seals all three credentials into a Bearer token bound to this server's `/mcp` audience
5. All subsequent MCP requests carry that Bearer token; the server decrypts it and rejects it if expired, revoked, or minted for another audience. Without a shared store nothing is stored on the server. With one, an encrypted refresh record is kept for up to 30 days

**Cursor and other RFC 7591 clients (dynamic registration flow)**

1. Cursor POSTs to `/register` and receives an opaque `client_id`
2. Cursor opens a browser to `/authorize`; the server detects the opaque `client_id` and renders an HTML form
3. The user enters all three Bluestone credentials in the form: `mapiClientId`, `mapiClientSecret`, and PAPI key
4. The server verifies a cookie-bound CSRF token, checks the credentials against Bluestone, encrypts them into a single-use AES-256-GCM auth code, and redirects back to Cursor. The form has a "Read-only session" checkbox that hides every write tool for that connection
5. Cursor exchanges the code at `/token` with the PKCE verifier, `redirect_uri`, and `client_id`; the MAPI secret is already inside the encrypted auth code, so no `client_secret` param is needed

### Upgrading from an earlier version

- **Re-authentication:** the token format changed (`v2`). Existing tokens and auth codes stop working, and users connect once more. Set `SIGNING_SECRET` to at least 32 characters first.
- **Redirect allowlist:** only the known client callbacks and loopback are accepted by default. If you connect a different client, add its exact callback to `REDIRECT_URI_ALLOWLIST`. Previously any https URL was accepted.
- **`/token` strictness:** `redirect_uri` and `client_id` are now required and must match the authorization request. If a client breaks, set `LENIENT_TOKEN_REDIRECT_CHECK=true`, then report the client so it can be fixed.
- **Header auth:** `x-papi-key` and `x-mapi-*` headers are rejected unless `ALLOW_HEADER_AUTH=true`.
- **Write tools on HTTP:** five bulk or schema tools now return a preview and `confirmationToken` first. The assistant calls them again after you approve.
- **Optional store:** adding the Upstash variables turns on refresh tokens and revocation. This changes the "nothing is stored" promise, so update any internal documentation you give to users.
- **Legacy flow:** consider `ALLOW_LEGACY_CLIENT_ID_FLOW=false` once all users run a client that supports dynamic registration.

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
