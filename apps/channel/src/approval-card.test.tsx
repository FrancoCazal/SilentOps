/**
 * approval-card.test.tsx — offline, no Slack, no credentials.
 *
 * `renderToIR` lowers the Channels JSX tree to the platform-neutral IR the
 * adapter is handed, so we can assert on what the card actually draws. The
 * behaviour of the buttons is tested through the exported `confirmApproval` /
 * `confirmRejection` helpers, which is where the write boundary is invoked.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToIR } from "@copilotkit/channels";
import {
  handoverApprovalCard,
  handoverPresentNotice,
  absenceLine,
  confirmApproval,
  confirmRejection,
  failedNotice,
  isExpired,
  refusedNotice,
  type ApprovalCardInput,
  type AbsenceEvidence,
} from "./approval-card";
import type { Proposal } from "loop-core/contracts";

/** The rendered IR as a searchable string. */
async function ir(node: unknown): Promise<string> {
  return JSON.stringify(renderToIR((await node) as never));
}

const absence: AbsenceEvidence = {
  expectedRecord: "Handover Noche 2026-09-12",
  searchedIn: "Documents",
  searchedAt: "05:45",
  matches: [],
};

const proposal: Proposal = {
  id: "prop-1",
  runId: "run-1",
  sourceEventId: "missing-handover:Noche:2026-09-12",
  actions: [
    { kind: "workspace.write", tool: "documents.create", args: {}, summary: "Crear handover Noche" },
    { kind: "workspace.write", tool: "workorders.reassign", args: {}, summary: "Reasignar #WO-1042 a Bruno" },
    { kind: "channel.send", channel: "slack", to: "#operaciones-hub-frio", body: "Handover listo", summary: "Avisar en el canal" },
  ],
  rationale:
    "Ana cierra turno con 3 órdenes abiertas y sin handover; preparo el documento y las reasigno a Bruno.",
  risk: "medium",
  status: "pending",
  createdAt: "2026-09-12T05:45:00-03:00",
  expiresAt: "2026-09-12T06:30:00-03:00",
};

const baseInput: ApprovalCardInput = {
  proposal,
  absence,
  header: {
    shiftName: "Noche",
    closesAt: "06:00",
    outgoing: ["Ana"],
    incoming: ["Bruno"],
    facility: "Hub Frío Norte",
    date: "12 sep 2026",
  },
  evidence: [
    {
      text: "Cámara 3: alerta de temperatura ya escalada por técnico a las 02:10",
      source: { url: "https://ex/msg/1", label: "fuente" },
    },
    {
      text: "Generador de respaldo: chequeo pendiente del turno anterior",
      source: { url: "https://ex/wo/1043" },
    },
  ],
  reassignedOrders: [{ id: "WO-1042", title: "Inspección cámara fría", source: { url: "https://ex/wo/1042" } }],
  onApprove: async () => {},
};

describe("absenceLine", () => {
  it("renders an empty search as an explicit 0-results statement, never a blank", () => {
    assert.equal(
      absenceLine(absence),
      '⌕ searched Documents for "Handover Noche 2026-09-12" at 05:45 → 0 results',
    );
  });

  it("counts real matches (the silent, handover-already-exists case)", () => {
    assert.equal(
      absenceLine({ ...absence, matches: [{}] }),
      '⌕ searched Documents for "Handover Noche 2026-09-12" at 05:45 → 1 result',
    );
  });
});

