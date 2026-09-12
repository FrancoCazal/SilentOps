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
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { WorkspaceExecutor } from "./write";

const AMBIGUOUS_MCP_URL = "https://app.ambiguous.ai/mcp";

export type WorkplaceClient = Pick<Client, "callTool" | "listTools">;
type CallToolResult = Awaited<ReturnType<Client["callTool"]>>;
type CallToolContent = Extract<CallToolResult, { content: unknown }>["content"];

const TRANSIENT_ERROR_CODES = new Set<unknown>([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  ErrorCode.RequestTimeout,
]);
const TRANSIENT_ERROR_NAMES = new Set(["AbortError", "TimeoutError"]);

let client: WorkplaceClient | undefined;

export function setWorkplaceClientForTests(next: WorkplaceClient | undefined): void {
  client = next;
}

function errorProperty(error: object, property: "cause" | "code" | "name"): unknown {
  return property in error ? Reflect.get(error, property) : undefined;
}

function isTransientError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const code = errorProperty(current, "code");
    const name = errorProperty(current, "name");
    if (TRANSIENT_ERROR_CODES.has(code) || (typeof name === "string" && TRANSIENT_ERROR_NAMES.has(name))) {
      return true;
    }
    current = errorProperty(current, "cause");
  }

  return false;
}

async function invalidateOnTransient<T>(
  currentClient: WorkplaceClient,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isTransientError(error) && client === currentClient) client = undefined;
    throw error;
  }
}

export async function workplaceClient(): Promise<WorkplaceClient> {
  const apiKey = process.env.AMBIGUOUS_API_KEY?.trim();
  if (!apiKey) throw new Error("AMBIGUOUS_API_KEY no configurado");
  if (client) return client;

  const next = new Client({ name: "loop-core", version: "0.1.0" });
  // requestInit, no un fetch custom: spreadear `init.headers` (un Headers del
  // SDK, no un objeto plano) perdia el Content-Type y Ambiguous respondia 415.
  // Es el mismo transporte que usa el kit en apps/web/src/lib/server/workplace.ts.
  await next.connect(
    new StreamableHTTPClientTransport(new URL(AMBIGUOUS_MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
    }),
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
    const page = await invalidateOnTransient(c, () =>
      c.listTools(cursor ? { cursor } : {}, { timeout: 20_000 }),
    );
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

function toolErrorText(tool: string, content: CallToolContent): string {
  const text = content
    .filter((item): item is Extract<(typeof content)[number], { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  return text || `La tool MCP ${tool} devolvio un error`;
}

/**
 * Lectura CRUDA por MCP: llama la tool exacta y desenvuelve el resultado.
 * No confundir con `readTool` de domain/workspace-reader (el puerto que
 * consumen el detector y las tools); ese recibe intenciones `silentops.*` y
 * lo implementa boundary/ambiguous-reader.ts. Este es el escalon de abajo.
 */
export async function callReadTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const c = await workplaceClient();
  const result = await invalidateOnTransient(c, () =>
    c.callTool({ name: tool, arguments: args }, undefined, { timeout: 30_000 }),
  );
  const resultRecord: Record<string, unknown> = result;
  const content = Array.isArray(resultRecord.content)
    ? (resultRecord.content as CallToolContent)
    : undefined;

  if (resultRecord.isError === true) {
    throw new Error(toolErrorText(tool, content ?? []));
  }
  if (resultRecord.structuredContent !== undefined) return resultRecord.structuredContent;
  if (!content) throw new Error(`La tool MCP ${tool} devolvio una respuesta sin content`);

  const [only] = content;
  if (content.length === 1 && only?.type === "text") {
    try {
      return JSON.parse(only.text) as unknown;
    } catch {
      // Plain text is valid MCP content and is returned unchanged below.
    }
  }

  return content;
}

/** Registrar con registerWorkspaceExecutor(ambiguousExecutor) en el arranque. */
export const ambiguousExecutor: WorkspaceExecutor = async (tool, args) => {
  const c = await workplaceClient();
  return invalidateOnTransient(c, () =>
    c.callTool({ name: tool, arguments: args }, undefined, { timeout: 30_000 }),
  );
};
