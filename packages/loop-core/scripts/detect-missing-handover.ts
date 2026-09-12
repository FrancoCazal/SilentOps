/** Ejecuta el detector real sin llamar al modelo ni escribir en Ambiguous. */
import { createAmbiguousWorkspaceReader } from "../src/boundary/ambiguous-reader";
import { registerWorkspaceReader } from "../src/domain/workspace-reader";
import { detectMissingHandover } from "../src/jobs/missing-handover";

const at = process.env.SILENTOPS_DEMO_AT ? new Date(process.env.SILENTOPS_DEMO_AT) : new Date();
if (Number.isNaN(at.getTime())) throw new Error("SILENTOPS_DEMO_AT debe ser una fecha ISO 8601 valida");

registerWorkspaceReader(createAmbiguousWorkspaceReader());
const event = await detectMissingHandover({ now: at });

console.log(
  JSON.stringify(
    event
      ? {
          detected: true,
          id: event.id,
          expectedRecord: event.context?.absenceEvidence,
          messageCount: Array.isArray(event.context?.messagesSinceShiftStart)
            ? event.context.messagesSinceShiftStart.length
            : 0,
          openWorkOrderCount: Array.isArray(event.context?.openWorkOrders)
            ? event.context.openWorkOrders.length
            : 0,
        }
      : { detected: false, reason: "no falta un handover o el turno no esta cerrando" },
    null,
    2,
  ),
);
