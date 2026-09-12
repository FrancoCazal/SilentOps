/**
 * El detector es determinista, asi que se puede testear entero sin modelo, sin
 * red y sin credenciales.
 *
 * Los dos tests que importan mas no son los del camino feliz:
 *  - "no dispara cuando el handover ya existe": un agente que avisa de algo ya
 *    resuelto es un agente que molesta, y uno que molesta se apaga el primer dia.
 *  - "sin lector registrado tira en vez de devolver vacio": un vacio falso le
 *    haria creer al detector que el handover no existe e inventaria una ausencia.
 *    La ausencia es la evidencia central del producto.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { InboundEvent } from "../channels/inbound";
import { TOOLS } from "../domain/tools";
import {
  fixtureReader,
  readTool,
  registerWorkspaceReader,
  resetWorkspaceReader,
} from "../domain/workspace-reader";
import { detectMissingHandover, localDateKey, minutesUntil } from "./missing-handover";

const SHIFT = {
  name: "Noche",
  start: "22:00",
  end: "06:00",
  outgoing: ["Ana"],
  incoming: ["Bruno"],
};

/** 05:45 hora local del 12-09-2026: quince minutos antes de que cierre el turno. */
const NOW = new Date(2026, 8, 12, 5, 45);

type Call = { tool: string; args: Record<string, unknown> };

/** Lector que registra que se leyo, para poder afirmar que NO se leyo de mas. */
function recordingReader(over: Record<string, unknown> = {}): Call[] {
  const fixtures: Record<string, unknown> = {
    [TOOLS.currentShift]: { shift: SHIFT },
    [TOOLS.searchDocuments]: [],
    [TOOLS.channelHistory]: [{ id: "m1", at: "01:20", text: "camara 3 con la puerta trabada" }],
    [TOOLS.openWorkOrders]: [{ id: "OT-88", assignee: "Ana", title: "Inspeccion camara 3" }],
    ...over,
  };
  const calls: Call[] = [];
  registerWorkspaceReader(async (tool, args = {}) => {
    calls.push({ tool, args });
    if (!(tool in fixtures)) throw new Error(`fixture faltante: ${tool}`);
    return fixtures[tool];
  });
  return calls;
}

type AbsenceEvidence = {
  expectedRecord: string;
  searchedIn: string;
  searchedAt: string;
  matches: unknown[];
};

function evidenceOf(evt: InboundEvent): AbsenceEvidence {
  const context = (evt.context ?? {}) as Record<string, unknown>;
  return context.absenceEvidence as AbsenceEvidence;
}

