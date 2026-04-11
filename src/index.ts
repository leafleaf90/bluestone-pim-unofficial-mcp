import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { createMcpServer } from "./tools.js";

// Load .env relative to this file's location
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env") });

const { PAPI_KEY, MAPI_CLIENT_ID, MAPI_CLIENT_SECRET } = process.env;

if (!PAPI_KEY || !MAPI_CLIENT_ID || !MAPI_CLIENT_SECRET) {
  console.error(
    "Missing credentials in .env — required: PAPI_KEY, MAPI_CLIENT_ID, MAPI_CLIENT_SECRET"
  );
  process.exit(1);
}

async function main() {
  const server = createMcpServer({
    papiKey: PAPI_KEY as string,
    mapiClientId: MAPI_CLIENT_ID as string,
    mapiClientSecret: MAPI_CLIENT_SECRET as string,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
