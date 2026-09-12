/**
 * approval-card.tsx — SilentOps handover approval card (R3, David).
 *
 * The surface the outgoing supervisor sees in #operaciones-hub-frio. It renders
 * a frozen `Proposal` plus the detector's absence evidence, and its Approve
 * button is the ONLY path to a write: it hands the approved proposal to
 * `onApprove`, which server.ts wires to `executeApproved(proposal, …)`. The card
 * never writes to the workspace or posts a message on its own — that single
 * write boundary is the guarantee the demo sells.
 *
 * Design source: the Claude console mockup ("Console approval states mockup").
 * That mockup is a web artifact for the video; THIS file is the real Slack
 * Channels card. One JSX tree lowers to Slack Block Kit — this is NOT React.
 *
 * The most important rule of this file: `matches: []` is the product's central
 * evidence and an empty array must read as an explicit statement
 * (`searched Documents for "…" at 05:45 → 0 results`), never as blank space.
 */
import {
  Message,
  Header,
  Section,
  Markdown,
  Context,
  Divider,
  Actions,
  Button,
} from "@copilotkit/channels";
import { effectiveActions, type Proposal, type Risk } from "loop-core/contracts";

/**
 * The detector's recorded absence evidence. It lives on
 * `InboundEvent.context.absenceEvidence` (see jobs/missing-handover.ts); the
 * code that posts the card passes it in alongside the proposal. `matches` stays
 * `unknown[]` because it mirrors whatever the workspace search returned.
 */
export type AbsenceEvidence = {
  expectedRecord: string;
  searchedIn: string;
  searchedAt: string;
  matches: readonly unknown[];
};

export type EvidenceSource = { url?: string; label?: string };

/** A single sourced bullet. If `source` is missing it is flagged, never hidden. */
export type EvidenceBullet = { text: string; source?: EvidenceSource };

/** A work order that will be reassigned to the incoming shift. */
export type OrderRef = { id: string; title: string; source?: EvidenceSource };

/** Shift framing for the header. Sourced from the originating event context. */
export type HandoverHeader = {
  shiftName?: string;
  closesAt?: string;
  outgoing?: string[];
  incoming?: string[];
  facility?: string;
  date?: string;
};

/**
 * How this run was triggered.
 *
 * `detector` is the product: the scheduled shift-boundary job woke up on its own.
 * `manual-replay` is the development smoke test (an @mention replaying the same
 * code path). SILENTOPS.md forbids presenting a replay as the product's
 * proactive detection, so a replay is LABELLED on the card itself — that way a
 * frame filmed by accident cannot be mistaken for the real trigger.
 */
export type RunOrigin = "detector" | "manual-replay";

const REPLAY_NOTICE =
  "⚙︎ replay de desarrollo · disparado por mención, no por el borde de turno";

export type ApprovalCardInput = {
  proposal: Proposal;
  absence: AbsenceEvidence;
  header?: HandoverHeader;
  /**
   * How the run was triggered. Defaults to `detector` (the product). A
   * `manual-replay` is labelled on the card.
   */
  origin?: RunOrigin;
  /** Sourced bullets from R1 (Franco). An unsourced bullet is a Franco bug. */
  evidence?: EvidenceBullet[];
  reassignedOrders?: OrderRef[];
  /**
   * Wired by server.ts to `executeApproved(approved, { serviceToken, log })`.
   * Receives the proposal already marked `approved`, because the write boundary
   * refuses anything whose status is not `approved`/`edited`.
   */
  onApprove: (approved: Proposal) => Promise<void>;
  /** Optional: record the rejection. Never performs a write. */
  onReject?: (rejected: Proposal) => Promise<void>;
};

// Accents reuse the calibrated palette from components.tsx so the whole channel
// triages by glance with one vocabulary of colour.
const RISK_ACCENT: Record<Risk, string> = {
  low: "#2E7D5B",
  medium: "#8A5C10",
  high: "#C4145F",
};
const RISK_LABEL: Record<Risk, string> = { low: "bajo", medium: "medio", high: "alto" };
const GOOD_ACCENT = "#2E7D5B";
const MUTED_ACCENT = "#5B6478";

const GUARDRAIL =
  "SilentOps never controls equipment or decides safety. It prepares a sourced handover for the responsible human to approve.";