describe("detector missing-handover", () => {
  beforeEach(() => resetWorkspaceReader());

  it("dispara cuando el turno cierra y el handover no existe", async () => {
    recordingReader();

    const evt = await detectMissingHandover({ now: NOW });

    assert.ok(evt, "tendria que haber emitido un evento");
    assert.equal(evt.channel, "cron", "el disparador es el detector, no una persona");
    assert.equal(evt.from.externalId, "silentops-detector");
  });

  it("emite la evidencia de la ausencia, no un booleano opaco", async () => {
    recordingReader();

    const evt = await detectMissingHandover({ now: NOW });
    const evidence = evidenceOf(evt!);

    assert.equal(evidence.expectedRecord, "Handover Noche 2026-09-12");
    assert.equal(evidence.searchedIn, "Documents");
    assert.equal(evidence.searchedAt, "05:45");
    assert.deepEqual(evidence.matches, [], "el resultado vacio ES la evidencia");
  });

  it("trae el historial del canal y las ordenes abiertas como fuentes citables", async () => {
    recordingReader();

    const evt = await detectMissingHandover({ now: NOW });
    const context = (evt!.context ?? {}) as Record<string, unknown>;

    assert.deepEqual(context.messagesSinceShiftStart, [
      { id: "m1", at: "01:20", text: "camara 3 con la puerta trabada" },
    ]);
    assert.equal((context.openWorkOrders as unknown[]).length, 1);
  });

  it("NO dispara cuando el handover ya existe, y no lee de mas", async () => {
    const calls = recordingReader({
      [TOOLS.searchDocuments]: [{ id: "DOC-90", title: "Handover Noche 2026-09-12" }],
    });

    const evt = await detectMissingHandover({ now: NOW });

    assert.equal(evt, null, "el handover existe: no hay ausencia y no hay evento");
    assert.deepEqual(
      calls.map((c) => c.tool),
      [TOOLS.currentShift, TOOLS.searchDocuments],
      "corta antes de leer el canal: no hay nada que preparar",
    );
  });

  it("NO dispara si el turno todavia no cierra", async () => {
    const calls = recordingReader();

    const evt = await detectMissingHandover({ now: new Date(2026, 8, 12, 2, 0) });

    assert.equal(evt, null);
    assert.deepEqual(calls.map((c) => c.tool), [TOOLS.currentShift]);
  });

  it("NO dispara si no hay turno vigente", async () => {
    recordingReader({ [TOOLS.currentShift]: null });

    assert.equal(await detectMissingHandover({ now: NOW }), null);
  });

  it("el id es idempotente por turno y dia: dos corridas no dan dos handovers", async () => {
    recordingReader();

    const a = await detectMissingHandover({ now: NOW });
    const b = await detectMissingHandover({ now: new Date(2026, 8, 12, 5, 50) });

    assert.equal(a!.id, "missing-handover:Noche:2026-09-12");
    assert.equal(a!.id, b!.id, "la semilla de idempotencia tiene que ser estable");
  });

  it("respeta la ventana de leadMinutes", async () => {
    recordingReader();

    const fuera = await detectMissingHandover({ now: new Date(2026, 8, 12, 5, 30) });
    assert.equal(fuera, null, "30 minutos antes esta fuera de la ventana de 15");

    const dentro = await detectMissingHandover({
      now: new Date(2026, 8, 12, 5, 30),
      leadMinutes: 45,
    });
    assert.ok(dentro, "con la ventana ampliada, si dispara");
  });
});

describe("workspace reader", () => {
  beforeEach(() => resetWorkspaceReader());

  it("sin lector registrado TIRA en vez de devolver vacio", async () => {
    await assert.rejects(
      () => readTool(TOOLS.searchDocuments, { query: "x" }),
      /no hay WorkspaceReader registrado/,
      "un vacio silencioso inventaria una ausencia que no existe",
    );
  });

  it("el detector propaga ese error en vez de emitir una ausencia falsa", async () => {
    await assert.rejects(() => detectMissingHandover({ now: NOW }));
  });

  it("fixtureReader tira si falta un fixture, por la misma razon", async () => {
    registerWorkspaceReader(fixtureReader({ [TOOLS.currentShift]: { shift: SHIFT } }));

    await assert.rejects(
      () => readTool(TOOLS.searchDocuments, { query: "x" }),
      /fixture faltante/,
    );
  });
});

describe("aritmetica de turnos", () => {
  it("minutesUntil tolera un turno que cruza medianoche", () => {
    assert.equal(minutesUntil(new Date(2026, 8, 12, 5, 45), "06:00"), 15);
    assert.equal(minutesUntil(new Date(2026, 8, 11, 23, 50), "06:00"), 370);
    assert.equal(minutesUntil(new Date(2026, 8, 12, 6, 10), "06:00"), -10, "ya paso");
  });

  it("minutesUntil devuelve NaN con una hora invalida en vez de un numero inventado", () => {
    assert.ok(Number.isNaN(minutesUntil(NOW, "no-es-una-hora")));
  });

  it("localDateKey usa la fecha local: el turno es un hecho local, no UTC", () => {
    assert.equal(localDateKey(new Date(2026, 8, 12, 5, 45)), "2026-09-12");
    assert.equal(localDateKey(new Date(2026, 0, 1, 0, 5)), "2026-01-01");
  });
});
