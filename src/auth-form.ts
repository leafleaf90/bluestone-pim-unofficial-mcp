import { getBluestoneEnvironmentLabel } from "./validate-credentials.js";
import { describeRedirectDestination } from "./redirect-policy.js";

export function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&#39;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatValidationErrors(errors: { mapi?: string; papi?: string }): string {
  const parts: string[] = [];
  if (errors.mapi) parts.push(errors.mapi);
  if (errors.papi) parts.push(errors.papi);
  return parts.join(" ");
}

export function renderCredentialsForm(params: {
  /** Per-response CSP nonce applied to the inline style and script. */
  nonce: string;
  /** True when the server keeps an encrypted refresh token record (shared store enabled). */
  storesRefreshToken: boolean;
  readOnlyChecked?: boolean;
  redirectUri: string;
  clientId: string;
  clientName?: string;
  state: string;
  codeChallenge: string;
  csrfToken: string;
  mapiClientId?: string;
  papiKey?: string;
  formError?: string;
  fieldErrors?: { mapi?: string; papi?: string };
}): string {
  const {
    nonce,
    storesRefreshToken,
    readOnlyChecked = false,
    redirectUri,
    clientId,
    clientName,
    state,
    codeChallenge,
    csrfToken,
    mapiClientId = "",
    papiKey = "",
    formError,
    fieldErrors,
  } = params;
  const envLabel = getBluestoneEnvironmentLabel();
  const envBadgeClass = envLabel === "production" ? "env-badge production" : "env-badge test";
  const initialStatus = formError
    ? escHtml(formError + (fieldErrors ? " " + formatValidationErrors(fieldErrors) : ""))
    : "";
  const initialStatusClass = formError ? "status error" : "status hidden";
  const mapiFieldErrorClass = fieldErrors?.mapi ? "field-error" : "";
  const papiFieldErrorClass = fieldErrors?.papi ? "field-error" : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorise · Bluestone PIM Unofficial MCP</title>
  <link rel="icon" type="image/png" href="/bluestone_pim_logo.png">
  <style nonce="${escHtml(nonce)}">
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f3f4f6; margin: 0; padding: 40px 16px; color: #111827; }
    .card { background: white; border: 1px solid #e5e7eb; border-radius: 12px; max-width: 440px; margin: 0 auto; padding: 32px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    .card-header { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
    .logo { height: 40px; width: auto; display: block; flex-shrink: 0; }
    .card-header-text { min-width: 0; }
    .eyebrow { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #6b7280; margin: 0 0 4px; }
    h1 { font-size: 1.125rem; font-weight: 600; line-height: 1.35; margin: 0; }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 16px; }
    .env-badge { font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; }
    .env-badge.test { background: #fef3c7; color: #92400e; }
    .env-badge.production { background: #dcfce7; color: #166534; }
    .unofficial-note { font-size: 0.8125rem; color: #6b7280; }
    .intro { font-size: 0.875rem; color: #4b5563; margin: 0 0 16px; line-height: 1.5; }
    .steps { font-size: 0.8125rem; color: #374151; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; margin: 0 0 20px; line-height: 1.5; }
    .steps strong { color: #111827; }
    .destination { font-size: 0.8125rem; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 14px; margin: 0 0 20px; line-height: 1.5; word-break: break-word; }
    .destination strong { color: #78350f; }
    label { display: block; font-size: 0.8125rem; font-weight: 500; color: #374151; margin-bottom: 4px; }
    .field-hint { font-size: 0.75rem; color: #9ca3af; font-weight: 400; margin-left: 4px; }
    .field-group { margin-bottom: 14px; }
    input[type=text], input[type=password] { display: block; width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.875rem; margin-bottom: 0; outline: none; }
    input.field-error { border-color: #dc2626; }
    input[type=text]:focus, input[type=password]:focus { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.15); }
    input.field-error:focus { border-color: #dc2626; box-shadow: 0 0 0 2px rgba(220,38,38,0.15); }
    .secret-row { display: flex; gap: 8px; align-items: stretch; }
    .secret-row input { flex: 1; min-width: 0; }
    button.toggle-secret { width: auto; flex-shrink: 0; padding: 8px 12px; white-space: nowrap; }
    .status { font-size: 0.875rem; margin-bottom: 16px; padding: 10px 12px; border-radius: 6px; line-height: 1.45; }
    .status.hidden { display: none; }
    .status.error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .status.success { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
    .status.pending { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
    .button-row { display: flex; flex-direction: column; gap: 8px; }
    button { display: block; width: 100%; padding: 10px; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer; }
    button.primary { background: #2563eb; color: white; border: none; }
    button.primary:hover:not(:disabled) { background: #1d4ed8; }
    button.secondary { background: #fff; color: #374151; border: 1px solid #d1d5db; }
    button.secondary:hover:not(:disabled) { background: #f9fafb; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .check-label { display: flex; align-items: center; gap: 8px; font-weight: 400; }
    .check-label input { margin: 0; }
    .footnote { font-size: 0.75rem; color: #9ca3af; margin: 20px 0 0; line-height: 1.5; }
    .footnote a { color: #2563eb; text-decoration: none; }
    .footnote a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <header class="card-header">
      <img src="/bluestone_pim_logo.png" alt="Bluestone PIM" class="logo" width="120" height="40">
      <div class="card-header-text">
        <p class="eyebrow">Bluestone PIM Labs</p>
        <h1>Unofficial MCP</h1>
      </div>
    </header>
    <div class="meta">
      <span class="${envBadgeClass}">${escHtml(envLabel)} environment</span>
      <span class="unofficial-note">Community project, not an official Bluestone product</span>
    </div>
    <p class="intro">${
      storesRefreshToken
        ? "Enter the Bluestone API credentials for your organisation. They are checked over HTTPS and encrypted into your session token. To keep you connected without asking again, an encrypted copy is stored on this server for up to 30 days. You can revoke it from your MCP client at any time."
        : "Enter the Bluestone API credentials for your organisation. They are checked over HTTPS, encrypted into your session token, and are not stored on this server."
    }</p>
    <p class="destination"><strong>Check the destination.</strong> ${clientName ? `<strong>${escHtml(clientName)}</strong> (name supplied by the app, not verified) ` : "An app "}is asking to connect. After you authorise, a session token that can read and change your Bluestone data is sent to <strong>${escHtml(describeRedirectDestination(redirectUri))}</strong>. Only continue if you started this connection yourself from an app you trust.</p>
    <p class="steps"><strong>1.</strong> Fill in all three fields &nbsp;·&nbsp; <strong>2.</strong> Test connection &nbsp;·&nbsp; <strong>3.</strong> Authorise</p>
    <form id="cred-form" method="POST" action="/authorize" autocomplete="off">
      <input type="hidden" name="client_id" value="${escHtml(clientId)}">
      <input type="hidden" name="redirect_uri" value="${escHtml(redirectUri)}">
      <input type="hidden" name="state" value="${escHtml(state)}">
      <input type="hidden" name="code_challenge" value="${escHtml(codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="S256">
      <input type="hidden" name="csrf_token" value="${escHtml(csrfToken)}">

      <div class="field-group">
        <label for="mapi_client_id">MAPI Client ID<span class="field-hint">working-state API</span></label>
        <input type="text" id="mapi_client_id" name="mapi_client_id" required
               class="${escHtml(mapiFieldErrorClass)}"
               value="${escHtml(mapiClientId)}"
               placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off" spellcheck="false">
      </div>

      <div class="field-group">
        <label for="mapi_client_secret">MAPI Client Secret</label>
        <div class="secret-row">
          <input type="password" id="mapi_client_secret" name="mapi_client_secret" required
                 class="${escHtml(mapiFieldErrorClass)}"
                 placeholder="your-mapi-client-secret" autocomplete="new-password">
          <button type="button" id="toggle-secret-btn" class="secondary toggle-secret"
                  aria-label="Show MAPI Client Secret" aria-pressed="false">Show</button>
        </div>
      </div>

      <div class="field-group">
        <label for="papi_key">PAPI Key<span class="field-hint">published catalog API</span></label>
        <input type="text" id="papi_key" name="papi_key" required
               class="${escHtml(papiFieldErrorClass)}"
               value="${escHtml(papiKey)}"
               placeholder="your-papi-key" autocomplete="off" spellcheck="false">
      </div>

      <div class="field-group">
        <label class="check-label"><input type="checkbox" name="read_only" value="1"${readOnlyChecked ? " checked" : ""}> Read-only session<span class="field-hint">this connection can read data but not change it</span></label>
      </div>

      <div id="status" class="${initialStatusClass}" role="status" aria-live="polite">${initialStatus}</div>

      <div class="button-row">
        <button type="button" id="test-btn" class="secondary">Test connection</button>
        <button type="submit" id="submit-btn" class="primary" disabled title="Test the connection first">Authorise</button>
      </div>
    </form>
    <p class="footnote">Need help finding credentials? See the <a href="/connect">setup guide</a>. Wrong environment? This server targets Bluestone <strong>${escHtml(envLabel)}</strong>; production credentials will fail on a test deployment.</p>
  </div>
  <script nonce="${escHtml(nonce)}">
    (function () {
      var form = document.getElementById("cred-form");
      var testBtn = document.getElementById("test-btn");
      var submitBtn = document.getElementById("submit-btn");
      var statusEl = document.getElementById("status");
      var secretInput = document.getElementById("mapi_client_secret");
      var toggleSecretBtn = document.getElementById("toggle-secret-btn");
      var fieldIds = ["mapi_client_id", "mapi_client_secret", "papi_key"];
      var verified = false;

      function clearFieldErrors() {
        fieldIds.forEach(function (id) {
          document.getElementById(id).classList.remove("field-error");
        });
      }

      function setFieldErrors(data) {
        clearFieldErrors();
        if (data.mapi) {
          document.getElementById("mapi_client_id").classList.add("field-error");
          document.getElementById("mapi_client_secret").classList.add("field-error");
        }
        if (data.papi) {
          document.getElementById("papi_key").classList.add("field-error");
        }
      }

      function setStatus(message, kind) {
        statusEl.textContent = message;
        statusEl.className = "status " + kind;
      }

      function clearStatus() {
        statusEl.textContent = "";
        statusEl.className = "status hidden";
      }

      function setVerified(value) {
        verified = value;
        submitBtn.disabled = !value;
      }

      function invalidate() {
        setVerified(false);
        clearStatus();
        clearFieldErrors();
      }

      toggleSecretBtn.addEventListener("click", function () {
        var showing = secretInput.type === "text";
        secretInput.type = showing ? "password" : "text";
        toggleSecretBtn.textContent = showing ? "Show" : "Hide";
        toggleSecretBtn.setAttribute("aria-pressed", showing ? "false" : "true");
        toggleSecretBtn.setAttribute("aria-label", (showing ? "Show" : "Hide") + " MAPI Client Secret");
      });

      function readPayload() {
        return {
          csrf_token: form.querySelector('[name="csrf_token"]').value,
          client_id: form.querySelector('[name="client_id"]').value,
          redirect_uri: form.querySelector('[name="redirect_uri"]').value,
          state: form.querySelector('[name="state"]').value,
          code_challenge: form.querySelector('[name="code_challenge"]').value,
          mapi_client_id: document.getElementById("mapi_client_id").value.trim(),
          mapi_client_secret: document.getElementById("mapi_client_secret").value,
          papi_key: document.getElementById("papi_key").value.trim(),
        };
      }

      function formatErrors(data) {
        var parts = [];
        if (data.mapi) parts.push(data.mapi);
        if (data.papi) parts.push(data.papi);
        if (data.error) parts.push(data.error);
        return parts.join(" ");
      }

      ["mapi_client_id", "mapi_client_secret", "papi_key"].forEach(function (id) {
        document.getElementById(id).addEventListener("input", invalidate);
      });

      testBtn.addEventListener("click", function () {
        var payload = readPayload();
        if (!payload.mapi_client_id || !payload.mapi_client_secret || !payload.papi_key) {
          setStatus("Fill in all three credentials before testing.", "error");
          setVerified(false);
          clearFieldErrors();
          if (!payload.mapi_client_id) document.getElementById("mapi_client_id").classList.add("field-error");
          if (!payload.mapi_client_secret) document.getElementById("mapi_client_secret").classList.add("field-error");
          if (!payload.papi_key) document.getElementById("papi_key").classList.add("field-error");
          return;
        }

        testBtn.disabled = true;
        submitBtn.disabled = true;
        clearFieldErrors();
        setStatus("Testing connection...", "pending");

        fetch("/validate-credentials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
          .then(function (res) {
            return res.json().then(function (data) {
              return { ok: res.ok, data: data };
            });
          })
          .then(function (result) {
            if (result.ok && result.data.ok) {
              clearFieldErrors();
              setStatus("Connection verified. You can authorise now.", "success");
              setVerified(true);
              return;
            }
            setFieldErrors(result.data);
            setStatus(formatErrors(result.data) || "Credentials could not be verified.", "error");
            setVerified(false);
          })
          .catch(function () {
            clearFieldErrors();
            setStatus("Could not reach the server. Try again.", "error");
            setVerified(false);
          })
          .finally(function () {
            testBtn.disabled = false;
            if (!verified) submitBtn.disabled = true;
          });
      });

      form.addEventListener("submit", function (event) {
        if (!verified) {
          event.preventDefault();
          setStatus("Test the connection before authorising.", "error");
        }
      });
    })();
  </script>
</body>
</html>`;
}

