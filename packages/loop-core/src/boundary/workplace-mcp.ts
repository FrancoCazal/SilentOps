/**
 * Ejecutor real de workspace.write contra el MCP de Ambiguous.
 *
 * No conoce ni inventa nombres de tools: ejecuta exactamente el `tool` que
 * trae la propuesta aprobada. La lista viva se obtiene con
 * `npm run tools:list -w loop-core` (eso es lo que R4 reparte al arrancar).
 *
 * El transporte es el mismo que usa el kit en apps/web/scripts/check-workplace.ts.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { WorkspaceExecutor } from "./write";

const AMBIGUOUS_MCP_URL = "https://app.ambiguous.ai/mcp";

let client: Client | undefined;

export async function workplaceClient(): Promise<Client> {
  if (client) return client;
  const apiKey = process.env.AMBIGUOUS_API_KEY;
  if (!apiKey) throw new Error("AMBIGUOUS_API_KEY no configurado");

  const next = new Client({ name: "loop-core", version: "0.1.0" });
  await next.connect(
    new StreamableHTTPClientTransport(new URL(AMBIGUOUS_MCP_URL), {
      fetch: (url: string | URL | Request, init?: RequestInit) =>
        fetch(url, {
          ...init,
          headers: { ...init?.headers, Authorization: `Bearer ${apiKey}` },
        }),
    } as never),
    { timeout: 20_000 },
  );
  client = next;
  return client;
}

export async function listWorkplaceTools(): Promise<
  Array<{ name: string; description?: string; inputSchema: unknown }>
> {
  const c = await workplaceClient();
  const tools: Array<{ name: string; description?: string; inputSchema: unknown }> = [];
  let cursor: string | undefined;
  do {
    const page = await c.listTools(cursor ? { cursor } : {}, { timeout: 20_000 });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

/** Registrar con registerWorkspaceExecutor(ambiguousExecutor) en el arranque. */
export const ambiguousExecutor: WorkspaceExecutor = async (tool, args) => {
  const c = await workplaceClient();
  return c.callTool({ name: tool, arguments: args }, undefined, { timeout: 30_000 });
};