/**
 * The absence, as a sentence. An empty result set becomes "0 results", never a
 * blank. This string is the load-bearing line of the whole product.
 */
export function absenceLine(a: AbsenceEvidence): string {
  const n = a.matches.length;
  const result = n === 0 ? "0 results" : `${n} result${n === 1 ? "" : "s"}`;
  return `⌕ searched ${a.searchedIn} for "${a.expectedRecord}" at ${a.searchedAt} → ${result}`;
}

function headerLine(h?: HandoverHeader): string {
  if (h?.shiftName && h.closesAt) {
    const out = h.outgoing?.length ? h.outgoing.join(", ") : "turno saliente";
    const inc = h.incoming?.length ? h.incoming.join(", ") : "turno entrante";
    return `Turno ${h.shiftName} cierra ${h.closesAt} · ${out} sale, ${inc} entra`;
  }
  return "Propuesta de handover";
}

function bulletLine(b: EvidenceBullet): string {
  if (b.source?.url) {
    const label = b.source.label ?? "fuente";
    return `• ${b.text}  <${b.source.url}|↗ ${label}>`;
  }
  // A source that resolved to a real workspace record but carries no permalink
  // is still a source. Name it instead of pretending it is missing.
  if (b.source?.label) {
    return `• ${b.text}  _↗ ${b.source.label}_`;
  }
  // Do not dress up a missing source — flag it so Franco fixes it upstream.
  return `• ${b.text}  ⚠ _sin fuente_`;
}

function orderLine(o: OrderRef): string {
  const src = o.source?.url ? `  <${o.source.url}|↗ fuente>` : "";
  return `• \`#${o.id}\` ${o.title}${src}`;
}

function ordersLabel(h?: HandoverHeader): string {
  return h?.incoming?.length
    ? `Órdenes que se reasignan a ${h.incoming.join(", ")}:`
    : "Órdenes que se reasignan:";
}

function statusLine(p: Proposal): string {
  switch (p.status) {
    case "approved":
    case "edited":
      return `✓ Aprobado${p.approvedBy ? ` por ${p.approvedBy}` : ""}`;
    case "rejected":
      return "Propuesta rechazada · nada se escribió";
    case "expired":
      return "Propuesta expirada · nada se escribió";
    default:
      return "";
  }
}

function readUserName(user: unknown): string | undefined {
  if (user && typeof user === "object") {
    const u = user as Record<string, unknown>;
    if (typeof u.displayName === "string" && u.displayName) return u.displayName;
    if (typeof u.externalId === "string" && u.externalId) return u.externalId;
  }
  return undefined;
}

