/**
 * silentops.tsx — the SilentOps loop, wired into a live Slack thread.
 *
 * This is the seam between `loop-core` and the Channels surface. It is the only
 * place where the four stages meet:
 *
 *   detectMissingHandover()  deterministic, no LLM — the absence + its evidence
 *   handleEvent()            the model, whose ONLY output is propose_action
 *   handoverApprovalCard()   the human sees the evidence, then the proposal
 *   executeApproved()        the single write boundary, after a human click
 *
 * Two rules this file exists to keep:
 *
 * 1. It never writes. Approve hands the approved `Proposal` to
 *    `executeApproved`; nothing here touches Ambiguous or posts an operational
 *    message on its own.
 * 2. It never invents card content. Every bullet, source and work order shown
 *    is looked up in the detector's own event context. A `source` id that does
 *    not resolve to a real record is rendered as unsourced, not as a source.
 */
import { Context, Markdown, Message, Section } from "@copilotkit/channels";
import type { StatefulThread } from "@copilotkit/channels";
import {
  ambiguousExecutor,
  createAmbiguousWorkspaceReader,
  detectMissingHandover,
  executeApproved,
  getServiceToken,
  handleEvent,
  isAuth0Configured,
  isWorkspaceReaderRegistered,
  loggerFor,
  newRunId,
  registerOutbound,
  registerWorkspaceExecutor,
  registerWorkspaceReader,
} from "loop-core";
import type {
  InboundEvent,
  Logger,
  OutboundChannel,
  Proposal,
  ProposedAction,
} from "loop-core";
import {
  handoverApprovalCard,
  type AbsenceEvidence,
  type EvidenceBullet,
  type EvidenceSource,
  type HandoverHeader,
  type OrderRef,
  type RunOrigin,
} from "./approval-card";

/** The operations channel from SILENTOPS.md. Also an outbound registry name. */
export const OPS_CHANNEL = "#operaciones-hub-frio";

/**
 * The thread as a Channel handler hands it over. `StatefulThread` is what
 * `onMention`/`onMessage` actually receive; the exported `Thread` class is the
 * concrete implementation and would over-constrain this seam (and its test
 * doubles) for no benefit.
 */
export type HandoverThread = StatefulThread<unknown>;

const MUTED_ACCENT = "#5B6478";
const ATTENTION_ACCENT = "#C4145F";

/** A channel message as the workspace reader returns it (see evals/golden.json). */
type MessageRecord = {
  id?: string;
  author?: string;
  at?: string;
  text?: string;
  url?: string;
  permalink?: string;
};

/** An open work order as the workspace reader returns it. */
type OrderRecord = {
  id?: string;
  title?: string;
  assignee?: string;
  asset?: string;
  url?: string;
};

/**
 * Everything the card needs, read out of the detector's event. The detector
 * recorded it; this function only reshapes it. Nothing is defaulted into
 * existence: a missing field stays missing so the card can show it as missing.
 */
export type HandoverContext = {
  absence: AbsenceEvidence;
  header: HandoverHeader;
  messages: MessageRecord[];
  orders: OrderRecord[];
};

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function records<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as T[]) : [];
}

export function readHandoverContext(evt: InboundEvent): HandoverContext {
  const ctx = obj(evt.context);
  const evidence = obj(ctx.absenceEvidence);
  const shift = obj(ctx.shift);

  return {
    absence: {
      // The detector always records these three. If one is ever absent, say so
      // in the card rather than printing a confident blank.
      expectedRecord: str(evidence.expectedRecord) ?? "(registro esperado no informado)",
      searchedIn: str(evidence.searchedIn) ?? "(origen no informado)",
      searchedAt: str(evidence.searchedAt) ?? str(ctx.now) ?? "(hora no informada)",
      matches: Array.isArray(evidence.matches) ? evidence.matches : [],
    },
    header: {
      shiftName: str(shift.name),
      closesAt: str(shift.end),
      outgoing: strings(shift.outgoing),
      incoming: strings(shift.incoming),
      facility: str(ctx.facility),
      date: dateOf(evt),
    },
    messages: records<MessageRecord>(ctx.messagesSinceShiftStart),
    orders: records<OrderRecord>(ctx.openWorkOrders),
  };
}

