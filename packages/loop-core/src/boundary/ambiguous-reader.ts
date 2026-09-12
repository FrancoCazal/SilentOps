/**
 * Adaptador de SOLO LECTURA para el workspace de Ambiguous.
 *
 * El dominio pregunta por hechos de SilentOps, no por endpoints del proveedor.
 * Este archivo es el unico que conoce las cuatro tools MCP reales y normaliza
 * sus respuestas (`data`, paginacion y fechas) antes de entregarlas al agente.
 * Ningun camino de este modulo llama a una tool de escritura.
 */
import { TOOLS } from "../domain/tools";
import type { WorkspaceReader } from "../domain/workspace-reader";
import { ambiguousExecutor } from "./workplace-mcp";

export const AMBIGUOUS_READ_TOOLS = {
  calendars: "list_calendars",
  events: "list_events",
  documentSearch: "search_workspace",
  listDocuments: "list_documents",
  channels: "list_channels",
  messages: "get_channel_messages",
  tasks: "list_tasks",
} as const;

export type WorkplaceReadCall = (
  tool: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export type AmbiguousReaderOptions = {
  /** Nombre del calendario de demo/operacion a consultar. */
  calendarName?: string;
  /** Nombre del canal operativo, con o sin el prefijo #. */
  channelName?: string;
  /** IANA timezone del calendario. Solo afecta como se muestran HH:MM. */
  timeZone?: string;
  /** Inyectable para tests; por defecto usa el MCP real. */
  call?: WorkplaceReadCall;
};

const DEFAULTS = {
  calendarName: "SilentOps Demo",
  channelName: "operaciones-hub-frio",
  timeZone: "America/Asuncion",
};

/**
 * Crea el lector que se registra al arrancar el proceso con
 * `registerWorkspaceReader(createAmbiguousWorkspaceReader())`.
 */
export function createAmbiguousWorkspaceReader(
  options: AmbiguousReaderOptions = {},
): WorkspaceReader {
  const call = options.call ?? ambiguousExecutor;
  const calendarName = options.calendarName ?? DEFAULTS.calendarName;
  const channelName = normalizeChannel(options.channelName ?? DEFAULTS.channelName);
  const timeZone = options.timeZone ?? DEFAULTS.timeZone;
  let calendarId: Promise<string> | undefined;
  let channelId: Promise<string> | undefined;

  const calendar = () =>
    (calendarId ??= findId(call, AMBIGUOUS_READ_TOOLS.calendars, calendarName, "calendar"));
  const channel = () =>
    (channelId ??= findId(call, AMBIGUOUS_READ_TOOLS.channels, channelName, "channel"));

  return async (intent, args = {}) => {
    switch (intent) {
      case TOOLS.currentShift:
        return currentShift(call, await calendar(), timeZone, args);
      case TOOLS.searchDocuments:
        return documentSearch(call, args);
      case TOOLS.channelHistory:
        return channelHistory(call, await channel(), args);
      case TOOLS.openWorkOrders:
        return openWorkOrders(call);
      default:
        throw new Error(`lectura de SilentOps desconocida: '${intent}'`);
    }
  };
}

async function currentShift(
  call: WorkplaceReadCall,
  calendarId: string,
  timeZone: string,
  args: Record<string, unknown>,
): Promise<{ shift: Record<string, unknown> }> {
  const at = validDate(args.at) ?? new Date();
  const events = rows(
    await call(AMBIGUOUS_READ_TOOLS.events, {
      calendar_id: calendarId,
      // 12h a cada lado cubre tanto una guardia nocturna como una diurna.
      start: new Date(at.getTime() - 12 * 60 * 60_000).toISOString(),
      end: new Date(at.getTime() + 12 * 60 * 60_000).toISOString(),
      limit: 50,
    }),
  );

  const roster = events
    .filter((event) => field(event, "calendar_id") === calendarId)
    .map((event) => rosterFromEvent(event, timeZone))
    .find((shift) => {
      const start = validDate(shift.startAt);
      const end = validDate(shift.endAt);
      return !!start && !!end && start <= at && at <= end;
    });

  if (!roster) {
    throw new Error(
      `no hay una guardia con roster activo en el calendario '${calendarId}' para ${at.toISOString()}`,
    );
  }
  return { shift: roster };
}

async function documentSearch(
  call: WorkplaceReadCall,
  args: Record<string, unknown>,
): Promise<{ items: Record<string, unknown>[] }> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) throw new Error("search-documents requiere query");
  const hits = rows(await call(AMBIGUOUS_READ_TOOLS.documentSearch, {
    query,
    modules: ["docs"],
    limit: 20,
  }));
  // F-16: search_workspace incluye papelera sin trashed_at. Solo cuenta lo
  // confirmado vivo en este listado, consultado una vez por busqueda.
  const documents = payloadOf(await call(AMBIGUOUS_READ_TOOLS.listDocuments, {}));
  if (!Array.isArray(documents) && !(isRecord(documents) &&
    (Array.isArray(documents.data) || Array.isArray(documents.items)))) {
    throw new Error("list_documents devolvio una respuesta invalida");
  }
  const liveIds = new Set(rows(documents)
    .filter((document) => document.trashed_at === null)
    .map((document) => field(document, "id"))
    .filter((id): id is string => !!id));
  return { items: hits.filter((hit) => {
    const id = field(hit, "id");
    return !!id && liveIds.has(id);
  }) };
}

