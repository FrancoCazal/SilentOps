import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Proposal } from "loop-core";
import { parseCommand, demoNow, liveProposalFor, absenceSentence } from "./silentops-logic";

function p(overrides: Partial<Proposal>): Proposal {
  return {
    id: "x", runId: "r", sourceEventId: "e", actions: [], rationale: "", risk: "low",
    status: "pending", createdAt: "", expiresAt: "", ...overrides,
  };
}

describe("silentops-logic", () => {
  it("parseCommand: detectar es smoke test, estado es consulta, el resto arma", () => {
    assert.equal(parseCommand("@silentops detectar ahora"), "detect");
    assert.equal(parseCommand("probá el detector"), "detect");
    assert.equal(parseCommand("@silentops estado?"), "status");
    assert.equal(parseCommand("@silentops vigilá esta guardia"), "arm");
    assert.equal(parseCommand(undefined), "arm");
  });

  it("demoNow: congela el reloj con SILENTOPS_DEMO_AT y falla si es invalida", () => {
    assert.equal(demoNow({ SILENTOPS_DEMO_AT: "2026-09-12T05:45:00-03:00" }).toISOString(), "2026-09-12T08:45:00.000Z");
    assert.ok(Math.abs(demoNow({}).getTime() - Date.now()) < 5_000);
    assert.throws(() => demoNow({ SILENTOPS_DEMO_AT: "ayer" }), /invalida/);
  });

  it("liveProposalFor: pending/edited/approved bloquean; rejected/expired no", () => {
    const all = [
      p({ id: "1", sourceEventId: "e1", status: "rejected" }),
      p({ id: "2", sourceEventId: "e1", status: "expired" }),
      p({ id: "3", sourceEventId: "e2", status: "pending" }),
      p({ id: "4", sourceEventId: "e3", status: "approved" }),
    ];
    assert.equal(liveProposalFor("e1", all), undefined);
    assert.equal(liveProposalFor("e2", all)?.id, "3");
    assert.equal(liveProposalFor("e3", all)?.id, "4");
    assert.equal(liveProposalFor("e9", all), undefined);
  });

  it("absenceSentence: la ausencia se rinde como frase verbatim", () => {
    const s = absenceSentence({
      context: { absenceEvidence: { expectedRecord: "Handover Noche 2026-09-12", searchedIn: "Documents", searchedAt: "05:45", matches: [] } },
    });
    assert.equal(s, 'searched Documents for "Handover Noche 2026-09-12" at 05:45 -> 0 results');
    assert.equal(absenceSentence({ context: {} }), undefined);
  });
});
