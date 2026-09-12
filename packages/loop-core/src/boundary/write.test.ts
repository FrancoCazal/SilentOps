import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { executeApproved, registerWorkspaceExecutor, registerJobScheduler, NotApprovedError } from "./write";
import { registerOutbound } from "../channels/outbound";
import { memoryStore, setIdempotencyStore } from "./idempotency";
import type { Proposal } from "../approval/types";

const silent = () => {};

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  const now = new Date();
  return {
    id: "p1",
    runId: "r1",
    sourceEventId: "evt1",
    actions: [
      { kind: "workspace.write", tool: "create_task", args: { title: "x" }, summary: "crear task" },
      { kind: "channel.send", channel: "whatsapp", to: "+595", body: "hola", summary: "avisar" },
    ],
    rationale: "porque si",
    risk: "medium",
    status: "approved",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 600_000).toISOString(),
    ...overrides,
  };
}

describe("write boundary", () => {
  let writes: string[] = [];
  let sends: string[] = [];

  beforeEach(() => {
    writes = [];
    sends = [];
    setIdempotencyStore(memoryStore());
    process.env.ALLOW_UNVERIFIED_WRITES = "1";
    delete process.env.AUTH0_DOMAIN;
    registerWorkspaceExecutor(async (tool, args) => {
      writes.push(`${tool}:${JSON.stringify(args)}`);
      return { ok: true, tool };
    });
    registerJobScheduler(async (job) => ({ scheduled: job }));
    registerOutbound({
      name: "whatsapp",
      async send(to, body) {
        sends.push(`${to}:${body}`);
        return { externalId: `wa_${sends.length}` };
      },
    });
  });

  it("ejecuta cada accion una sola vez y no duplica al reintentar", async () => {
    const p = proposal();
    const first = await executeApproved(p, { log: silent });
    assert.equal(first.length, 2);
    assert.ok(first.every((r) => r.skipped === false));
    assert.equal(writes.length, 1);
    assert.equal(sends.length, 1);

    // Mismo evento reenviado por el webhook: misma key, cero escrituras nuevas.
    const second = await executeApproved(p, { log: silent });
    assert.ok(second.every((r) => r.skipped === true));
    assert.equal(writes.length, 1);
    assert.equal(sends.length, 1);
  });

  it("rechaza una propuesta que no fue aprobada", async () => {
    await assert.rejects(
      () => executeApproved(proposal({ status: "pending" }), { log: silent }),
      NotApprovedError,
    );
    assert.equal(writes.length, 0);
  });

  it("prefiere las acciones editadas en el thread sobre las originales", async () => {
    const p = proposal({
      status: "edited",
      editedActions: [
        { kind: "workspace.write", tool: "create_task", args: { title: "editado" }, summary: "editada" },
      ],
    });
    await executeApproved(p, { log: silent });
    assert.equal(writes.length, 1);
    assert.match(writes[0]!, /editado/);
  });

  it("sin Auth0 configurado y sin bypass explicito, no escribe nada", async () => {
    delete process.env.ALLOW_UNVERIFIED_WRITES;
    await assert.rejects(() => executeApproved(proposal(), { log: silent }), /Auth0 no configurado/);
    assert.equal(writes.length, 0);
  });
});
