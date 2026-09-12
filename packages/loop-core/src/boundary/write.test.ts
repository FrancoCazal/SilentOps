import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { executeApproved, approveAndExecute, rejectProposal, HighRiskError, registerWorkspaceExecutor, registerJobScheduler, NotApprovedError } from "./write";
import { registerOutbound } from "../channels/outbound";
import { memoryStore, setIdempotencyStore } from "./idempotency";
import * as proposals from "../approval/store";
import type { Proposal } from "../approval/types";
import type { Logger } from "../observability/log";

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
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      ALLOW_UNVERIFIED_WRITES: process.env.ALLOW_UNVERIFIED_WRITES,
      AUTH0_DOMAIN: process.env.AUTH0_DOMAIN,
      AUTH0_AUDIENCE: process.env.AUTH0_AUDIENCE,
    };
    writes = [];
    sends = [];
    proposals.reset();
    setIdempotencyStore(memoryStore());
    process.env.ALLOW_UNVERIFIED_WRITES = "1";
    delete process.env.AUTH0_DOMAIN;
    delete process.env.AUTH0_AUDIENCE;
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

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    proposals.reset();
    setIdempotencyStore(memoryStore());
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

  it("registra el bypass una vez por ejecucion y scope no verificado por accion", async () => {
    const entries: Parameters<Logger>[] = [];
    const log: Logger = (...entry) => { entries.push(entry); };
    await executeApproved(proposal(), { log });
    assert.deepEqual(entries.filter(([msg]) => msg.startsWith("AUTH0 BYPASS")), [[
      "AUTH0 BYPASS: scope no verificado (ALLOW_UNVERIFIED_WRITES=1, solo desarrollo)",
      { proposalId: "p1" },
    ]]);
    assert.deepEqual(entries.filter(([msg]) => msg === "scope verified"), [
      ["scope verified", { index: 0, kind: "workspace.write", scope: "write:workspace", verified: false }],
      ["scope verified", { index: 1, kind: "channel.send", scope: "send:channel", verified: false }],
    ]);
    await executeApproved(proposal(), { log });
    assert.equal(entries.filter(([msg]) => msg.startsWith("AUTH0 BYPASS")).length, 2);
  });

  it("con Auth0 configurado el flag de desarrollo no evita verificar el token", async () => {
    process.env.AUTH0_DOMAIN = "auth0.example.invalid";
    process.env.AUTH0_AUDIENCE = "urn:test:loop-core";
    const entries: Parameters<Logger>[] = [];
    await assert.rejects(() => executeApproved(proposal(), {
      log: (...entry) => { entries.push(entry); },
    }), /falta el token de servicio/);
    assert.equal(entries.length, 0);
    assert.equal(writes.length, 0);
    assert.equal(sends.length, 0);
  });

  it("aprueba una pending, registra la persona y ejecuta desde una sola entrada", async () => {
    proposals.save(proposal({ status: "pending" }));
    const results = await approveAndExecute("p1", "supervisor", { log: silent });
    assert.equal(proposals.get("p1")?.status, "approved");
    assert.equal(proposals.get("p1")?.approvedBy, "supervisor");
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => !r.skipped));
    assert.equal(writes.length, 1);
    assert.equal(sends.length, 1);
  });

  it("rechaza riesgo alto sin confirmacion explicita y conserva pending", async () => {
    proposals.save(proposal({ status: "pending", risk: "high" }));
    await assert.rejects(() => approveAndExecute("p1", "supervisor", { log: silent }), (error: unknown) => {
      assert.ok(error instanceof HighRiskError);
      assert.equal(error.status, 412);
      assert.match(error.message, /confirmaci[oó]n expl[ií]cita/);
      return true;
    });
    assert.equal(proposals.get("p1")?.status, "pending");
    assert.equal(proposals.get("p1")?.approvedBy, undefined);
    assert.equal(writes.length, 0);
    assert.equal(sends.length, 0);
  });

  it("ejecuta riesgo alto cuando la persona confirma explicitamente", async () => {
    proposals.save(proposal({ status: "pending", risk: "high" }));
    await approveAndExecute("p1", "supervisor", { log: silent, confirmHighRisk: true });
    assert.equal(writes.length, 1);
    assert.equal(sends.length, 1);
  });

  it("un segundo click sobre una approved reintenta sin duplicar", async () => {
    proposals.save(proposal({ status: "pending" }));
    await approveAndExecute("p1", "supervisor", { log: silent });
    const again = await approveAndExecute("p1", "supervisor", { log: silent });
    assert.ok(again.every((r) => r.skipped));
    assert.equal(writes.length, 1);
    assert.equal(sends.length, 1);
  });

  for (const status of ["expired", "rejected"] as const) {
    it(`no vuelve a aprobar una propuesta ${status}`, async () => {
      proposals.save(proposal({ status }));
      await assert.rejects(() => approveAndExecute("p1", "supervisor", { log: silent }), (error: unknown) => {
        assert.ok(error instanceof NotApprovedError);
        assert.equal(error.status, 409);
        assert.ok(error.message.includes(status));
        return true;
      });
      assert.equal(proposals.get("p1")?.status, status);
      assert.equal(writes.length, 0);
      assert.equal(sends.length, 0);
    });
  }

  it("conserva edited y ejecuta las acciones editadas al aprobar", async () => {
    proposals.save(proposal({
      status: "edited",
      editedActions: [{ kind: "workspace.write", tool: "fixture_tool", args: { edited: true }, summary: "editada" }],
    }));
    await approveAndExecute("p1", "supervisor", { log: silent });
    assert.equal(proposals.get("p1")?.status, "edited");
    assert.equal(proposals.get("p1")?.approvedBy, "supervisor");
    assert.deepEqual(writes, ['fixture_tool:{"edited":true}']);
    assert.equal(sends.length, 0);
  });

  it("rechazar registra el status y la persona sin ejecutar", () => {
    proposals.save(proposal({ status: "pending" }));
    const rejected = rejectProposal("p1", "supervisor");
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.approvedBy, "supervisor");
    assert.equal(proposals.get("p1"), rejected);
    assert.equal(writes.length, 0);
    assert.equal(sends.length, 0);
  });

  it("reporta una propuesta inexistente sin ejecutar", async () => {
    await assert.rejects(() => approveAndExecute("missing", "supervisor", { log: silent }), /missing.*no existe/);
    assert.throws(() => rejectProposal("missing", "supervisor"), /missing.*no existe/);
    assert.equal(writes.length, 0);
  });

  it("el reintento directo tras fallo parcial conserva aprobacion y no duplica lo ejecutado", async () => {
    const p = proposals.save(proposal({
      status: "pending",
      actions: [
        { kind: "workspace.write", tool: "fixture_tool", args: { step: 1 }, summary: "primera" },
        { kind: "workspace.write", tool: "fixture_tool", args: { step: 2 }, summary: "segunda" },
      ],
    }));
    let fail = true;
    registerWorkspaceExecutor(async (tool, args) => {
      if (args.step === 2 && fail) throw new Error("executor fallo");
      writes.push(`${tool}:${JSON.stringify(args)}`);
      return { step: args.step };
    });
    await assert.rejects(() => approveAndExecute("p1", "supervisor", { log: silent }), /executor fallo/);
    assert.equal(p.status, "approved");
    assert.equal(p.approvedBy, "supervisor");
    assert.equal(writes.length, 1);
    // Segundo click del mismo boton: reintenta lo que falto sin duplicar.
    fail = false;
    const retried = await approveAndExecute("p1", "supervisor", { log: silent });
    assert.deepEqual(retried.map((r) => r.skipped), [true, false]);
    assert.deepEqual(writes, ['fixture_tool:{"step":1}', 'fixture_tool:{"step":2}']);
  });
});
