/**
 * TEMA POR DEFINIR. Tools de LECTURA del dominio.
 *
 * Regla del core, repetida dos veces en los docs: los nombres y schemas de las
 * tools de Ambiguous salen del workspace vivo por MCP. No se inventan. R4 corre
 * `npm run tools:list` y pega la lista; recien ahi se escriben las de abajo.
 *
 * Formato: tools AG-UI (las que van en runAgent({ tools })). El caller resuelve
 * el resultado; el agente nunca escribe.
 */

export type AgentTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export type DomainTool = { definition: AgentTool; handler: ToolHandler };

/** TODO(tema): agregar las tools de lectura del tema (wiki.search, tasks.list, ...). */
export const readOnlyTools: DomainTool[] = [];

export function toolDefinitions(): AgentTool[] {
  return readOnlyTools.map((t) => t.definition);
}

export function handlerFor(name: string): ToolHandler | undefined {
  return readOnlyTools.find((t) => t.definition.name === name)?.handler;
}