describe("handoverApprovalCard", () => {
  it("shows the absence evidence BEFORE the proposal", async () => {
    const out = await ir(handoverApprovalCard(baseInput));
    const iAbsence = out.indexOf("0 results");
    const iRationale = out.indexOf("preparo el documento");
    assert.ok(iAbsence !== -1, "absence line should render");
    assert.ok(iRationale !== -1, "rationale should render");
    assert.ok(iAbsence < iRationale, "the absence must come before the proposal");
  });

  it("renders the empty search as a statement inside the card too", async () => {
    const out = await ir(handoverApprovalCard(baseInput));
    assert.ok(out.includes("0 results"));
    assert.ok(out.includes("Evidencia de ausencia"));
  });

  it("links each sourced bullet", async () => {
    const out = await ir(handoverApprovalCard(baseInput));
    assert.ok(out.includes("https://ex/msg/1"));
    assert.ok(out.includes("https://ex/wo/1043"));
  });

  it("flags an unsourced bullet instead of hiding it", async () => {
    const out = await ir(
      handoverApprovalCard({ ...baseInput, evidence: [{ text: "detalle sin respaldo" }] }),
    );
    assert.ok(out.includes("detalle sin respaldo"), "the bullet text must still show");
    assert.ok(out.includes("sin fuente"), "and it must be flagged as unsourced");
  });

  it("lists the reassigned work orders", async () => {
    const out = await ir(handoverApprovalCard(baseInput));
    assert.ok(out.includes("WO-1042"));
    assert.ok(out.includes("Inspección cámara fría"));
    assert.ok(out.includes("reasignan a Bruno"));
  });

  it("uses the risk accent (medium)", async () => {
    const out = await ir(handoverApprovalCard(baseInput));
    assert.ok(out.includes("#8A5C10"));
  });

  it("switches the accent to the attention colour on a high-risk proposal", async () => {
    const out = await ir(
      handoverApprovalCard({ ...baseInput, proposal: { ...proposal, risk: "high" } }),
    );
    assert.ok(out.includes("#C4145F"));
  });

  it("offers Aprobar and Rechazar while pending", async () => {
    const out = await ir(handoverApprovalCard(baseInput));
    assert.ok(out.includes("Aprobar"));
    assert.ok(out.includes("Rechazar"));
  });

  it("hides the buttons and shows the status once no longer pending", async () => {
    const out = await ir(
      handoverApprovalCard({
        ...baseInput,
        proposal: { ...proposal, status: "approved", approvedBy: "Ana" },
      }),
    );
    assert.ok(!out.includes("Aprobar"), "an already-approved proposal must not offer Approve again");
    assert.ok(out.includes("Aprobado por Ana"));
  });

  it("always carries the guardrail line", async () => {
    const out = await ir(handoverApprovalCard(baseInput));
    assert.ok(out.includes("never controls equipment or decides safety"));
  });

  it("says nothing about a replay when the detector fired (the product path)", async () => {
    const out = await ir(handoverApprovalCard(baseInput));
    assert.ok(!out.includes("replay"), "a real detector run must not be labelled a replay");
  });

  it("labels a manual @mention replay so it cannot pass as proactive detection", async () => {
    // SILENTOPS.md forbids presenting a mention replay as the product's trigger.
    const out = await ir(handoverApprovalCard({ ...baseInput, origin: "manual-replay" }));
    assert.ok(out.includes("replay de desarrollo"));
    assert.ok(out.includes("no por el borde de turno"));
  });
});

