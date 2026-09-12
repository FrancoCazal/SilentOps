import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleEvent } from "./index";
import { renderEvent } from "./render";
import { scriptedModel } from "../../evals/scripted-model";
import type { InboundEvent } from "../channels/inbound";

const evt: InboundEvent = {
  id: "evt_1",
  channel: "whatsapp",
  from: { externalId: "+595981000000", displayName: "Juan" },
  receivedAt: "2026-09-12T22:40:00.000Z",
  text: "necesito presupuesto",
  context: { hora_local: "22:40", ubicacion: "obra sur" },
};

describe("renderEvent", () => {
  it("pone el contexto del canal en el prompt, que es la tesis del proyecto", () => {
    const rendered = renderEvent(evt);
    assert.match(rendered, /WhatsApp/);
    assert.match(rendered, /Juan/);
    assert.match(rendered, /ubicacion: obra sur/);
    assert.match(rendered, /CONTEXTO DEL CANAL/);
  });
});

describe("handleEvent", () => {
  it("convierte tool calls de propose_action en una Proposal pendiente", async () => {
    const proposal = await handleEvent(evt, {
      runId: "test",
      log: () => {},
      model: scriptedModel([
        {
          toolCalls: [
            {
              name: "propose_action",
              args: {
                kind: "workspace.write",
                summary: "registrar el pedido",
                payload: { tool: "create_task", args: { title: "Presupuesto Juan" } },
                risk: "medium",
                rationale: "llego fuera de horario",
              },
            },
          ],
        },
        { text: "Propuse registrar el pedido." },
      ]),
    });

    assert.equal(proposal.status, "pending");
    assert.equal(proposal.sourceEventId, "evt_1");
    assert.equal(proposal.actions.length, 1);
    assert.equal(proposal.risk, "medium");
    assert.ok(new Date(proposal.expiresAt) > new Date(proposal.createdAt));
  });

  it("no inventa acciones cuando el agente decide escalar", async () => {
    const proposal = await handleEvent(evt, {
      runId: "test",
      log: () => {},
      model: scriptedModel([{ text: "No tengo contexto suficiente, escalo." }]),
    });
    assert.deepEqual(proposal.actions, []);
  });

  it("descarta una propuesta con payload incompleto en vez de ejecutarla a medias", async () => {
    const proposal = await handleEvent(evt, {
      runId: "test",
      log: () => {},
      model: scriptedModel([
        {
          toolCalls: [
            {
              name: "propose_action",
              args: { kind: "workspace.write", summary: "sin tool", payload: {}, risk: "low", rationale: "x" },
            },
          ],
        },
        { text: "listo" },
      ]),
    });
    assert.deepEqual(proposal.actions, []);
  });
});

describe("payload aplanado (lo que hace un LLM real)", () => {
  /**
   * Verificado con Gemini contra el workspace real: el modelo manda
   * `{ assignee, order_id }` en vez de `{ tool, args: { id, assignee } }`.
   * Antes las cuatro acciones se descartaban en silencio y la propuesta salia
   * vacia — o sea, el producto no funcionaba con un modelo de verdad.
   */
  async function proposalFrom(payload: Record<string, unknown>) {
    return handleEvent(evt, {
      runId: "test",
      log: () => {},
      model: scriptedModel([
        {
          toolCalls: [
            {
              name: "propose_action",
              args: {
                kind: "workspace.write",
                summary: "accion",
                payload,
                risk: "medium",
                rationale: "porque",
              },
            },
          ],
        },
        { text: "listo" },
      ]),
    });
  }

  function argsOf(action: unknown): Record<string, unknown> {
    return (action as { args: Record<string, unknown> }).args;
  }

  it("clasifica una reasignacion aplanada, incluido order_id", async () => {
    const p = await proposalFrom({ order_id: "OT-241", assignee: "Bruno" });
    assert.equal(p.actions.length, 1);
    assert.equal(p.actions[0]!.kind, "workspace.write");
    assert.equal(argsOf(p.actions[0]).id, "OT-241");
    assert.equal(argsOf(p.actions[0]).assignee, "Bruno");
  });

  it("clasifica un handover aplanado con document_name y bullets", async () => {
    const p = await proposalFrom({
      document_name: "Handover Noche 2026-09-12",
      bullets: [{ text: "OT-241 abierta", source: "m1" }],
    });
    assert.equal(p.actions.length, 1);
    assert.equal(argsOf(p.actions[0]).title, "Handover Noche 2026-09-12");
  });

  it("clasifica una anotacion aplanada", async () => {
    const p = await proposalFrom({ id: "OT-243", note: "queda para mantenimiento" });
    assert.equal(p.actions.length, 1);
    assert.equal(argsOf(p.actions[0]).note, "queda para mantenimiento");
  });

  it("respeta un tool declarado y no lo reinterpreta", async () => {
    const p = await proposalFrom({
      tool: "silentops.create-handover",
      args: { title: "T", bullets: [] },
    });
    assert.equal(p.actions.length, 1);
    assert.equal(argsOf(p.actions[0]).title, "T");
  });

  it("sigue descartando un payload que no clasifica como ninguna intencion", async () => {
    const p = await proposalFrom({ algo: "irrelevante" });
    assert.equal(p.actions.length, 0, "no se adivina una accion de la nada");
  });
});
