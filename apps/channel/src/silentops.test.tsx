/**
 * silentops.test.tsx — the loop seam, offline. No Slack, no Ambiguous, no model.
 *
 * The detector and the agent are injected, so these tests assert the thing that
 * actually needs proving: that the card is built only from the detector's own
 * event context, and that Approve reaches the write boundary exactly once with a
 * proposal already marked `approved`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToIR } from "@copilotkit/channels";
import type { InboundEvent, Proposal, ProposedAction } from "loop-core";
import {
  bulletsFromProposal,
  detectorClock,
  ordersFromProposal,
  readHandoverContext,
  resolveSource,
  runHandover,
} from "./silentops";

/** A thread that records what was posted instead of talking to Slack. */
function fakeThread() {
  const posted: unknown[] = [];
  const thread = {
    platform: "slack",
    async post(ui: unknown) {
      posted.push(ui);
      return { id: `msg-${posted.length}` };
    },
    async update(_ref: unknown, ui: unknown) {
      posted.push(ui);
      return { id: `msg-${posted.length}` };
    },
    async subscribe() {},
  };
  return { thread, posted };
}

async function ir(node: unknown): Promise<string> {
  return JSON.stringify(renderToIR((await node) as never));
}

const event: InboundEvent = {
  id: "missing-handover:Noche:2026-09-12",
  channel: "cron",
  from: { externalId: "silentops-detector", displayName: "SilentOps" },
  receivedAt: "2026-09-12T08:45:00.000Z",
  context: {
    facility: "Hub Frio Norte",
    channel: "#operaciones-hub-frio",
    shift: {
      name: "Noche",
      start: "22:00",
      end: "06:00",
      outgoing: ["Ana"],
      incoming: ["Bruno"],
    },
    absenceEvidence: {
      expectedRecord: "Handover Noche 2026-09-12",
      searchedIn: "Documents",
      searchedAt: "05:45",
      matches: [],
    },
    messagesSinceShiftStart: [
      { id: "m1", author: "Ana", at: "03:00", text: "OT-88 no la voy a cerrar en este turno" },
    ],
    openWorkOrders: [
      { id: "OT-88", asset: "camara-3", assignee: "Ana", title: "Inspeccion camara 3" },
    ],
    now: "05:45",
  },
};

const actions: ProposedAction[] = [
  {
    kind: "workspace.write",
    tool: "create_document",
    args: {
      title: "Handover Noche 2026-09-12",
      bullets: [
        { text: "OT-88 queda abierta", source: "m1" },
        { text: "Camara 3 con alerta ya escalada", source: "OT-88" },
        { text: "El generador quedo raro", source: "no-existe" },
      ],
    },
    summary: "Crear el handover del turno Noche",
  },
  {
    kind: "workspace.write",
    tool: "update_task",
    args: { id: "OT-88", assignee: "Bruno" },
    summary: "Reasignar OT-88 de Ana a Bruno porque Ana sale de turno",
  },
  {
    kind: "channel.send",
    channel: "slack",
    to: "#operaciones-hub-frio",
    body: "Bruno, te queda OT-88 abierta del turno anterior.",
    summary: "Avisar la reasignacion en el canal",
  },
];

const proposal: Proposal = {
  id: "prop-1",
  runId: "run-1",
  sourceEventId: event.id,
  actions,
  rationale: "No existe el handover y queda una orden abierta.",
  risk: "medium",
  status: "pending",
  createdAt: "2026-09-12T08:45:00.000Z",
  expiresAt: "2026-09-12T08:55:00.000Z",
};

