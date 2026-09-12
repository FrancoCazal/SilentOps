/**
 * La UNICA tool de escritura que ve el agente, y ni siquiera escribe: encola.
 * Va como tool de AG-UI (frontend tool), asi que el agente no puede ejecutarla
 * por su cuenta ni aunque quiera; la resuelve el caller. La invariante 1 queda
 * garantizada por la forma del sistema, no por el prompt.
 */
import type { AgentTool } from "../domain/tools";

export const PROPOSE_ACTION: AgentTool = {
  name: "propose_action",
  description:
    "Propone UNA accion para que una persona la apruebe en Slack. Nunca ejecuta nada. " +
    "Llamala una vez por cada accion concreta que haria falta.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "summary", "payload", "risk", "rationale"],
    properties: {
      kind: {
        type: "string",
        enum: ["workspace.write", "channel.send", "job.schedule"],
        description:
          "workspace.write: crear o cambiar algo en el workspace. channel.send: mandar un mensaje. job.schedule: programar un seguimiento.",
      },
      summary: {
        type: "string",
        description: "Una linea en castellano. Es lo que lee la persona en la card.",
      },
      payload: {
        type: "object",
        additionalProperties: true,
        description:
          "workspace.write: { tool, args } con el nombre EXACTO de la tool del workspace. " +
          "channel.send: { channel, to, body }. job.schedule: { job, runAt, payload }.",
      },
      risk: { type: "string", enum: ["low", "medium", "high"] },
      rationale: { type: "string", description: "Por que, en una frase." },
    },
  },
};