/** `HH:MM` of an ISO timestamp, for the approval window shown on the card. */
function clockOf(iso: string): string | undefined {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(at.getHours())}:${p(at.getMinutes())}`;
}

/**
 * Has the approval window closed?
 *
 * An unparseable `expiresAt` counts as expired: refusing to write on a date we
 * cannot read is the safe direction of failure.
 */
export function isExpired(p: Proposal, now: Date = new Date()): boolean {
  const at = new Date(p.expiresAt);
  if (Number.isNaN(at.getTime())) return true;
  return at.getTime() <= now.getTime();
}

/**
 * The result of a click on Approve.
 *
 * A refusal is not an error: a card can sit in a Slack thread long after its
 * window closed, and its buttons stay live. `executeApproved` only checks
 * status, so the expiry gate has to live here — at the approval gate — or a
 * stale click would write.
 */
export type ApprovalOutcome =
  | { ok: true; proposal: Proposal }
  | { ok: false; reason: "expired" | "not-pending"; proposal: Proposal };

/**
 * Mark the proposal approved and hand it to the write boundary. Exported so the
 * button's behaviour is unit-testable without rendering Slack.
 *
 * Refuses — and calls nothing — when the window has closed or the proposal was
 * already decided. Nothing is written on a refusal.
 */
export async function confirmApproval(
  proposal: Proposal,
  approver: string | undefined,
  onApprove: (approved: Proposal) => Promise<void>,
  now: Date = new Date(),
): Promise<ApprovalOutcome> {
  if (proposal.status !== "pending") {
    return { ok: false, reason: "not-pending", proposal };
  }
  if (isExpired(proposal, now)) {
    return { ok: false, reason: "expired", proposal: { ...proposal, status: "expired" } };
  }

  const approved: Proposal = { ...proposal, status: "approved", approvedBy: approver };
  await onApprove(approved);
  return { ok: true, proposal: approved };
}

/**
 * Mark the proposal rejected. Never writes; `onReject` only records the decision.
 * Rejecting an expired proposal is harmless, so only a double decision is refused.
 */
export async function confirmRejection(
  proposal: Proposal,
  actor: string | undefined,
  onReject?: (rejected: Proposal) => Promise<void>,
): Promise<ApprovalOutcome> {
  if (proposal.status !== "pending") {
    return { ok: false, reason: "not-pending", proposal };
  }
  const rejected: Proposal = { ...proposal, status: "rejected", approvedBy: actor };
  if (onReject) await onReject(rejected);
  return { ok: true, proposal: rejected };
}

/** The confirmation card shown in-place after approval. */
export function approvedNotice(p: Proposal, header?: HandoverHeader) {
  return (
    <Message accent={GOOD_ACCENT}>
      <Header>{headerLine(header)}</Header>
      <Section>
        <Markdown>{`✓ *Aprobado${p.approvedBy ? ` por ${p.approvedBy}` : ""}* · handover creado`}</Markdown>
      </Section>
      <Context>{`${effectiveActions(p).length} acción(es) ejecutadas por el boundary · escritura autorizada por humano`}</Context>
      <Context>{GUARDRAIL}</Context>
    </Message>
  );
}

/** The card shown in-place after rejection. */
export function rejectedNotice(p: Proposal) {
  return (
    <Message accent={MUTED_ACCENT}>
      <Section>
        <Markdown>{statusLine(p)}</Markdown>
      </Section>
      <Context>{GUARDRAIL}</Context>
    </Message>
  );
}

/**
 * A click that was refused. Says why, and says plainly that nothing was written
 * — a stale button that appears to do nothing is worse than one that explains
 * itself.
 */
export function refusedNotice(outcome: Extract<ApprovalOutcome, { ok: false }>) {
  const why =
    outcome.reason === "expired"
      ? "La ventana de aprobación de esta propuesta ya venció."
      : "Esta propuesta ya fue decidida.";
  return (
    <Message accent={MUTED_ACCENT}>
      <Section>
        <Markdown>{`*Sin acción.* ${why} **No se escribió nada.**`}</Markdown>
      </Section>
      <Context>
        {outcome.reason === "expired"
          ? `venció ${clockOf(outcome.proposal.expiresAt) ?? outcome.proposal.expiresAt} · pedí una propuesta nueva al detector`
          : `estado actual: ${outcome.proposal.status}`}
      </Context>
      <Context>{GUARDRAIL}</Context>
    </Message>
  );
}

/**
 * A failed write must be visible. Silence after a click is the worst outcome on
 * this surface: the approver cannot tell whether the handover exists.
 *
 * The wording deliberately does NOT claim that nothing was written.
 * `executeApproved` runs the approved actions in order, so an action before the
 * failure may already have been applied. Every action carries an idempotency
 * key, which is what makes approving again safe rather than duplicating work.
 */
export function failedNotice(p: Proposal, error: unknown) {
  const reason = error instanceof Error ? error.message : String(error);
  return (
    <Message accent={RISK_ACCENT.high}>
      <Section>
        <Markdown>{`⚠ *La ejecución se interrumpió.*\n\`${reason}\``}</Markdown>
      </Section>
      <Context>
        {`Aprobada por ${p.approvedBy ?? "(sin identificar)"} · las acciones anteriores a la falla pueden haberse aplicado`}
      </Context>
      <Context>
        {"Cada acción lleva idempotency key: volver a aprobar no duplica lo ya escrito."}
      </Context>
      <Context>{GUARDRAIL}</Context>
    </Message>
  );
}

/**
 * The approval card. Evidence of absence FIRST, proposal SECOND — the ordering
 * is what separates this from a notification bot.
 */