describe("confirmApproval / confirmRejection", () => {
  // The fixture's window is the demo shift boundary, long past in wall-clock
  // terms, so the happy paths state the instant they are judged at. A real run
  // is safe: `buildProposal` stamps `expiresAt` from the wall clock, not from
  // the replayed shift instant.
  const INSIDE = new Date("2026-09-12T06:00:00-03:00");

  it("marks the proposal approved and hands it to onApprove exactly once", async () => {
    const seen: Proposal[] = [];
    const outcome = await confirmApproval(
      proposal,
      "Ana",
      async (p) => {
        seen.push(p);
      },
      INSIDE,
    );
    assert.equal(outcome.ok, true);
    assert.equal(outcome.proposal.status, "approved");
    assert.equal(outcome.proposal.approvedBy, "Ana");
    assert.equal(seen.length, 1);
    // The write boundary refuses anything not already approved/edited, so the
    // object handed to it must carry the approved status.
    assert.equal(seen[0].status, "approved");
  });

  it("does not mutate the original proposal", async () => {
    await confirmApproval(proposal, "Ana", async () => {}, INSIDE);
    assert.equal(proposal.status, "pending", "the input proposal must stay untouched");
  });

  it("REFUSES to write once the approval window has closed", async () => {
    // A card can sit in a Slack thread long after it expired, buttons still live.
    // executeApproved only checks status, so this gate has to hold here.
    let called = false;
    const outcome = await confirmApproval(
      proposal,
      "Ana",
      async () => {
        called = true;
      },
      new Date("2026-09-12T07:00:00-03:00"), // past expiresAt 06:30
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "expired");
    assert.equal(called, false, "nothing may be written after expiry");
  });

  it("still approves inside the window", async () => {
    let called = false;
    const outcome = await confirmApproval(
      proposal,
      "Ana",
      async () => {
        called = true;
      },
      new Date("2026-09-12T06:00:00-03:00"), // before expiresAt 06:30
    );
    assert.equal(outcome.ok, true);
    assert.equal(called, true);
  });

  it("treats an unreadable expiry as expired rather than writing anyway", async () => {
    let called = false;
    const outcome = await confirmApproval(
      { ...proposal, expiresAt: "no-es-una-fecha" },
      "Ana",
      async () => {
        called = true;
      },
    );
    assert.equal(outcome.ok, false);
    assert.equal(called, false);
  });

  it("refuses a second decision instead of writing twice", async () => {
    let called = false;
    const outcome = await confirmApproval(
      { ...proposal, status: "approved", approvedBy: "Ana" },
      "Bruno",
      async () => {
        called = true;
      },
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "not-pending");
    assert.equal(called, false);
  });

  it("marks rejected and performs no write when onReject is absent", async () => {
    const outcome = await confirmRejection(proposal, "Ana");
    assert.equal(outcome.ok, true);
    assert.equal(outcome.proposal.status, "rejected");
  });

  it("records the rejection through onReject when provided", async () => {
    let recorded: Proposal | undefined;
    const outcome = await confirmRejection(proposal, "Ana", async (p) => {
      recorded = p;
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.proposal.status, "rejected");
    assert.equal(recorded?.status, "rejected");
  });

  it("refuses to reject an already-decided proposal", async () => {
    const outcome = await confirmRejection({ ...proposal, status: "rejected" }, "Ana");
    assert.equal(outcome.ok, false);
  });
});

describe("isExpired / refusedNotice", () => {
  it("reports the window state around expiresAt", () => {
    assert.equal(isExpired(proposal, new Date("2026-09-12T06:00:00-03:00")), false);
    assert.equal(isExpired(proposal, new Date("2026-09-12T07:00:00-03:00")), true);
  });

  it("says plainly that nothing was written", async () => {
    const out = await ir(
      refusedNotice({ ok: false, reason: "expired", proposal: { ...proposal, status: "expired" } }),
    );
    assert.ok(out.includes("No se escribió nada"));
    assert.ok(out.includes("venció"));
  });
});

describe("failedNotice", () => {
  it("shows the reason and does not claim that nothing was written", async () => {
    // executeApproved applies actions in order, so an action before the failure
    // may already have landed. Claiming "nothing was written" would be a lie the
    // approver acts on.
    const out = await ir(
      failedNotice(
        { ...proposal, status: "approved", approvedBy: "Ana" },
        new Error("missing scope write:workspace"),
      ),
    );
    assert.ok(out.includes("missing scope write:workspace"), "the real reason must be visible");
    assert.ok(out.includes("pueden haberse aplicado"));
    assert.ok(out.includes("idempotency key"), "and retrying must be described as safe");
    assert.ok(!out.includes("Aprobar"), "a failed write offers no button");
  });
});

describe("handoverPresentNotice (agent stays silent)", () => {  it("proves the agent does not fire when a handover already exists", async () => {
    const out = await ir(
      handoverPresentNotice({ absence: { ...absence, matches: [{}] }, header: baseInput.header }),
    );
    assert.ok(out.includes("1 result"), "the search must show it found the existing handover");
    assert.ok(out.includes("Sin acción"));
    assert.ok(!out.includes("Aprobar"), "the silent notice offers no action");
  });

  it("labels a replayed silent check as a replay", async () => {
    const out = await ir(
      handoverPresentNotice({
        absence: { ...absence, matches: [{}] },
        header: baseInput.header,
        origin: "manual-replay",
      }),
    );
    assert.ok(out.includes("replay de desarrollo"));
  });
});
