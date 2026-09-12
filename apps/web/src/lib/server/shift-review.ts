import {
  TOOLS,
  createAmbiguousWorkspaceReader,
  detectMissingHandover,
  isWorkspaceReaderRegistered,
  localDateKey,
  minutesUntil,
  readTool,
  registerWorkspaceReader,
} from "loop-core";

/**
 * Live data for the control tower, read from the real Ambiguous workspace.
 *
 * READ-ONLY. This module calls only `loop-core`'s read surface — `readTool` with
 * the four `TOOLS` intents, plus the deterministic `detectMissingHandover`. There
 * is no path from here to a write: the console shows what is true and Slack is
 * where a human approves. Nothing in `packages/loop-core` is modified; this is a
 * consumer of its public exports.
 *
 * Failure is a first-class state, not an exception. A cold-chain supervisor
 * opening a dashboard that throws learns nothing; every outcome below is a value
 * the page can render.
 *
 * `SILENTOPS_DEMO_AT` pins the instant, matching
 * `npm run silentops:detect -w loop-core`, so the tower can be shown at the
 * 05:45 shift boundary without waiting for 05:45.
 */

export type ShiftFacts = {
  name: string;
  start: string;
  end: string;
  outgoing: string[];
  incoming: string[];
  /** Negative once the shift close has passed. */
  minutesToClose: number;
};

export type WorkOrderFact = {
  /** Human reference such as TASK-001, never the provider UUID. */
  id?: string;
  title: string;
  assignee?: string;
  status?: string;
};
export type MessageFact = { at?: string; author?: string; text: string };

export type ShiftReview =
  /** No AMBIGUOUS_API_KEY: the tower cannot read anything real. */
  | { status: "unconfigured" }
  /** The workspace was reachable but the read failed. */
  | { status: "error"; message: string }
  /** No shift is closing within the detector's lead window. */
  | { status: "idle"; at: string; shift?: ShiftFacts }
  /** A shift is closing and its handover already exists: the agent stays quiet. */
  | {
      status: "present";
      at: string;
      shift: ShiftFacts;
      expectedRecord: string;
      searchedAt: string;
      matchCount: number;
    }
  /** A shift is closing and the handover is absent. This is the product. */
  | {
      status: "missing";
      at: string;
      shift: ShiftFacts;
      expectedRecord: string;
      searchedAt: string;
      eventId: string;
      workOrders: WorkOrderFact[];
      messages: MessageFact[];
      /** True when the deterministic detector also emitted the event. */
      detectorFired: boolean;
    };

export function workspaceIsConfigured(): boolean {
  return Boolean(process.env.AMBIGUOUS_API_KEY?.trim());
}

/** Register the real reader once per process. */
function ensureReader(): void {
  if (!isWorkspaceReaderRegistered()) {
    registerWorkspaceReader(createAmbiguousWorkspaceReader());
  }
}

function reviewInstant(): Date {
  const pinned = process.env.SILENTOPS_DEMO_AT?.trim();
  if (!pinned) return new Date();
  const at = new Date(pinned);
  return Number.isNaN(at.getTime()) ? new Date() : at;
}