export function handoverApprovalCard(input: ApprovalCardInput) {
  const {
    proposal,
    absence,
    header,
    origin = "detector",
    evidence = [],
    reassignedOrders = [],
    onApprove,
    onReject,
  } = input;
  const actions = effectiveActions(proposal);

  return (
    <Message accent={RISK_ACCENT[proposal.risk]}>
      <Header>{headerLine(header)}</Header>
      {header?.facility && (
        <Context>{`${header.facility}${header.date ? ` · ${header.date}` : ""}`}</Context>
      )}
      {origin === "manual-replay" && <Context>{REPLAY_NOTICE}</Context>}

      {/* 1. Evidence of absence — always first, always an explicit statement. */}
      <Section>
        <Markdown>{`*Evidencia de ausencia*\n\`${absenceLine(absence)}\``}</Markdown>
      </Section>

      <Divider />

      {/* 2. The proposal. */}
      <Context>{`Propuesta · riesgo ${RISK_LABEL[proposal.risk]}`}</Context>
      <Section>
        <Markdown>{proposal.rationale}</Markdown>
      </Section>

      {evidence.length > 0 && (
        <Section>
          <Markdown>{`*Evidencia*\n${evidence.map(bulletLine).join("\n")}`}</Markdown>
        </Section>
      )}

      {reassignedOrders.length > 0 && (
        <Section>
          <Markdown>{`*${ordersLabel(header)}*\n${reassignedOrders.map(orderLine).join("\n")}`}</Markdown>
        </Section>
      )}

      {proposal.status === "pending" ? (
        <>
          <Context>{`${actions.length} acción(es) al aprobar · cada escritura cruza el boundary (scope Auth0 + idempotencia)`}</Context>
          <Actions>
            <Button
              value="approve"
              style="primary"
              onClick={async (ctx) => {
                const approver = readUserName((ctx as { user?: unknown }).user);
                // Two failure modes, both of which must be visible:
                //  · refused  — window closed or already decided; nothing written.
                //  · thrown   — the write itself broke mid-way; may be partial.
                let outcome: ApprovalOutcome;
                try {
                  outcome = await confirmApproval(proposal, approver, onApprove);
                } catch (error) {
                  const attempted: Proposal = {
                    ...proposal,
                    status: "approved",
                    approvedBy: approver,
                  };
                  await ctx.thread.update(ctx.message.ref, failedNotice(attempted, error));
                  return;
                }
                await ctx.thread.update(
                  ctx.message.ref,
                  outcome.ok ? approvedNotice(outcome.proposal, header) : refusedNotice(outcome),
                );
              }}
            >
              Aprobar
            </Button>
            <Button
              value="reject"
              style="danger"
              onClick={async (ctx) => {
                const actor = readUserName((ctx as { user?: unknown }).user);
                const outcome = await confirmRejection(proposal, actor, onReject);
                await ctx.thread.update(
                  ctx.message.ref,
                  outcome.ok ? rejectedNotice(outcome.proposal) : refusedNotice(outcome),
                );
              }}
            >
              Rechazar
            </Button>
          </Actions>
          <Context>
            {`aprueba ${header?.outgoing?.[0] ?? "la persona saliente"} · firma de salida${
              clockOf(proposal.expiresAt) ? ` · válida hasta ${clockOf(proposal.expiresAt)}` : ""
            }`}
          </Context>
        </>
      ) : (
        <Context>{statusLine(proposal)}</Context>
      )}

      <Context>{GUARDRAIL}</Context>
    </Message>
  );
}

/**
 * The silent case: the detector re-checked at shift close and a handover
 * ALREADY exists, so the agent proposes nothing. Rendering this proves the
 * agent does not fire when there is nothing to do — the "not firing" beat that
 * answers the judges' first objection ("does it nag all the time?").
 */
export function handoverPresentNotice(input: {
  absence: AbsenceEvidence;
  header?: HandoverHeader;
  sourceUrl?: string;
  origin?: RunOrigin;
}) {
  const { absence, header, sourceUrl, origin = "detector" } = input;
  const link = sourceUrl ? `  <${sourceUrl}|↗ fuente>` : "";
  return (
    <Message accent={MUTED_ACCENT}>
      <Header>{headerLine(header)}</Header>
      {origin === "manual-replay" && <Context>{REPLAY_NOTICE}</Context>}
      <Section>
        <Markdown>{`*Evidencia*\n\`${absenceLine(absence)}\``}</Markdown>
      </Section>
      <Section>
        <Markdown>{`Handover ya presente en ${absence.searchedIn}. Sin acción.${link}`}</Markdown>
      </Section>
      <Context>{GUARDRAIL}</Context>
    </Message>
  );
}
