import type { Credentials } from "./tools.js";

export type CredentialValidationResult =
  | { ok: true }
  | { ok: false; mapi?: string; papi?: string; general?: string };

const IS_PRODUCTION = process.env.ENVIRONMENT === "production";
const API_BASE = IS_PRODUCTION
  ? "https://api.bluestonepim.com"
  : "https://api.test.bluestonepim.com";
const PAPI_BASE = `${API_BASE}/v1`;
const MAPI_TOKEN_URL = IS_PRODUCTION
  ? "https://idp.bluestonepim.com/op/token"
  : "https://idp.test.bluestonepim.com/op/token";

export function getBluestoneEnvironmentLabel(): "test" | "production" {
  return IS_PRODUCTION ? "production" : "test";
}

function mapiValidationMessage(status: number): string {
  switch (status) {
    case 401:
      return "MAPI Client ID or Secret is incorrect.";
    case 403:
      return "MAPI credentials are valid but lack permission for this environment.";
    case 429:
      return "Bluestone rate limit reached. Wait a moment and try again.";
    default:
      return `MAPI check failed (${status}). Verify your credentials and environment.`;
  }
}

function papiValidationMessage(status: number): string {
  switch (status) {
    case 401:
      return "PAPI Key is incorrect.";
    case 403:
      return "PAPI key is valid but lacks permission for this environment.";
    case 404:
      return "PAPI check failed (404). Verify your key and environment.";
    case 429:
      return "Bluestone rate limit reached. Wait a moment and try again.";
    default:
      return `PAPI check failed (${status}). Verify your key and environment.`;
  }
}

// PAPI returns 404 (not 401) when the key is accepted but nothing is published yet.
function isPapiKeyAcceptedWithoutPublish(status: number, body: string): boolean {
  if (status !== 404) return false;
  try {
    const parsed = JSON.parse(body) as { message?: string };
    return parsed.message?.includes("No publishes available") ?? false;
  } catch {
    return body.includes("No publishes available");
  }
}

async function probeMapi(creds: Credentials): Promise<string | null> {
  try {
    const res = await fetch(MAPI_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: creds.mapiClientId,
        client_secret: creds.mapiClientSecret,
      }),
    });
    if (res.ok) return null;
    return mapiValidationMessage(res.status);
  } catch {
    return "Could not reach Bluestone MAPI. Check your connection and try again.";
  }
}

async function probePapi(creds: Credentials): Promise<string | null> {
  try {
    const res = await fetch(`${PAPI_BASE}/categories?itemsOnPage=1&pageNo=0`, {
      headers: {
        accept: "application/json",
        "x-api-key": creds.papiKey,
      },
    });
    if (res.ok) return null;
    const body = await res.text();
    if (isPapiKeyAcceptedWithoutPublish(res.status, body)) return null;
    return papiValidationMessage(res.status);
  } catch {
    return "Could not reach Bluestone PAPI. Check your connection and try again.";
  }
}

export async function validateCredentials(creds: Credentials): Promise<CredentialValidationResult> {
  const [mapiError, papiError] = await Promise.all([probeMapi(creds), probePapi(creds)]);

  if (!mapiError && !papiError) {
    return { ok: true };
  }

  const result: Extract<CredentialValidationResult, { ok: false }> = { ok: false };
  if (mapiError) result.mapi = mapiError;
  if (papiError) result.papi = papiError;
  return result;
}
