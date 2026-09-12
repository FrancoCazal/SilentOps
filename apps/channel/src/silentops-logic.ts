/**
 * Partes PURAS del canal SilentOps (R2), separadas para poder testearlas sin
 * Slack ni red: que pide una mencion, que hora "es" en la demo, y si un evento
 * ya tiene propuesta viva.
 */
import type { Proposal } from "loop-core";

export type MentionCommand = "arm" | "detect" | "status";

/**
 * Una mencion hace UNA de tres cosas. Ninguna ejecuta nada.
 * - arm: vigilar este hilo. El detector programado publica aca (default).
 * - detect: correr el detector AHORA. Solo smoke test de desarrollo: en el video
 *   el disparo es el detector, no una persona (SILENTOPS.md).
 * - status: decir que hay armado y que propuestas hay.
 */
export function parseCommand(text: string | undefined): MentionCommand {
  const t = (text ?? "").toLowerCase();
  if (/\b(detect(ar|or)?|simul(a|ar)|probar detector|smoke)\b/.test(t)) return "detect";
  if (/\b(estado|status|que hay|qué hay)\b/.test(t)) return "status";
  return "arm";
}

/**
 * Reloj de la demo. SILENTOPS_DEMO_AT congela "ahora" (ej. 2026-09-12T05:45:00-03:00)
 * para que el detector encuentre el borde del turno en cualquier momento del dia.
 * Sin la variable, hora real.
 */
export function demoNow(env: NodeJS.ProcessEnv = process.env): Date {
  const raw = env.SILENTOPS_DEMO_AT;
  if (!raw) return new Date();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error(`SILENTOPS_DEMO_AT invalida: ${raw}`);
  return d;
}

/**
 * El detector puede correr N veces por el mismo turno (cada minuto, o dos
 * procesos). Un evento con propuesta viva no genera otra: la semilla es
 * InboundEvent.id, que el detector hace determinista por turno y dia.
 */
export function liveProposalFor(eventId: string, all: Proposal[]): Proposal | undefined {
  return all.find(
    (p) => p.sourceEventId === eventId && (p.status === "pending" || p.status === "edited" || p.status === "approved"),
  );
}

/** El texto de la evidencia, tal cual lo pide SILENTOPS.md: la ausencia como frase, no como vacio. */
export function absenceSentence(evt: { context?: Record<string, unknown> }): string | undefined {
  const ev = evt.context?.absenceEvidence as
    | { expectedRecord?: string; searchedIn?: string; searchedAt?: string; matches?: unknown[] }
    | undefined;
  if (!ev?.expectedRecord) return undefined;
  const n = Array.isArray(ev.matches) ? ev.matches.length : 0;
  return `searched ${ev.searchedIn ?? "Documents"} for "${ev.expectedRecord}" at ${ev.searchedAt ?? "?"} -> ${n} results`;
}