/** The shift's local date, taken from the detector's idempotent event id. */
function dateOf(evt: InboundEvent): string | undefined {
  const fromId = /(\d{4}-\d{2}-\d{2})/.exec(evt.id)?.[1];
  if (fromId) return fromId;
  return evt.receivedAt ? evt.receivedAt.slice(0, 10) : undefined;
}

/**
 * Resolve a bullet's `source` id against the records the detector actually
 * read. An id that matches nothing is NOT a source — returning `undefined` makes
 * the card flag the bullet, which is the honest outcome.
 */
export function resolveSource(id: unknown, ctx: HandoverContext): EvidenceSource | undefined {
  const key = str(id);
  if (!key) return undefined;

  const message = ctx.messages.find((m) => m.id === key);
  if (message) {
    const label = [message.author, message.at].filter(Boolean).join(" ");
    return { url: message.url ?? message.permalink, label: label || `mensaje ${key}` };
  }

  const order = ctx.orders.find((o) => o.id === key);
  if (order) return { url: order.url, label: `#${order.id}` };

  return undefined;
}

/** Collect every string value in `args`, one level into nested objects/arrays. */
function argValues(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string") out.push(v);
  };
  for (const value of Object.values(args)) {
    push(value);
    if (Array.isArray(value)) value.forEach(push);
    else if (value && typeof value === "object") Object.values(value).forEach(push);
  }
  return out;
}

/**
 * The card's bullets. Preferred source is the handover document the proposal
 * would create — its `args.bullets` is the sourced summary the incoming shift
 * will actually read. When no action carries bullets, fall back to one bullet
 * per proposed action so the reviewer still sees what they are approving.
 */
export function bulletsFromProposal(
  actions: readonly ProposedAction[],
  ctx: HandoverContext,
): EvidenceBullet[] {
  for (const action of actions) {
    if (action.kind !== "workspace.write") continue;
    const raw = obj(action.args).bullets;
    if (!Array.isArray(raw) || raw.length === 0) continue;

    return raw
      .map((entry): EvidenceBullet | undefined => {
        if (typeof entry === "string") return { text: entry };
        const b = obj(entry);
        const text = str(b.text);
        if (!text) return undefined;
        return { text, source: resolveSource(b.source, ctx) };
      })
      .filter((b): b is EvidenceBullet => b !== undefined);
  }

  return actions.map((action) => ({
    text: action.summary,
    source: sourceForAction(action, ctx),
  }));
}

/** A source for an action is any workspace record its arguments name. */
function sourceForAction(action: ProposedAction, ctx: HandoverContext): EvidenceSource | undefined {
  if (action.kind !== "workspace.write") return undefined;
  for (const value of argValues(obj(action.args))) {
    const source = resolveSource(value, ctx);
    if (source) return source;
  }
  return undefined;
}

/**
 * The work orders the proposal touches: an open order whose id — or whose
 * operational code, e.g. `OT-241` — appears in a proposed action's arguments.
 *
 * Matching on the code as well as the id is not laxity. The workspace's real
 * record id is a UUID, while the channel and the work-order titles refer to
 * orders as `OT-241`; a model that names the order the way the humans do would
 * otherwise produce an empty reassignment list. The order still has to be one
 * the detector actually read — nothing is invented here.
 */
export function ordersFromProposal(
  actions: readonly ProposedAction[],
  ctx: HandoverContext,
): OrderRef[] {
  const named = new Set<string>();
  for (const action of actions) {
    if (action.kind !== "workspace.write") continue;
    for (const value of argValues(obj(action.args))) {
      named.add(value);
      for (const code of orderCodes(value)) named.add(code);
    }
  }

  return ctx.orders
    .filter((o) => {
      if (o.id && named.has(o.id)) return true;
      return orderCodes(o.title).some((code) => named.has(code));
    })
    .map((o) => ({
      id: o.id ?? orderCodes(o.title)[0] ?? "?",
      title: o.title ?? "(sin título)",
      source: o.url ? { url: o.url } : undefined,
    }));
}

