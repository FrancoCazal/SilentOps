/**
 * El detector de SilentOps. Es lo que hace que el agente exista.
 *
 * DETERMINISTA, NO LLM. No razona: cruza dos hechos (el turno cierra / el
 * documento de handover no existe) y emite un InboundEvent con la evidencia de
 * esa ausencia. El modelo recien entra despues, para preparar la propuesta.
 *
 * Por eso el disparador del producto no es una mencion humana: nadie escribio un
 * mensaje, nadie pregunto, no hubo evento. Un chatbox no puede despertarse en el
 * borde del turno, consultar por el registro que deberia existir y conservar esa
 * cadena de evidencia.
 */
import type { InboundEvent } from "../channels/inbound";
import { TOOLS } from "../domain/tools";
import { readTool } from "../domain/workspace-reader";
import { log } from "../observability/log";

export type Shift = {
  name: string;
  /** "22:00" */
  start: string;
  /** "06:00" */
  end: string;
  /** ISO 8601 del calendario cuando el lector lo conoce. */
  startAt?: string;
  /** ISO 8601 del calendario cuando el lector lo conoce. */
  endAt?: string;
  outgoing: string[];
  incoming: string[];
};

export type DetectOptions = {
  now?: Date;
  facility?: string;
  channel?: string;
  /** Cuantos minutos antes del cierre se dispara. */
  leadMinutes?: number;
};

const DEFAULTS = {
  facility: "Hub Frio Norte",
  channel: "#operaciones-hub-frio",
  leadMinutes: 15,
};

/**
 * Devuelve el evento a procesar, o null si no hay nada que hacer.
 *
 * null NO es un error: es la mitad del producto. Un agente que dispara sobre algo
 * ya resuelto es un agente que molesta, y uno que molesta se apaga el primer dia.
 */
export async function detectMissingHandover(
  opts: DetectOptions = {},
): Promise<InboundEvent | null> {
  const now = opts.now ?? new Date();
  const facility = opts.facility ?? DEFAULTS.facility;
  const channel = opts.channel ?? DEFAULTS.channel;
  const leadMinutes = opts.leadMinutes ?? DEFAULTS.leadMinutes;

  const shift = coerceShift(await readTool(TOOLS.currentShift, { at: now.toISOString() }));
  if (!shift) {
    log("detector", "sin turno vigente", { at: now.toISOString() });
    return null;
  }

  const untilEnd = minutesUntil(now, shift.end);
  if (untilEnd < 0 || untilEnd > leadMinutes) {
    log("detector", "el turno no cierra todavia", { shift: shift.name, untilEnd });
    return null;
  }

  const dateKey = localDateKey(now);
  const expectedRecord = `Handover ${shift.name} ${dateKey}`;
  const searchedAt = clock(now);

  const found = asArray(await readTool(TOOLS.searchDocuments, { query: expectedRecord }));

  // El handover ya existe: no hay ausencia, no hay evento. Este caso esta en el
  // golden set y ademas es un plano del video (el agente que NO dispara).
  if (found.length > 0) {
    log("detector", "el handover ya existe, no se dispara", { expectedRecord });
    return null;
  }

  const [messagesSinceShiftStart, openWorkOrders] = await Promise.all([
    readTool(TOOLS.channelHistory, { channel, since: shift.startAt ?? shift.start }).then(asArray),
    readTool(TOOLS.openWorkOrders, { status: "open" }).then(asArray),
  ]);

  log("detector", "handover ausente", {
    expectedRecord,
    outgoing: shift.outgoing.join(", "),
    openWorkOrders: openWorkOrders.length,
  });

  return {
    // Idempotente por turno y dia: si el job corre dos veces no salen dos
    // propuestas ni dos documentos. Es la semilla de boundary/idempotency.ts.
    id: `missing-handover:${shift.name}:${dateKey}`,
    channel: "cron",
    from: { externalId: "silentops-detector", displayName: "SilentOps" },
    receivedAt: now.toISOString(),
    context: {
      facility,
      shift,
      channel,
      // Por que el agente se desperto. El modelo nunca recibe un booleano opaco:
      // recibe que se busco, donde, cuando y que no habia.
      absenceEvidence: {
        expectedRecord,
        searchedIn: "Documents",
        searchedAt,
        matches: found,
      },
      messagesSinceShiftStart,
      openWorkOrders,
      now: searchedAt,
    },
  };
}

/**
 * Minutos desde `now` hasta un "HH:MM" del reloj, tolerando turnos que cruzan
 * medianoche (22:00 a 06:00). Negativo = ya paso.
 */
export function minutesUntil(now: Date, hhmm: string): number {
  const [hh, mm] = hhmm.split(":");
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return Number.NaN;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  let diff = h * 60 + m - nowMinutes;
  if (diff < -12 * 60) diff += 24 * 60;
  if (diff > 12 * 60) diff -= 24 * 60;
  return diff;
}

/** YYYY-MM-DD en hora local (no UTC: el turno es un hecho local). */
export function localDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** HH:MM en hora local. */
function clock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    const inner =
      (v as Record<string, unknown>).items ??
      (v as Record<string, unknown>).results ??
      (v as Record<string, unknown>).data;
    if (Array.isArray(inner)) return inner;
  }
  return [];
}

function coerceShift(v: unknown): Shift | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const shift = (o.shift && typeof o.shift === "object" ? o.shift : o) as Record<string, unknown>;
  const name = shift.name;
  const start = shift.start;
  const end = shift.end;
  if (typeof name !== "string" || typeof start !== "string" || typeof end !== "string") {
    return undefined;
  }
  return {
    name,
    start,
    end,
    startAt: typeof shift.startAt === "string" ? shift.startAt : undefined,
    endAt: typeof shift.endAt === "string" ? shift.endAt : undefined,
    outgoing: asStringArray(shift.outgoing),
    incoming: asStringArray(shift.incoming),
  };
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
