// Guarded image download for get_product_image.
//
// The imageUrl parameter is model-supplied and can originate from prompt-injected
// PIM data. Fetching it unchecked is server-side request forgery. This module
// restricts the fetch to https URLs on an allowlist of hosts, refuses redirects,
// enforces a timeout and a size cap, and requires an image content type.

const DEFAULT_ALLOWED_HOST_SUFFIXES = ["bluestonepim.com"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

function allowedHostSuffixes(): string[] {
  const extra = (process.env.IMAGE_HOST_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...DEFAULT_ALLOWED_HOST_SUFFIXES, ...extra];
}

function hostIsAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return allowedHostSuffixes().some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function assertAllowedImageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The image URL is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Only https image URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new Error("Image URLs with embedded credentials are not allowed.");
  }
  if (url.port && url.port !== "443") {
    throw new Error("Image URLs on non-standard ports are not allowed.");
  }
  if (!hostIsAllowed(url.hostname)) {
    throw new Error(
      `Image host "${url.hostname}" is not on the allowlist. ` +
        "Only Bluestone media hosts are fetched. A server admin can add hosts with the IMAGE_HOST_ALLOWLIST environment variable (comma-separated domain suffixes)."
    );
  }
  return url;
}

export async function fetchProductImage(
  raw: string
): Promise<{ base64: string; mimeType: string }> {
  const url = assertAllowedImageUrl(raw);

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch image: ${message}`);
  }

  if (res.status >= 300 && res.status < 400) {
    throw new Error("Image fetch was redirected. Redirects are not followed for security reasons.");
  }
  if (!res.ok) {
    throw new Error(`Image fetch failed (${res.status}). The URL may have expired or be unavailable.`);
  }

  const mimeType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!mimeType.startsWith("image/") || mimeType === "image/svg+xml") {
    throw new Error("The URL did not return a supported image type.");
  }

  const declaredLength = Number(res.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_IMAGE_BYTES) {
    throw new Error("The image is larger than the 5 MB limit.");
  }

  if (!res.body) {
    throw new Error("The image response had no body.");
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("The image is larger than the 5 MB limit.");
    }
    chunks.push(value);
  }

  return { base64: Buffer.concat(chunks).toString("base64"), mimeType };
}
