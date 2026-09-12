/**
 * SilentOps. Tools de LECTURA del dominio.
 *
 * Regla del core, repetida en los docs: los nombres y schemas de las tools de
 * Ambiguous salen del workspace vivo por MCP. `TOOLS` no son nombres MCP:
 * son el contrato semantico estable del dominio. El adaptador
 * boundary/ambiguous-reader.ts los traduce, en un solo lugar, a las tools MCP
 * reales que se descubrieron en el workspace. Asi el modelo nunca conoce ni
 * puede invocar una tool de escritura del proveedor.
 *
 * Formato: tools AG-UI (las que van en runAgent({ tools })). El caller resuelve
 * el resultado. Ninguna de estas escribe: el agente no tiene un camino a una
 * escritura, y la unica tool de accion que ve es propose_action.
 */
import { resolveAt } from "./clock";
import { readTool } from "./workspace-reader";

/**
 * Intenciones de lectura del dominio. Los nombres MCP reales viven en el
 * adaptador de frontera, no en el prompt ni en el agente.
 */
export const TOOLS = {
  currentShift: "silentops.current-shift",
  searchDocuments: "silentops.search-documents",
  channelHistory: "silentops.channel-history",
  openWorkOrders: "silentops.open-work-orders",
} as const;

export type AgentTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export type DomainTool = { definition: AgentTool; handler: ToolHandler };

/**
 * Tope de items que vuelven al modelo. Un turno real tiene 80 mensajes de canal
 * y meterlos crudos en el prompt se come el contexto y la latencia de la demo.
 * El detector ya trae el historial en el contexto; estas tools son para que el
 * agente pida MAS detalle cuando le falta, no para volcar el canal entero.
 */
const MAX_ITEMS = 40;

function cap(v: unknown, limit = MAX_ITEMS): unknown {
  if (!Array.isArray(v)) return v;
  return v.length > limit
    ? { items: v.slice(0, limit), truncated: true, total: v.length }
    : { items: v, truncated: false, total: v.length };
}

export const readOnlyTools: DomainTool[] = [
  {
    definition: {
      name: "shift_roster",
      description:
        "El turno vigente y quien esta de guardia: nombre, inicio, fin, quien sale y quien entra. " +
        "Usala para saber a quien se le puede reasignar trabajo. Nunca reasignes a alguien que no aparece aca.",
      parameters: {
        type: "object",
        properties: {
          at: {
            type: "string",
            description: "Momento a consultar, ISO 8601. Por defecto, ahora.",
          },
        },
        additionalProperties: false,
      },
    },
    handler: async (args) => readTool(TOOLS.currentShift, { at: resolveAt(args.at) }),
  },
  {
    definition: {
      name: "search_documents",
      description:
        "Busca documentos del workspace por texto. Usala para traer el handover del turno anterior " +
        "(plantilla y continuidad) y el documento de reglas de asignacion por categoria de activo.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Texto a buscar." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    handler: async (args) => cap(await readTool(TOOLS.searchDocuments, { query: args.query })),
  },
  {
    definition: {
      name: "channel_history",
      description:
        "Mensajes del canal de operaciones desde un momento dado. Cada item es una FUENTE citable: " +
        "si un dato del handover no sale de aca ni de una orden de trabajo, no entra al handover.",
      parameters: {
        type: "object",
        properties: {
          since: {
            type: "string",
            description: "Desde cuando. Normalmente el inicio del turno.",
          },
          channel: { type: "string", description: "Canal. Por defecto, el de operaciones." },
        },
        required: ["since"],
        additionalProperties: false,
      },
    },
    handler: async (args) =>
      cap(await readTool(TOOLS.channelHistory, { since: args.since, channel: args.channel })),
  },
  {
    definition: {
      name: "open_work_orders",
      description:
        "Ordenes de trabajo abiertas, con responsable y activo. Usala para saber que queda sin cerrar " +
        "y a quien pertenece. Nunca propongas cerrar una orden: no es una accion tuya.",
      parameters: {
        type: "object",
        properties: {
          assignee: {
            type: "string",
            description: "Filtrar por responsable. Opcional.",
          },
        },
        additionalProperties: false,
      },
    },
    handler: async (args) =>
      cap(await readTool(TOOLS.openWorkOrders, { status: "open", assignee: args.assignee })),
  },
];

export function toolDefinitions(): AgentTool[] {
  return readOnlyTools.map((t) => t.definition);
}

export function handlerFor(name: string): ToolHandler | undefined {
  return readOnlyTools.find((t) => t.definition.name === name)?.handler;
}
