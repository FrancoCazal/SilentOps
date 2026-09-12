/**
 * Ensayo completo del loop SIN Slack y SIN escribir nada.
 *
 * detector real (Ambiguous, solo lectura) -> modelo real -> Proposal.
 * Se corta justo antes del boundary: no llama a executeApproved, asi que no
 * crea documentos ni toca ordenes de trabajo.
 *
 * Para que sirve: es la unica forma de saber si los prompts funcionan con un LLM
 * de verdad antes de tener el canal de Slack, y de ver los NOMBRES DE CAMPO
 * reales que devuelve el workspace — que es de donde la card saca las fuentes.
 *
 *   npm run silentops:dry-run -w loop-core
 */
import { createAmbiguousWorkspaceReader } from "../src/boundary/ambiguous-reader";
import { registerWorkspaceReader } from "../src/domain/workspace-reader";
import { detectMissingHandover } from "../src/jobs/missing-handover";
import { handleEvent } from "../src/agent";
import { effectiveActions } from "../src/approval/types";
import { loggerFor } from "../src/observability/log";

const at = process.env.SILENTOPS_DEMO_AT ? new Date(process.env.SILENTOPS_DEMO_AT) : new Date();
if (Number.isNaN(at.getTime())) {
  throw new Error("SILENTOPS_DEMO_AT debe ser una fecha ISO 8601 valida");
}

registerWorkspaceReader(createAmbiguousWorkspaceReader());

const event = await detectMissingHandover({ now: at });
if (!event) {
  console.log("El detector no disparo: no falta un handover o el turno no cierra todavia.");
  process.exit(0);
}

const context = event.context as Record<string, unknown>;
const messages = (context.messagesSinceShiftStart ?? []) as Record<string, unknown>[];
const orders = (context.openWorkOrders ?? []) as Record<string, unknown>[];

// Los nombres de campo reales. La card resuelve las fuentes contra estos, asi
// que si no coinciden con lo que espera, cada bullet sale "sin fuente".
console.log("\n=== FORMA REAL DE LOS DATOS (lo que la card tiene que leer) ===");
console.log("campos de un mensaje :", messages[0] ? Object.keys(messages[0]).join(", ") : "(sin mensajes)");
console.log("campos de una orden  :", orders[0] ? Object.keys(orders[0]).join(", ") : "(sin ordenes)");
console.log("evidencia de ausencia:", JSON.stringify(context.absenceEvidence));

console.log("\n=== CORRIENDO EL MODELO (esto si gasta cuota) ===");
const started = Date.now();
const proposal = await handleEvent(event, { log: loggerFor("dry-run") });
const seconds = ((Date.now() - started) / 1000).toFixed(1);

const actions = effectiveActions(proposal);
console.log(`\n=== PROPUESTA (${seconds}s, riesgo ${proposal.risk}, ${actions.length} accion(es)) ===`);
console.log("rationale:", proposal.rationale);
for (const [i, action] of actions.entries()) {
  console.log(`\n[${i}] ${action.kind} — ${action.summary}`);
  console.log(JSON.stringify(action, null, 2));
}

console.log("\n=== NADA SE ESCRIBIO ===");
console.log("Este script se corta antes del boundary. Para escribir hace falta");
console.log("una aprobacion humana en la card de Slack.");
