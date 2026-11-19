# Changelog

## Pre-commit audit fixes: 2026-11-19

### Fixed

- Non-string `/token`, `/authorize`, `/validate-credentials` and `/register` fields (JSON objects, arrays, numbers, booleans, repeated form keys) now give a clean 400. Before, `unseal()` threw on `.split()`, which hung the request and raised an unhandled rejection (Express 4 does not catch async handler errors). `unseal` and `verifySignature` return null/false for non-strings, bodies and query strings are reduced to string fields, and every async route goes through `asyncRoute`, which forwards errors to the JSON error handler.
- Redirect policy matches the parsed URL, not the raw string. It rejects dot segments, encoded dots/slashes/backslashes/NUL in the path, backslashes, spaces and control characters, and prefix entries must stay on the same origin. `https://chatgpt.com/connector/oauth/../../x` used to pass the prefix entry.
- With `REQUIRE_SHARED_STORE=true`, a shared store error returns 503 with `Retry-After` instead of falling back to per-instance memory.
- `vercel-build` removes `.DS_Store` from the deployed output; `/connect` gets `nosniff`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy` headers.

### Changed

- The write-gate preview tells the model that names in it are unverified and that IDs are what change.
- `npm run test:security` now has 45 tests, including malformed-type, redirect-normalisation, store fail-closed and a pinned list of ungated write tools.

## Remaining hardening: 2026-11-05

### Added

- Optional shared store (`src/store.ts`, Upstash Redis REST) with an in-memory fallback. It backs rate limits, per-client failure throttling, single-use auth codes, rotating refresh tokens, and `/revoke`. `REQUIRE_SHARED_STORE=true` fails closed.
- Rotating refresh tokens with reuse detection (whole family revoked), only when a shared store is configured. The credentials form says an encrypted copy is kept for up to 30 days.
- Per-connection read-only session: a checkbox on the credentials form hides every write tool for that token.
- Origin validation on `/mcp` (`MCP_ALLOWED_ORIGINS`), RFC 8707 audience on access tokens, and path-specific protected resource metadata (RFC 9728).
- Structured security event logging with allowlisted fields (`src/security-log.ts`).
- Two-step writes for `generate_variant_matrix`, `append_variants_to_group`, `create_attribute_definition`, `append_select_attribute_values`, and `create_category_node`: elicitation on stateful transports, otherwise a preview plus signed `confirmationToken`.
- `npm run test:security` (35 tests), a GitHub Actions workflow (build, tests, `npm audit`, gitleaks), and Dependabot.

### Changed

- Token and auth code format is `v2`: HKDF subkeys per purpose, key ids, purpose-bound AAD. `SIGNING_SECRET` must be at least 32 characters. `SIGNING_SECRET_PREVIOUS` allows rotation without disruption and `TOKEN_NOT_BEFORE` is a kill switch.
- Auth codes are bound to client and redirect URI, carry an id, and are single use. `/token` requires `redirect_uri` and `client_id` (escape hatch: `LENIENT_TOKEN_REDIRECT_CHECK`).
- Redirect URIs default to the exact callbacks of Claude, ChatGPT, VS Code, and Cursor plus loopback. `REDIRECT_URI_ALLOWLIST` adds exact URIs. `REDIRECT_URI_HOST_ALLOWLIST` now only adds extra https hosts and `EXTRA_REDIRECT_SCHEMES` only applies when the allowlist is open.
- CSRF is bound to a cookie, client, redirect URI, state, challenge, and expiry. The credentials form has a nonce-based CSP with `form-action` limited to self and the redirect target.
- Request body limits are per route (16 kb for auth endpoints, 100 kb for `/mcp`).
- Upstream error text in tool results is shortened, stripped of links, and labelled as untrusted.
- `ALLOW_LEGACY_CLIENT_ID_FLOW=false` disables the Claude Desktop flow that puts credentials in `client_id`. It stays on by default.

### Upgrade notes

Users reconnect once because tokens changed format. See "Upgrading from an earlier version" in `docs/setup-developer.md`. Not verified against live Claude Desktop and Cursor in this change set: the required `redirect_uri` at `/token` and the new resource metadata path.

## Security hardening: 2026-11-05

- MAPI token cache is keyed by a hash of client ID and secret instead of the client ID alone, and capped at 200 entries. Previously a wrong secret with a known client ID could reuse a cached token.
- Legacy (Claude Desktop) flow now validates credentials against Bluestone at `/token` before issuing a token.
- `/register` returns an HMAC-signed `client_id` that embeds the redirect URIs. `/authorize` rejects unknown clients and non-matching `redirect_uri`s. The credentials form shows where the session token will be sent. CSRF token is bound to client, redirect URI, state, and challenge.
- Redirect URIs are restricted to https, loopback http, and known desktop client schemes.
- Header credentials on `/mcp` are off unless `ALLOW_HEADER_AUTH=true`. A present but invalid Bearer token returns 401 with `WWW-Authenticate` instead of falling back.
- `get_product_image` only fetches https URLs on `bluestonepim.com` hosts (extend with `IMAGE_HOST_ALLOWLIST`), with no redirects, a timeout, a 5 MB cap, and an image content type check.
- All IDs placed in API paths go through `seg()`: validated and URL-encoded.
- New `MCP_READ_ONLY=true` mode registers read tools only.
- Dependencies updated (`npm audit` reports 0 vulnerabilities), including zod 4. `express-rate-limit` is now a declared dependency.
- PKCE verifier format is enforced and compared in constant time. `/token` responses send `Cache-Control: no-store`. The MAPI secret is no longer echoed back into the form on validation errors.

## Cursor OAuth support: 2026-04-10

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

RFC 7591 dynamic client registration. Cursor POSTs here before opening the authorisation URL. The endpoint returns an opaque `client_id` (random 32-char hex). No state is persisted: Bluestone credentials are unknown at registration time and are collected in the next step.

The registration request's `redirect_uris` array is validated and echoed back in the response, as required by the spec.

#### HTML credentials form at `GET /authorize`

The `/authorize` endpoint now detects which flow is in use based on the `client_id` format:

- **`{mapiClientId}:{papiKey}` format** → legacy Claude Desktop flow, immediate redirect (no change)
- **Opaque `client_id`** (from dynamic registration) → renders an HTML credentials form asking for `mapiClientId`, `mapiClientSecret`, and PAPI key

The form is a minimal, self-contained HTML page served directly from the Vercel function.

#### `POST /authorize` (new route)

Handles form submission from the credentials form. Validates inputs, verifies the CSRF token, encrypts all three Bluestone credentials into an AES-256-GCM auth code, and redirects back to the client's `redirect_uri` with the code: exactly as the legacy flow does.

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

`redirect_uri` is now validated on both `GET` and `POST /authorize`. Only `javascript:` and `data:` URIs are rejected: localhost, HTTPS, and custom app URI schemes (e.g. `cursor://`) are all accepted. PKCE remains the primary protection against code interception.

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
| Stateless registration | Any opaque `client_id` is accepted at `/authorize`: unregistered clients can reach the form. |
| CSP disabled | Should be re-enabled with a nonce-based policy before production exposure. |
| Rate limiting | `/register`, `/authorize`, and `/token` are rate-limited in-memory (20 req/min per IP). Not globally consistent across concurrent Vercel instances; replace with a Redis-backed store for strict global limits. |
