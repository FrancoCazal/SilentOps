/**
 * CONTRATO CONGELADO (gate de las 10:00). Cambios solo por acuerdo de los cuatro roles.
 *
 * Todo canal de entrada produce esto y nada mas. El agente nunca ve el payload
 * crudo de WhatsApp, Twilio, Slack, camara ni mail.
 */

export type InboundChannelName =
  | "whatsapp"
  | "voice"
  | "mail"
  | "camera"
  | "cron"
  | "slack";

export type InboundAttachment = {
  kind: "audio" | "image" | "document";
  url: string;
  mime: string;
};

export type InboundEvent = {
  /** id del mensaje en el canal de origen. Es la semilla de la idempotencia. */
  id: string;
  channel: InboundChannelName;
  from: { externalId: string; displayName?: string };
  /** ISO 8601 */
  receivedAt: string;
  /** texto o transcripcion */
  text?: string;
  attachments?: InboundAttachment[];
  /**
   * Lo que el canal sabe y un chatbox no: ubicacion, thread, hora local,
   * participantes, sensor, estado del formulario. Este campo es la tesis del
   * hackathon: el ambiente hace al agente mas util. Cada adaptador lo llena
   * con lo que solo ese canal sabe.
   *
   * Convencion reservada: `editsProposal: string` marca una respuesta en el
   * thread de una card de Slack que edita una propuesta existente.
   */
  context?: Record<string, unknown>;
};

export interface InboundChannel {
  name: InboundChannelName;
  start(handler: (evt: InboundEvent) => Promise<void>): Promise<void>;
}
