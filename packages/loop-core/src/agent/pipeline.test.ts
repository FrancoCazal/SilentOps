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
