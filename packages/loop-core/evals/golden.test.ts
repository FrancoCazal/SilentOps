/**
 * Invariante 4: todo cambio al agente corre contra el golden set antes de commit.
 *
 *   npm run verify                      # con EVAL_MOCK=1 por defecto: sin red
 *   EVAL_MOCK=0 npm run eval -w loop-core   # contra el modelo real
 *   node --import tsx --test --test-name-pattern g01 evals/golden.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleEvent } from "../src/agent/index";
import type { InboundEvent } from "../src/channels/inbound";
import golden from "./golden.json" with { type: "json" };
import { scriptedModel, type ScriptedTurn } from "./scripted-model";

type Caso = {
  id: string;
  titulo: string;
  event: Partial<InboundEvent> & { channel: InboundEvent["channel"] };
  expect: {
    actionKinds: string[];
    mustMention: string[];
    mustNotMention: string[];
    risk: "low" | "medium" | "high";
  };
  mock?: ScriptedTurn[];
};

const casos = golden.casos as unknown as Caso[];
const MOCK = process.env.EVAL_MOCK !== "0";

describe(`golden set (${MOCK ? "mock" : "modelo real"})`, () => {
  for (const caso of casos) {
    it(`${caso.id} — ${caso.titulo}`, async () => {
      if (MOCK && !caso.mock) {
        // Un caso sin guion no puede correr sin red: se salta, no se miente.
        return;
      }

      const evt: InboundEvent = {
        id: `eval-${caso.id}`,
        from: { externalId: "eval", displayName: "Caso de prueba" },
        receivedAt: new Date().toISOString(),
        ...caso.event,
      };

      const proposal = await handleEvent(evt, {
        runId: `eval-${caso.id}`,
        model: MOCK ? scriptedModel(caso.mock!) : undefined,
        log: () => {},
      });

      assert.deepEqual(
        proposal.actions.map((a) => a.kind),
        caso.expect.actionKinds,
        `${caso.id}: kinds de accion`,
      );

      const serialized = JSON.stringify(proposal).toLowerCase();
      for (const needle of caso.expect.mustMention) {
        assert.ok(serialized.includes(needle.toLowerCase()), `${caso.id}: falta "${needle}"`);
      }
      for (const needle of caso.expect.mustNotMention) {
        assert.ok(!serialized.includes(needle.toLowerCase()), `${caso.id}: aparece "${needle}"`);
      }
      assert.equal(proposal.risk, caso.expect.risk, `${caso.id}: riesgo`);
    });
  }
});