/** Operational work-order codes as the hub writes them: OT-241, WO-1042. */
function orderCodes(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return (value.toUpperCase().match(/\b(?:OT|WO)-\d+\b/g) ?? []).map((c) => c);
}

/**
 * Post an operational message into the live thread.
 *
 * A Channel has no proactive-delivery API in this SDK version — the only handle
 * on a conversation comes from an inbound event — so `channel.send` resolves to
 * the thread the approval happened in. `to` is logged, never silently retargeted.
 */
function threadOutbound(name: string, thread: HandoverThread, log: Logger): OutboundChannel {
  return {
    name,
    async send(to, body, opts) {
      log("outbound send", { name, to, idempotencyKey: opts.idempotencyKey });
      const ref = await thread.post(body);
      return { externalId: ref.id };
    },
  };
}

/**
 * Wire the write boundary for this thread and return the Approve callback.
 *
 * Registering here, at the moment of use, keeps the executors out of module
 * load: an app that never approves anything never opens an MCP connection.
 */
export function boundaryFor(thread: HandoverThread, log: Logger): (approved: Proposal) => Promise<void> {
  registerWorkspaceExecutor(ambiguousExecutor);
  registerOutbound(threadOutbound("slack", thread, log));
  registerOutbound(threadOutbound(OPS_CHANNEL, thread, log));

  return async (approved: Proposal) => {
    // No Auth0 tenant yet → `verifyScope` refuses unless the operator sets
    // ALLOW_UNVERIFIED_WRITES=1. The boundary stays the only write path either way.
    const serviceToken = isAuth0Configured() ? await getServiceToken() : undefined;
    await executeApproved(approved, { serviceToken, log });
  };
}

/**
 * The moment the detector evaluates. Real runs use the wall clock; a rehearsal
 * sets `SILENTOPS_DEMO_AT` so the 05:45 shift boundary can be replayed at any
 * hour. An invalid value throws instead of silently falling back to `now` — a
 * demo that quietly evaluates the wrong instant is worse than one that stops.
 */
export function detectorClock(raw = process.env.SILENTOPS_DEMO_AT): Date {
  if (!raw) return new Date();
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) {
    throw new Error("SILENTOPS_DEMO_AT debe ser una fecha ISO 8601 valida");
  }
  return at;
}

/**
 * Register the read-only Ambiguous adapter once per process. The detector's
 * `readTool` throws when no reader is registered rather than returning empty —
 * an unregistered reader must never look like a missing handover.
 */
let readerReady = false;
export function ensureWorkspaceReader(): void {
  if (readerReady || isWorkspaceReaderRegistered()) {
    readerReady = true;
    return;
  }
  registerWorkspaceReader(createAmbiguousWorkspaceReader({ channelName: OPS_CHANNEL }));
  readerReady = true;
}

export type HandoverDeps = {
  /** Defaults to the real deterministic detector. */
  detect?: () => Promise<InboundEvent | null>;
  /** Defaults to the real agent run. Tests inject a scripted proposal. */
  propose?: (evt: InboundEvent, runId: string) => Promise<Proposal>;
  /** Defaults to `executeApproved` through the write boundary. */
  execute?: (approved: Proposal) => Promise<void>;
  /** Optional: record a rejection. Never writes. */
  record?: (rejected: Proposal) => Promise<void>;
  /**
   * How this pass was triggered. `manual-replay` (an @mention) is labelled on
   * the card, because SILENTOPS.md forbids presenting a replay as the product's
   * proactive detection. Defaults to `detector`.
   */
  origin?: RunOrigin;
  log?: Logger;
  runId?: string;
};

export type HandoverOutcome =
  | { fired: false; reason: "no-absence" }
  | { fired: false; reason: "no-actions"; proposal: Proposal }
  | { fired: false; reason: "failed"; error: unknown }
  | { fired: true; proposal: Proposal };

