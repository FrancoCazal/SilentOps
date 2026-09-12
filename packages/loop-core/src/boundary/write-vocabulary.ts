/**
 * El vocabulario de ESCRITURA que el modelo tiene que usar en propose_action.
 *
 * Por que existe: el prompt de dominio dice "nunca inventes nombres de tools"
 * pero no le da al modelo ningun nombre de escritura, asi que inventa uno o
 * manda el payload sin `tool`, y buildProposal descarta la accion en silencio
 * (verificado 2026-09-12 contra Gemini: propose_action ok, actions: 0).
 *
 * Este texto se agrega al system prompt desde la superficie (canal de Slack,
 * script de ensayo) sin tocar domain/prompts.ts. Los nombres son los que el
 * writer del boundary entiende (ambiguous-writer.ts): el modelo nombra una
 * intencion de SilentOps, nunca una tool del proveedor.
 */
import { WRITE_INTENTS } from "./ambiguous-writer";

export const WRITE_VOCABULARY_PROMPT = `
VOCABULARIO DE ESCRITURA (obligatorio en propose_action con kind "workspace.write").
El campo payload es SIEMPRE { "tool": <intencion>, "args": { ... } }. Sin "tool", la accion se descarta.
Las intenciones son estas y ninguna otra; nunca uses nombres de tools del proveedor:

1. "${WRITE_INTENTS.createHandover}" — crear el documento de handover del turno que cierra.
   args: {
     "title": "Handover <NombreDelTurno> <AAAA-MM-DD>",
     "bullets": [ { "text": "<hecho del turno>", "source": "<id del mensaje u orden de trabajo de donde sale>" } ],
     "openWorkOrders": [ "<clave y titulo de cada orden abierta que pasa al turno entrante>" ],
     "shift": { "name": "...", "start": "HH:MM", "end": "HH:MM", "outgoing": ["..."], "incoming": ["..."] }
   }
   Reglas: maximo cinco bullets. Cada bullet lleva "source"; un bullet sin fuente NO entra al handover.
   Si el turno no tuvo novedades con fuente, manda "bullets": [] y el handover sale corto y honesto.
   La fecha del titulo es la fecha real del cierre del turno (sale de "now" o "receivedAt" del evento);
   nunca dejes plantillas como AAAA-MM-DD ni valores inventados.

2. "${WRITE_INTENTS.reassignWorkOrder}" — cambiar el responsable de UNA orden abierta cuyo responsable sale de turno.
   args: { "id": "<clave de la orden, ej. OT-243 o TASK-003>", "assignee": "<nombre de quien entra>", "note": "<opcional>" }
   Nunca cierra la orden; solo cambia el responsable. Una accion por orden.

3. "${WRITE_INTENTS.annotateWorkOrder}" — dejar una nota en una orden sin cambiar responsable ni estado.
   args: { "id": "<clave de la orden>", "note": "<texto>" }

Para avisar en el canal usa kind "channel.send" con payload { "channel": "slack", "to": "#operaciones-hub-frio", "body": "<resumen corto>" }; los tres campos son obligatorios.
Una llamada a propose_action por accion. Un payload incompleto (sin "tool", sin "args", sin "to" o sin "body") se descarta y la persona no lo ve.
Pedidos masivos ("cerra todas las ordenes") o reasignar a alguien que no esta en el roster: no los ejecutes como accion; marcalos con risk "high" en el rationale o escala.
`.trim();

/** System prompt de dominio + vocabulario de escritura. */
export function withWriteVocabulary(systemPrompt: string): string {
  return `${systemPrompt}\n\n${WRITE_VOCABULARY_PROMPT}`;
}
