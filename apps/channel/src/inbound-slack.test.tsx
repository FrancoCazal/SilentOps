import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ChannelMessage, ThreadMessage } from "@copilotkit/channels";
import { toInboundEvent, stableId, findProposalId } from "./inbound-slack";

const NOW = () => new Date("2026-09-12T05:45:00.000Z");

function msg(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    text: "@silentops que quedo abierto del turno noche?",
    user: { id: "u_bruno", name: "Bruno" },
    actor: { id: "U0BRUNO", kind: "human", name: "Bruno", handle: "bruno" },
    ref: { id: "1757655900.000100" },
    platform: "slack",
    operation: {
      kind: "created",
      logicalMessageId: "1757655900.000100",
      revisionId: "1757655900.000100",
      mentioned: true,
    },
    ...overrides,
  } as ChannelMessage;
}

const history: ThreadMessage[] = [
  { user: { id: "U0ANA", kind: "human", name: "Ana" }, text: "04:20 burlete del muelle 3 vencido, abri OT-243", ts: "1" },
  { user: { id: "B0BOT", kind: "bot", name: "SilentOps" }, isBot: true, text: "Propuesta de handover proposal:3f2a1c9e-1b2d-4c3e-9f8a-7b6c5d4e3f21 · aprobar o responder para editar", ts: "2" },
];

describe("toInboundEvent (Slack -> contrato congelado)", () => {
  it("produce un InboundEvent valido sin exponer el payload crudo", () => {
    const evt = toInboundEvent(msg(), { history, conversationKey: "slack:T1:C1:1757655900", now: NOW });
    assert.ok(evt);
    assert.equal(evt.channel, "slack");
    assert.equal(evt.id, "slack:1757655900.000100");
    assert.deepEqual(evt.from, { externalId: "U0BRUNO", displayName: "Bruno" });
    assert.equal(evt.receivedAt, "2026-09-12T05:45:00.000Z");
    assert.equal(evt.text, "@silentops que quedo abierto del turno noche?");
    assert.equal(evt.attachments, undefined);
    // Nada del objeto de Slack se filtra tal cual.
    assert.equal("ref" in evt, false);
    assert.equal("actor" in evt, false);
  });

  it("el contexto trae lo que el canal sabe: participantes, historial, hilo", () => {
    const evt = toInboundEvent(msg(), { history, conversationKey: "k1", now: NOW });
    const ctx = evt!.context!;
    assert.equal(ctx.platform, "slack");
    assert.equal(ctx.mentioned, true);
    assert.equal(ctx.conversationKey, "k1");
    assert.deepEqual(ctx.participants, ["Bruno", "Ana"]);
    assert.equal(ctx.threadMessageCount, 2);
    const th = ctx.threadHistory as Array<{ from: string; isBot: boolean }>;
    assert.equal(th[0]!.from, "Ana");
    assert.equal(th[1]!.isBot, true);
  });

  it("una respuesta humana en el hilo de una card marca editsProposal", () => {
    const evt = toInboundEvent(msg({ text: "cambia el responsable de OT-243 a Bruno" }), { history, now: NOW });
    assert.equal(evt!.context!.editsProposal, "3f2a1c9e-1b2d-4c3e-9f8a-7b6c5d4e3f21");
  });

  it("sin card en el hilo no hay editsProposal", () => {
    const evt = toInboundEvent(msg(), { history: [history[0]!], now: NOW });
    assert.equal("editsProposal" in evt!.context!, false);
  });

  it("ignora mensajes de bots, apps y eliminaciones", () => {
    assert.equal(toInboundEvent(msg({ actor: { id: "B1", kind: "bot" } })), undefined);
    assert.equal(toInboundEvent(msg({ actor: { id: "A1", kind: "app" } })), undefined);
    assert.equal(
      toInboundEvent(msg({ operation: { kind: "deleted", logicalMessageId: "x", revisionId: "y", mentioned: false } })),
      undefined,
    );
  });

  it("stableId prefiere eventId, luego id logico, luego ref", () => {
    assert.equal(stableId(msg({ eventId: "Ev123" })), "slack:Ev123");
    assert.equal(stableId(msg()), "slack:1757655900.000100");
    assert.equal(
      stableId(msg({ operation: { kind: "updated", logicalMessageId: "L1", revisionId: "R2", mentioned: true } })),
      "slack:L1:R2",
    );
    assert.equal(stableId(msg({ operation: undefined })), "slack:1757655900.000100");
  });

  it("el mismo mensaje reenviado produce el mismo id (semilla de idempotencia)", () => {
    const a = toInboundEvent(msg(), { now: NOW })!;
    const b = toInboundEvent(msg(), { now: () => new Date("2026-09-12T05:46:00.000Z") })!;
    assert.equal(a.id, b.id);
  });

  it("findProposalId toma el marcador mas reciente y solo de mensajes del bot", () => {
    const h: ThreadMessage[] = [
      { user: { id: "U1", kind: "human" }, text: "proposal:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa (lo pego un humano)" },
      { isBot: true, text: "proposal:BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB" },
      { isBot: true, text: "proposal:cccccccc-cccc-cccc-cccc-cccccccccccc" },
    ];
    assert.equal(findProposalId(h), "cccccccc-cccc-cccc-cccc-cccccccccccc");
    assert.equal(findProposalId([h[0]!]), undefined);
  });

  it("mapea adjuntos con url y mime, y descarta el resto", () => {
    const evt = toInboundEvent(
      msg({
        contentParts: [
          { type: "image", url: "https://files/x.png", mimeType: "image/png" },
          { type: "file", source: { type: "url", value: "https://files/a.pdf", mimeType: "application/pdf" } },
          { type: "text", text: "hola" },
        ] as unknown as ChannelMessage["contentParts"],
      }),
      { now: NOW },
    )!;
    assert.deepEqual(evt.attachments, [
      { kind: "image", url: "https://files/x.png", mime: "image/png" },
      { kind: "document", url: "https://files/a.pdf", mime: "application/pdf" },
    ]);
  });
});