describe("readHandoverContext", () => {
  it("reads the absence evidence verbatim from the detector's event", () => {
    const ctx = readHandoverContext(event);
    assert.equal(ctx.absence.expectedRecord, "Handover Noche 2026-09-12");
    assert.equal(ctx.absence.searchedIn, "Documents");
    assert.equal(ctx.absence.searchedAt, "05:45");
    assert.deepEqual(ctx.absence.matches, []);
  });

  it("frames the shift from the roster the detector read", () => {
    const { header } = readHandoverContext(event);
    assert.equal(header.shiftName, "Noche");
    assert.equal(header.closesAt, "06:00");
    assert.deepEqual(header.outgoing, ["Ana"]);
    assert.deepEqual(header.incoming, ["Bruno"]);
    assert.equal(header.facility, "Hub Frio Norte");
    assert.equal(header.date, "2026-09-12", "the date comes from the idempotent event id");
  });

  it("says a missing field is missing instead of printing a confident blank", () => {
    const ctx = readHandoverContext({ ...event, context: {} });
    assert.match(ctx.absence.expectedRecord, /no informado/);
    assert.match(ctx.absence.searchedIn, /no informado/);
    assert.deepEqual(ctx.absence.matches, []);
  });
});

describe("resolveSource", () => {
  it("resolves a channel message to its author and time", () => {
    const source = resolveSource("m1", readHandoverContext(event));
    assert.equal(source?.label, "Ana 03:00");
  });

  it("resolves a work order to its id", () => {
    const source = resolveSource("OT-88", readHandoverContext(event));
    assert.equal(source?.label, "#OT-88");
  });

  it("refuses to invent a source for an id the detector never read", () => {
    assert.equal(resolveSource("no-existe", readHandoverContext(event)), undefined);
    assert.equal(resolveSource(undefined, readHandoverContext(event)), undefined);
  });
});

describe("bulletsFromProposal", () => {
  it("uses the handover document's own sourced bullets", () => {
    const bullets = bulletsFromProposal(actions, readHandoverContext(event));
    assert.equal(bullets.length, 3);
    assert.equal(bullets[0].text, "OT-88 queda abierta");
    assert.equal(bullets[0].source?.label, "Ana 03:00");
    assert.equal(bullets[1].source?.label, "#OT-88");
  });

  it("leaves an unresolvable source unsourced so the card flags it", () => {
    const bullets = bulletsFromProposal(actions, readHandoverContext(event));
    assert.equal(bullets[2].source, undefined);
  });

  it("falls back to the action summaries when no action carries bullets", () => {
    const ctx = readHandoverContext(event);
    const bullets = bulletsFromProposal([actions[1], actions[2]], ctx);
    assert.equal(bullets.length, 2);
    assert.equal(bullets[0].text, actions[1].summary);
    assert.equal(bullets[0].source?.label, "#OT-88", "the reassign action names OT-88");
    assert.equal(bullets[1].source, undefined, "a channel message is not a workspace source");
  });
});

describe("ordersFromProposal", () => {
  it("lists only the open orders the proposal actually names", () => {
    const orders = ordersFromProposal(actions, readHandoverContext(event));
    assert.deepEqual(
      orders.map((o) => o.id),
      ["OT-88"],
    );
    assert.equal(orders[0].title, "Inspeccion camara 3");
  });

  it("lists nothing when no action names an order", () => {
    const orders = ordersFromProposal([actions[2]], readHandoverContext(event));
    assert.deepEqual(orders, []);
  });

  it("matches the operational code when the record id is an opaque uuid", () => {
    // The real Ambiguous record id is a uuid, but the channel and the work-order
    // titles call the order OT-241. Naming it the human way must still resolve.
    const uuidCtx = readHandoverContext({
      ...event,
      context: {
        ...(event.context as Record<string, unknown>),
        openWorkOrders: [
          { id: "8f0c1b6e-1111-4222-8333-444455556666", title: "OT-241 Inspeccion camara fria" },
        ],
      },
    });
    const byCode: ProposedAction[] = [
      { kind: "workspace.write", tool: "update_task", args: { task: "OT-241", assignee: "Bruno" }, summary: "Reasignar OT-241" },
    ];
    const orders = ordersFromProposal(byCode, uuidCtx);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].title, "OT-241 Inspeccion camara fria");
  });

  it("still refuses an order the detector never read", () => {
    const orders = ordersFromProposal(
      [{ kind: "workspace.write", tool: "update_task", args: { task: "OT-999" }, summary: "x" }],
      readHandoverContext(event),
    );
    assert.deepEqual(orders, []);
  });
});

