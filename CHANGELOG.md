# Changelog

## Cursor OAuth support — 2026-04-10

### Background

The MCP server previously only supported **Claude Desktop** as an OAuth client. Claude Desktop uses a non-standard but convenient pattern: it encodes two of the three Bluestone credentials directly in the `client_id` field (`{mapiClientId}:{papiKey}`) and supplies the third (`mapiClientSecret`) as `client_secret` at the token exchange step. This sidesteps the need for a login UI.

Cursor follows the OAuth 2.1 + MCP spec more strictly. It uses **dynamic client registration** (RFC 7591), expects a **protected resource metadata** endpoint (RFC 9728), and opens a browser for authorisation rather than letting the user pre-fill credentials in app settings. The existing server was incompatible with all three of these requirements.

---

### What was added

#### `/.well-known/oauth-protected-resource` (new endpoint)

RFC 9728 protected resource metadata. Cursor (and other compliant MCP clients) fetch this before attempting dynamic registration to discover which authorisation server handles this resource. Without it, Cursor could not begin the auth flow.

Returns:
```json
{ "resource": "https://...", "authorization_servers": ["https://..."] }
```

#### `POST /register` (new endpoint)

RFC 7591 dynamic client registration. Cursor POSTs here before opening the authorisation URL. The endpoint returns an opaque `client_id` (random 32-char hex). No state is persisted — Bluestone credentials are unknown at registration time and are collected in the next step.

The registration request's `redirect_uris` array is validated and echoed back in the response, as required by the spec.

#### HTML credentials form at `GET /authorize`

The `/authorize` endpoint now detects which flow is in use based on the `client_id` format:

- **`{mapiClientId}:{papiKey}` format** → legacy Claude Desktop flow, immediate redirect (no change)
- **Opaque `client_id`** (from dynamic registration) → renders an HTML credentials form asking for `mapiClientId`, `mapiClientSecret`, and PAPI key

The form is a minimal, self-contained HTML page served directly from the Vercel function.

#### `POST /authorize` (new route)

Handles form submission from the credentials form. Validates inputs, verifies the CSRF token, encrypts all three Bluestone credentials into an AES-256-GCM auth code, and redirects back to the client's `redirect_uri` with the code — exactly as the legacy flow does.

#### CSRF protection on the form

A CSRF token is generated when the form is rendered and embedded as a hidden field. The token is `HMAC-SHA256(SIGNING_SECRET, "csrf:" + state + ":" + code_challenge)`, binding it to the specific OAuth request parameters so it cannot be replayed across different authorisation requests. Verified server-side with `timingSafeEqual` on form submission.

#### MAPI secret in the auth code (dynamic flow)

In the Claude Desktop flow, `mapiClientSecret` arrives at `/token` as the `client_secret` body parameter. Cursor doesn't send a `client_secret` (it was never issued one at registration). To bridge this, the form collects all three credentials and the POST handler encrypts `mapiClientSecret` into the auth code alongside the other two.

The `/token` endpoint was updated to resolve the MAPI secret from whichever source is available:
- Auth code payload → dynamic registration (Cursor) flow
- `client_secret` body param → legacy (Claude Desktop) flow

Both flows produce an identical encrypted Bearer token. No changes to `/mcp` or downstream credential handling.

#### `/.well-known/oauth-authorization-server` updated

The discovery document now includes `registration_endpoint` so clients know where to register before starting the auth flow.

#### `vercel.json` rewrites updated

Added routing entries for the two new endpoints:
- `/register` → `/api/mcp`
- `/.well-known/oauth-protected-resource` → `/api/mcp`

#### `redirect_uri` validation

`redirect_uri` is now validated on both `GET` and `POST /authorize`. Only `javascript:` and `data:` URIs are rejected — localhost, HTTPS, and custom app URI schemes (e.g. `cursor://`) are all accepted. PKCE remains the primary protection against code interception.

#### CSP (`helmet`)

Helmet's `contentSecurityPolicy` is disabled. Helmet's default CSP includes `form-action 'self'`, which blocked the credentials form POST even when the form action and the page origin were identical (a Vercel routing behaviour). CSRF protection via HMAC token is the equivalent defence. Re-enabling CSP with a proper nonce-based policy is noted as a production hardening item.

---

### What was not changed

- The Claude Desktop OAuth flow is unchanged end-to-end
- `/token` endpoint logic (PKCE verification, auth code decryption, token encryption) is unchanged except for the MAPI secret source resolution described above
- `/mcp` endpoint and all tool logic is unchanged
- `src/tools.ts` is unchanged
- Local STDIO mode is unchanged

---

### Known limitations / production hardening items

See the **Production hardening** table in `docs/how-it-works.md` for the full list. Key items relevant to the Cursor flow:

| Item | Detail |
|---|---|
| No redirect_uri allowlist | URIs are not validated against what was registered at `/register`. Full fix requires persisting registrations. |
| Stateless registration | Any opaque `client_id` is accepted at `/authorize` — unregistered clients can reach the form. |
| CSP disabled | Should be re-enabled with a nonce-based policy before production exposure. |
| No rate limiting | `/register`, `/authorize`, and `/token` have no rate limiting. |