async function channelHistory(
  call: WorkplaceReadCall,
  channelId: string,
  args: Record<string, unknown>,
): Promise<{ items: Record<string, unknown>[] }> {
  const since = validDate(args.since);
  const messages = rows(
    await call(AMBIGUOUS_READ_TOOLS.messages, { channel_id: channelId, limit: "100" }),
  );
  return {
    items: since
      ? messages.filter((message) => {
          const at = validDate(field(message, "created_at"));
          return !at || at >= since;
        })
      : messages,
  };
}

async function openWorkOrders(
  call: WorkplaceReadCall,
): Promise<{ items: Record<string, unknown>[] }> {
  const tasks = rows(await call(AMBIGUOUS_READ_TOOLS.tasks, { limit: 100 }));
  return {
    items: tasks.filter((task) => {
      const status = field(task, "status");
      return status === "todo" || status === "in_progress" || status === "blocked";
    }),
  };
}

async function findId(
  call: WorkplaceReadCall,
  tool: (typeof AMBIGUOUS_READ_TOOLS)["calendars" | "channels"],
  name: string,
  kind: "calendar" | "channel",
): Promise<string> {
  const found = rows(await call(tool, {})).find((item) => field(item, "name") === name);
  const id = found && field(found, "id");
  if (!id) throw new Error(`${kind} '${name}' no existe o no es accesible`);
  return id;
}

function rosterFromEvent(
  event: Record<string, unknown>,
  timeZone: string,
): Record<string, unknown> {
  const description = field(event, "description") ?? "";
  const startAt = field(event, "start_at");
  const endAt = field(event, "end_at");
  const name = taggedLine(description, "Turno");
  if (!name || !startAt || !endAt) return {};
  return {
    name,
    start: localClock(startAt, timeZone),
    end: localClock(endAt, timeZone),
    startAt,
    endAt,
    outgoing: names(taggedLine(description, "Sale")),
    incoming: names(taggedLine(description, "Entra")),
  };
}

function taggedLine(text: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^${escaped}:\\s*(.+)$`, "mi"));
  return match?.[1]?.trim() || undefined;
}

function names(value: string | undefined): string[] {
  return value ? value.split(",").map((name) => name.trim()).filter(Boolean) : [];
}

function localClock(iso: string, timeZone: string): string {
  const value = validDate(iso);
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  return hour && minute ? `${hour}:${minute}` : "";
}

function rows(value: unknown): Record<string, unknown>[] {
  const payload = payloadOf(value);
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data.filter(isRecord);
  if (isRecord(payload) && Array.isArray(payload.items)) return payload.items.filter(isRecord);
  return [];
}

function payloadOf(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.isError) throw new Error("Ambiguous rechazo una lectura de SilentOps");
  if (value.structuredContent !== undefined) return value.structuredContent;
  if (!Array.isArray(value.content)) return value;
  const text = value.content
    .filter(isRecord)
    .map((item) => (typeof item.text === "string" ? item.text : ""))
    .join("\n");
  if (!text) return value;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Ambiguous devolvio una lectura sin JSON interpretable");
  }
}

function field(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function validDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function normalizeChannel(value: string): string {
  return value.replace(/^#/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
