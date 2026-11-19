// Confirmation gate for bulk and schema-changing write tools.
//
// A prompt that says "always confirm with the user" is an instruction, not a
// control. This gate adds two server-side mechanisms:
//
// 1. Elicitation (preferred). When the client supports MCP elicitation and the
//    transport keeps one long-lived server per client (stdio), the client asks the
//    human directly, so the answer cannot come from the model.
//
// 2. Preview and confirmation token (fallback, and the only option on stateless
//    HTTP, where a server-to-client request cannot be answered by a later POST).
//    The first call returns a preview and a signed, short-lived token bound to the
//    tool, its exact arguments, and the caller's credentials. The write only runs
//    when the second call presents that token. This stops accidental or one-shot
//    writes and forces a visible preview step. It cannot prove the human read the
//    preview: a determined injected prompt could still make two calls in a row.
//
// Set ENABLE_ELICITATION=true to attempt elicitation on a stateless transport as
// well, for clients known to keep the response stream open.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logSecurityEvent } from "./security-log.js";

const TOKEN_TTL_MS = 10 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;

// Used when SIGNING_SECRET is absent (stdio). Tokens then only live as long as the process.
const ephemeralSecret = randomBytes(32).toString("hex");

function tokenSecret(): string {
  const configured = process.env.SIGNING_SECRET ?? "";
  return configured.length >= MIN_SECRET_LENGTH ? configured : ephemeralSecret;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function mac(tool: string, args: unknown, credentialId: string, exp: number): Buffer {
  const argsHash = createHash("sha256").update(canonicalJson(args)).digest("hex");
  const credHash = createHash("sha256").update(credentialId).digest("hex");
  return createHmac("sha256", tokenSecret())
    .update(`confirm:${JSON.stringify([tool, argsHash, credHash, exp])}`)
    .digest();
}

export function issueConfirmationToken(tool: string, args: unknown, credentialId: string): string {
  const exp = Date.now() + TOKEN_TTL_MS;
  return `${exp}.${mac(tool, args, credentialId, exp).toString("base64url")}`;
}

export function verifyConfirmationToken(
  token: string,
  tool: string,
  args: unknown,
  credentialId: string
): boolean {
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const provided = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = mac(tool, args, credentialId, exp);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export type GateResult =
  | { proceed: true }
  | { proceed: false; result: { content: Array<{ type: "text"; text: string }> } };

export interface WriteGate {
  (params: {
    tool: string;
    /** Every argument that defines the write, excluding the confirmation token. */
    args: Record<string, unknown>;
    confirmationToken?: string;
    /** Plain-language description of what will change. */
    preview: string;
  }): Promise<GateResult>;
}

function text(message: string): GateResult {
  return { proceed: false, result: { content: [{ type: "text", text: message }] } };
}

export function createWriteGate(opts: {
  server: McpServer;
  credentialId: string;
  statefulTransport: boolean;
}): WriteGate {
  const elicitationWanted =
    opts.statefulTransport || ["1", "true", "yes"].includes((process.env.ENABLE_ELICITATION ?? "").toLowerCase());

  return async ({ tool, args, confirmationToken, preview }) => {
    if (elicitationWanted && opts.server.server.getClientCapabilities()?.elicitation) {
      try {
        const answer = await opts.server.server.elicitInput({
          message: `${preview}\n\nApply this change in Bluestone PIM?`,
          requestedSchema: {
            type: "object",
            properties: {
              confirm: {
                type: "boolean",
                title: "Apply this change",
                description: "Select to apply the change exactly as described above.",
                default: false,
              },
            },
            required: ["confirm"],
          },
        });
        if (answer.action === "accept" && answer.content?.confirm === true) {
          return { proceed: true };
        }
        return text("The user did not approve this change. Nothing was changed in Bluestone PIM.");
      } catch {
        // The client could not complete the request. Use the token flow below.
      }
    }

    if (!confirmationToken) {
      logSecurityEvent("write_confirmation_required", { operation: tool });
      const token = issueConfirmationToken(tool, args, opts.credentialId);
      return text(
        `PREVIEW ONLY. Nothing has been changed in Bluestone PIM yet.\n\n${preview}\n\n` +
          `Any names the assistant supplied for this preview are not checked against the IDs. The IDs are what will be changed. ` +
          `Show this plan to the user. If the user explicitly approves it, call ${tool} again with exactly the same arguments plus confirmationToken "${token}". ` +
          `The token is valid for 10 minutes and only works for these exact arguments. If the user wants any change, call ${tool} again without a token to get a new preview.`
      );
    }

    if (!verifyConfirmationToken(confirmationToken, tool, args, opts.credentialId)) {
      logSecurityEvent("write_confirmation_failed", { operation: tool });
      return text(
        `The confirmationToken is invalid, expired, or does not match these arguments. Nothing was changed. ` +
          `Call ${tool} again without a token to get a fresh preview, and show it to the user.`
      );
    }
    return { proceed: true };
  };
}
