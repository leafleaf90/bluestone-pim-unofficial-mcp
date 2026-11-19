// Model-supplied identifiers are interpolated into Bluestone API paths. Without
// validation a prompt-injected value such as "x/../../other" or "x?y=1" can
// redirect a tool to a different endpoint using the user's token.
//
// Bluestone IDs and context codes are alphanumeric with dashes or underscores.
// Anything else is rejected before a request is built.

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Validate and encode one URL path segment. Throws when the value contains
 * anything other than letters, digits, underscore, or dash.
 */
export function seg(value: string): string {
  if (typeof value !== "string" || !SAFE_SEGMENT.test(value)) {
    throw new Error(
      "Invalid identifier. IDs may only contain letters, digits, dashes, and underscores (max 128 characters). " +
        "Pass the ID exactly as returned by a list tool."
    );
  }
  return encodeURIComponent(value);
}