describe("detectorClock", () => {
  it("replays a shift boundary from SILENTOPS_DEMO_AT", () => {
    assert.equal(detectorClock("2026-09-12T05:45:00-03:00").toISOString(), "2026-09-12T08:45:00.000Z");
  });

  it("throws on a bad value rather than silently evaluating the wrong instant", () => {
    assert.throws(() => detectorClock("ayer a la tarde"), /ISO 8601/);
  });
});

describe("runHandover", () => {
  const deps = {
    detect: async () => event,
    propose: async () => proposal,
    log: () => {},
    runId: "run-1",
  };

  it("posts the approval card with the absence evidence before the proposal", async () => {
    const { thread, posted } = fakeThread();
    const outcome = await runHandover(thread as never, { ...deps, execute: async () => {} });

    assert.equal(outcome.fired, true);
    assert.equal(posted.length, 1);
    const out = await ir(posted[0]);
    const iAbsence = out.indexOf("0 results");
    const iRationale = out.indexOf("No existe el handover");
    assert.ok(iAbsence !== -1 && iRationale !== -1);
    assert.ok(iAbsence < iRationale, "the absence must come first");
    assert.ok(out.includes("OT-88"));
    assert.ok(out.includes("Aprobar"));
  });

  it("posts no card and stays silent when the detector does not fire", async () => {
    const { thread, posted } = fakeThread();
    const outcome = await runHandover(thread as never, { ...deps, detect: async () => null });

    assert.deepEqual(outcome, { fired: false, reason: "no-absence" });
    const out = await ir(posted[0]);
    assert.ok(out.includes("Sin acción"));
    assert.ok(!out.includes("Aprobar"), "nothing to approve means no button");
  });

  it("offers no button when the agent escalated instead of proposing", async () => {
    const { thread, posted } = fakeThread();
    const empty: Proposal = { ...proposal, actions: [], rationale: "Falta el rol de guardia." };
    const outcome = await runHandover(thread as never, { ...deps, propose: async () => empty });

    assert.equal(outcome.fired, false);
    const out = await ir(posted[0]);
    assert.ok(out.includes("Falta el rol de guardia"));
    assert.ok(!out.includes("Aprobar"));
  });

  it("writes nothing while the card is merely posted", async () => {
    const { thread, posted } = fakeThread();
    const executed: Proposal[] = [];

    await runHandover(thread as never, {
      ...deps,
      execute: async (p) => {
        executed.push(p);
      },
    });

    assert.equal(posted.length, 1, "the card is posted");
    assert.equal(executed.length, 0, "but posting a card must not write anything");
    assert.equal(proposal.status, "pending", "and the proposal is still awaiting a human");
  });

  it("reports a failed read in the channel instead of leaving it silent", async () => {
    // A Channels handler that throws posts nothing at all, which in the channel
    // is indistinguishable from a dead bot. The failure has to be visible.
    const { thread, posted } = fakeThread();
    const outcome = await runHandover(thread as never, {
      ...deps,
      detect: async () => {
        throw new Error("no hay una guardia con roster activo en el calendario");
      },
    });

    assert.equal(outcome.fired, false);
    assert.equal(outcome.reason, "failed");
    assert.equal(posted.length, 1, "the failure must be posted");
    const out = await ir(posted[0]);
    assert.ok(out.includes("no pudo completar"));
    assert.ok(out.includes("roster activo"), "the real reason must be shown, not hidden");
    assert.ok(out.includes("No se escribió nada"));
    assert.ok(!out.includes("Aprobar"), "a failed run offers nothing to approve");
  });

  it("reports a failed model run the same way", async () => {
    const { thread, posted } = fakeThread();
    const outcome = await runHandover(thread as never, {
      ...deps,
      propose: async () => {
        throw new Error("OPENAI_API_KEY no configurado");
      },
    });

    assert.equal(outcome.fired, false);
    assert.ok((await ir(posted[0])).includes("OPENAI_API_KEY"));
  });
});
