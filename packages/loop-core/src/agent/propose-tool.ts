/**
 * La UNICA tool de escritura que ve el agente, y ni siquiera escribe: encola.
 * Va como tool de AG-UI (frontend tool), asi que el agente no puede ejecutarla
 * por su cuenta ni aunque quiera; la resuelve el caller. La invariante 1 queda
 * garantizada por la forma del sistema, no por el prompt.
 */
import type { AgentTool } from "../domain/tools";

/**
 * Las intenciones de escritura del dominio. El modelo propone INTENCIONES, no
 * tools del proveedor: nunca conoce ni puede nombrar una tool MCP de escritura.
 * El boundary (boundary/ambiguous-writer.ts) es el unico que traduce.
 *
 * Sin esta lista el modelo no puede cumplir el contrato: `payload.tool` pedia
 * "el nombre EXACTO de la tool del workspace", un dato que por diseño no tiene.
 * Verificado con Gemini: proponia `{document_name, content}` y las tres acciones
 * se descartaban, dejando la propuesta vacia.
 */
export const WRITE_INTENTS = {
  createHandover: "silentops.create-handover",
  reassignWorkOrder: "silentops.reassign-work-order",
  annotateWorkOrder: "silentops.annotate-work-order",
} as const;

const INTENT_CONTRACT = [
  `- "${WRITE_INTENTS.createHandover}": args { title, bullets: [{ text, source }] }.`,
  `  title es el nombre del documento. Maximo CINCO bullets y cada uno lleva`,
  `  source con el id del mensaje o de la orden de la que sale. Un bullet sin`,
  `  source se descarta en el boundary: no entra al handover.`,
  `- "${WRITE_INTENTS.reassignWorkOrder}": args { id, assignee, note? }.`,
  `  id es el id de la orden abierta tal como vino en el contexto. assignee es`,
  `  el nombre de alguien que ESTA de guardia segun el roster.`,
  `- "${WRITE_INTENTS.annotateWorkOrder}": args { id, note }.`,
].join("\n");

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
          "Para workspace.write usa { tool, args }: tool es una de las intenciones de abajo " +
          `y args lleva sus campos.\n${INTENT_CONTRACT}\n` +
          'Para channel.send: { channel: "slack", to, body }. ' +
          "Para job.schedule: { job, runAt, payload }.",
        properties: {
          tool: {
            type: "string",
            enum: [
              WRITE_INTENTS.createHandover,
              WRITE_INTENTS.reassignWorkOrder,
              WRITE_INTENTS.annotateWorkOrder,
            ],
            description:
              "SOLO para workspace.write. Una de estas tres intenciones del dominio. " +
              "No es un nombre de tool del proveedor y no hay otras opciones.",
          },
          args: {
            type: "object",
            additionalProperties: true,
            description:
              "Los campos de la intencion elegida. NO pongas estos campos sueltos en payload: " +
              "van adentro de args.",
          },
          channel: { type: "string", description: 'SOLO para channel.send. Usa "slack".' },
          to: { type: "string", description: "SOLO para channel.send. El canal destino." },
          body: { type: "string", description: "SOLO para channel.send. El texto del mensaje." },
          job: { type: "string", description: "SOLO para job.schedule." },
          runAt: { type: "string", description: "SOLO para job.schedule. ISO 8601." },
        },
      },
      risk: { type: "string", enum: ["low", "medium", "high"] },
      rationale: { type: "string", description: "Por que, en una frase." },
    },
  },
};