/** MCP discovery over the network; a hung call must not hang the page. */
const READ_TIMEOUT_MS = 12_000;

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const alarm = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not answer in time`)),
      READ_TIMEOUT_MS,
    );
  });
  // Always clear the timer: an uncleared one keeps the event loop alive long
  // after the read resolved, which stalls process exit and slows tests.
  return Promise.race([work, alarm]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * Short cache. A server component can render several times per navigation and
 * each read is an MCP round trip; 15 seconds keeps the tower honest without
 * hammering the workspace.
 */
let cached: { at: number; value: ShiftReview } | undefined;
const CACHE_MS = 15_000;

export async function loadShiftReview(): Promise<ShiftReview> {
  if (!workspaceIsConfigured()) return { status: "unconfigured" };
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const value = await readReview();
  cached = { at: Date.now(), value };
  return value;
}

export function clearShiftReviewCache(): void {
  cached = undefined;
}

async function readReview(): Promise<ShiftReview> {
  const now = reviewInstant();
  const at = now.toISOString();

  try {
    ensureReader();

    const shift = coerceShift(
      await withTimeout(readTool(TOOLS.currentShift, { at }), "Shift roster"),
    );
    if (!shift) return { status: "idle", at };

    // Same lead window the detector uses, so the tower and the job agree.
    if (shift.minutesToClose < 0 || shift.minutesToClose > 15) {
      return { status: "idle", at, shift };
    }

    const expectedRecord = `Handover ${shift.name} ${localDateKey(now)}`;
    const searchedAt = hhmm(now);
    const found = asArray(
      await withTimeout(
        readTool(TOOLS.searchDocuments, { query: expectedRecord }),
        "Document search",
      ),
    );

    if (found.length > 0) {
      return {
        status: "present",
        at,
        shift,
        expectedRecord,
        searchedAt,
        matchCount: found.length,
      };
    }

    const [orders, messages, event] = await Promise.all([
      withTimeout(
        readTool(TOOLS.openWorkOrders, { status: "open" }),
        "Work orders",
      ).then(asArray),
      withTimeout(
        readTool(TOOLS.channelHistory, {
          since: shift.startAt ?? shift.start,
        }),
        "Channel history",
      ).then(asArray),
      // The authoritative deterministic decision, run alongside our own reads so
      // the page can show whether the job would actually have fired.
      withTimeout(detectMissingHandover({ now }), "Detector").catch(() => null),
    ]);

    return {
      status: "missing",
      at,
      shift,
      expectedRecord,
      searchedAt,
      eventId: `missing-handover:${shift.name}:${localDateKey(now)}`,
      workOrders: orders.map(coerceWorkOrder).slice(0, 20),
      messages: messages.map(coerceMessage).slice(0, 20),
      detectorFired: event !== null,
    };
  } catch (error) {
    // Controlled messages only. Transport and MCP errors can carry credentials.
    const message =
      error instanceof Error && /did not answer in time/.test(error.message)
        ? error.message
        : "Could not read the Ambiguous workspace. Check AMBIGUOUS_API_KEY, the workspace tools and network access, then reload.";
    return { status: "error", message };
  }
}

/* ------------------------------------------------------------ coercion ---- */
/*
 * The workspace is a live provider: shapes are checked, never assumed. The field
 * names below were read off the real workspace — tasks carry `task_key` and a
 * UUID `id`, messages carry `content` and `created_at`, and `author`/`assignee`
 * arrive as objects rather than strings.
 */

/** A provider UUID is an identifier, not something to show a supervisor. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readableRef(value: unknown): string | undefined {
  const text = str(value);
  return text && !UUID.test(text) ? text : undefined;
}

/** `author` and `assignee` come back as objects on the real provider. */
function personName(value: unknown): string | undefined {
  if (typeof value === "string") return str(value);
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  return (
    str(raw.name) ??
    str(raw.display_name) ??
    str(raw.full_name) ??
    str(raw.username) ??
    str(raw.email)
  );
}

/** ISO timestamps render as a clock; anything else passes through. */
function shortTime(value: unknown): string | undefined {
  const text = str(value);
  if (!text) return undefined;
  const at = new Date(text);
  if (Number.isNaN(at.getTime())) return text;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(at.getHours())}:${p(at.getMinutes())}`;
}

type ShiftWithStart = ShiftFacts & { startAt?: string };

function coerceShift(value: unknown): ShiftWithStart | undefined {
  if (!value || typeof value !== "object") return undefined;
  const outer = value as Record<string, unknown>;
  const raw = (
    outer.shift && typeof outer.shift === "object" ? outer.shift : outer
  ) as Record<string, unknown>;
  const { name, start, end } = raw;
  if (
    typeof name !== "string" ||
    typeof start !== "string" ||
    typeof end !== "string"
  ) {
    return undefined;
  }
  return {
    name,
    start,
    end,
    outgoing: strings(raw.outgoing),
    incoming: strings(raw.incoming),
    startAt: typeof raw.startAt === "string" ? raw.startAt : undefined,
    minutesToClose: minutesUntil(reviewInstant(), end),
  };
}

function coerceWorkOrder(value: unknown): WorkOrderFact {
  if (typeof value === "string") return { title: value };
  if (!value || typeof value !== "object") return { title: "(untitled)" };
  const raw = value as Record<string, unknown>;
  return {
    // `task_key` is the human reference; `id` is a UUID and stays hidden.
    id:
      readableRef(raw.task_key) ??
      readableRef(raw.key) ??
      readableRef(raw.reference) ??
      readableRef(raw.id),
    title: str(raw.title) ?? str(raw.name) ?? str(raw.summary) ?? "(untitled)",
    assignee: personName(raw.assignee) ?? personName(raw.assigned_to),
    status: str(raw.status),
  };
}

function coerceMessage(value: unknown): MessageFact {
  if (typeof value === "string") return { text: value };
  if (!value || typeof value !== "object") return { text: "(empty)" };
  const raw = value as Record<string, unknown>;
  return {
    at:
      shortTime(raw.at) ??
      shortTime(raw.created_at) ??
      shortTime(raw.timestamp),
    author: personName(raw.author) ?? personName(raw.from) ?? personName(raw.user),
    text:
      str(raw.content) ??
      str(raw.text) ??
      str(raw.body) ??
      str(raw.message) ??
      "(empty)",
  };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    for (const key of ["items", "results", "data"]) {
      if (Array.isArray(raw[key])) return raw[key] as unknown[];
    }
  }
  return [];
}

function hhmm(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