/**
 * One pass of the loop against a live thread.
 *
 * Returns without posting a card when there is nothing to propose. That silence
 * is a product behaviour, not a failure: an agent that fires on a shift that
 * already handed over is an agent that gets muted on day one.
 *
 * A *failure*, by contrast, is never silent. The reads can throw for honest
 * reasons — no active roster in the calendar, an unreachable workspace, a
 * missing model key — and an exception escaping a Channels handler would leave
 * the channel with nothing at all, which is indistinguishable from a dead bot.
 */
export async function runHandover(
  thread: HandoverThread,
  deps: HandoverDeps = {},
): Promise<HandoverOutcome> {
  const runId = deps.runId ?? newRunId();
  const log = deps.log ?? loggerFor(runId);
  try {
    return await attemptHandover(thread, deps, runId, log);
  } catch (error) {
    log("handover run failed", { runId, error: String(error) });
    await thread.post(
      <Message accent={ATTENTION_ACCENT}>
        <Section>
          <Markdown>{`⚠ *SilentOps no pudo completar la revisión del turno.*\n\`${
            error instanceof Error ? error.message : String(error)
          }\``}</Markdown>
        </Section>
        <Context>
          {"No se escribió nada. La ausencia de handover, si existe, sigue sin resolver: revisala a mano antes de cerrar el turno."}
        </Context>
        <Context>{`run ${runId}`}</Context>
      </Message>,
    );
    return { fired: false, reason: "failed", error };
  }
}

async function attemptHandover(
  thread: HandoverThread,
  deps: HandoverDeps,
  runId: string,
  log: Logger,
): Promise<HandoverOutcome> {
  const detect =
    deps.detect ??
    (() => {
      ensureWorkspaceReader();
      return detectMissingHandover({ now: detectorClock(), channel: OPS_CHANNEL });
    });
  const propose = deps.propose ?? ((evt, id) => handleEvent(evt, { runId: id, log }));

  const event = await detect();
  if (!event) {
    log("detector did not fire", { runId });
    await thread.post(
      <Message accent={MUTED_ACCENT}>
        <Section>
          <Markdown>
            {"*Sin acción.* El detector corrió y no encontró una ausencia de handover: el turno no cierra todavía, o el handover ya existe."}
          </Markdown>
        </Section>
        {deps.origin === "manual-replay" && (
          <Context>
            {"⚙︎ replay de desarrollo · disparado por mención, no por el borde de turno"}
          </Context>
        )}
        <Context>
          {"SilentOps never controls equipment or decides safety. It prepares a sourced handover for the responsible human to approve."}
        </Context>
      </Message>,
    );
    return { fired: false, reason: "no-absence" };
  }

  const context = readHandoverContext(event);
  const proposal = await propose(event, runId);

  // The agent escalated instead of proposing. Show that, and offer no button:
  // there is nothing to approve, so there must be nothing to click.
  if (proposal.actions.length === 0) {
    log("agent proposed nothing", { runId, eventId: event.id });
    await thread.post(
      <Message accent={MUTED_ACCENT}>
        <Section>
          <Markdown>{`*Sin propuesta.* ${proposal.rationale}`}</Markdown>
        </Section>
        <Context>{`Evidencia: ${context.absence.expectedRecord} · ${context.absence.searchedIn} · ${context.absence.searchedAt}`}</Context>
      </Message>,
    );
    return { fired: false, reason: "no-actions", proposal };
  }

  const actions = proposal.editedActions ?? proposal.actions;

  await thread.post(
    handoverApprovalCard({
      proposal,
      absence: context.absence,
      header: context.header,
      origin: deps.origin ?? "detector",
      evidence: bulletsFromProposal(actions, context),
      reassignedOrders: ordersFromProposal(actions, context),
      onApprove: deps.execute ?? boundaryFor(thread, log),
      onReject: deps.record,
    }),
  );

  log("approval card posted", { runId, proposalId: proposal.id, actions: actions.length });
  return { fired: true, proposal };
}
