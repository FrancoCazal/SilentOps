/**
 * Adaptador Slack -> InboundEvent (R2). Funcion PURA: recibe lo que el
 * handler de Channels ya tiene (el mensaje y el historial del hilo) y devuelve
 * el contrato congelado. El agente nunca ve el payload crudo de Slack.
 *
 * Lo que va en `context` es la tesis del hackathon: lo que el canal sabe y un
 * chatbox no. Aca: quien esta en el hilo, que se dijo antes, si es una edicion
 * de una propuesta ya publicada, y desde que plataforma llego.
 *
 * Restricciones reales de Channels managed: los botones disparan, los modales
 * y los slash commands no. Editar una propuesta es RESPONDER EN EL THREAD de la
 * card, y esa respuesta entra con `context.editsProposal = "<proposalId>"`.
 *
 * Convencion con R3 (card): la card incluye en su texto el marcador
 * `proposal:<uuid>`; asi una respuesta humana en ese hilo se reconoce como
 * edicion sin depender de estado en memoria.
 */
import type { ChannelMessage, ThreadMessage } from "@copilotkit/channels";
import type { InboundEvent, InboundAttachment } from "loop-core";

export const PROPOSAL_MARKER = /proposal:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export type SlackThreadFacts = {
  /** Identidad estable del hilo/conversacion, si el runtime la expone. */
  conversationKey?: string;
  /** Historial del hilo tal cual lo devuelve thread.getMessages(). */
  history?: ThreadMessage[];
  /** Inyectable para tests. */
  now?: () => Date;
};

export type HistoryEntry = {
  from: string;
  text: string;
  ts?: string;
  isBot: boolean;
};

/**
 * Devuelve undefined cuando el mensaje NO debe generar un evento: lo escribio
 * un bot o una app (incluido nuestro propio agente), o es una eliminacion.
 * El caller simplemente no llama a handleEvent.
 */
export function toInboundEvent(
  message: ChannelMessage,
  facts: SlackThreadFacts = {},
): InboundEvent | undefined {
  if (message.operation?.kind === "deleted") return undefined;
  if (message.actor.kind === "bot" || message.actor.kind === "app") return undefined;

  const text = (message.text ?? "").trim();
  const history = (facts.history ?? []).map(toHistoryEntry);
  const editsProposal = findProposalId(facts.history ?? []);
  const attachments = toAttachments(message.contentParts);

  const context: Record<string, unknown> = {
    platform: message.platform,
    mentioned: message.operation?.mentioned ?? true,
    participants: participants(message, facts.history ?? []),
    threadHistory: history,
    threadMessageCount: history.length,
  };
  if (facts.conversationKey) context.conversationKey = facts.conversationKey;
  if (editsProposal) context.editsProposal = editsProposal;

  return {
    id: stableId(message),
    channel: "slack",
    from: {
      externalId: message.actor.id,
      displayName: message.user?.name ?? message.actor.name ?? message.actor.handle,
    },
    receivedAt: (facts.now ?? (() => new Date()))().toISOString(),
    text: text || undefined,
    attachments: attachments.length ? attachments : undefined,
    context,
  };
}

/**
 * Semilla de la idempotencia. Orden: eventId estable de la plataforma (lo pone
 * el camino managed), id logico del mensaje (sobrevive a ediciones), ref.id.
 * Un webhook reintentado trae el mismo id y cae en la misma key del boundary.
 */
export function stableId(message: ChannelMessage): string {
  const logical = message.operation?.logicalMessageId;
  const revision = message.operation?.revisionId;
  if (message.eventId) return `slack:${message.eventId}`;
  if (logical) return `slack:${logical}${revision && revision !== logical ? `:${revision}` : ""}`;
  return `slack:${message.ref.id}`;
}

/** Busca el marcador de propuesta en los mensajes del bot del hilo (el mas reciente gana). */
export function findProposalId(history: ThreadMessage[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (!m) continue;
    const fromBot = m.isBot === true || m.user?.kind === "bot" || m.user?.kind === "app";
    if (!fromBot) continue;
    const match = PROPOSAL_MARKER.exec(m.text ?? "");
    if (match?.[1]) return match[1].toLowerCase();
  }
  return undefined;
}

function toHistoryEntry(m: ThreadMessage): HistoryEntry {
  return {
    from: m.user?.name ?? m.user?.handle ?? m.user?.id ?? (m.isBot ? "bot" : "desconocido"),
    text: m.text ?? "",
    ts: m.ts,
    isBot: m.isBot === true || m.user?.kind === "bot" || m.user?.kind === "app",
  };
}

function participants(message: ChannelMessage, history: ThreadMessage[]): string[] {
  const names = new Set<string>();
  const label = (a: { name?: string; handle?: string; id: string } | undefined) =>
    a ? (a.name ?? a.handle ?? a.id) : undefined;
  const mine = message.user?.name ?? label(message.actor);
  if (mine) names.add(mine);
  for (const m of history) {
    if (m.isBot || m.user?.kind === "bot" || m.user?.kind === "app") continue;
    const n = label(m.user);
    if (n) names.add(n);
  }
  return [...names];
}

function toAttachments(parts: ChannelMessage["contentParts"]): InboundAttachment[] {
  const out: InboundAttachment[] = [];
  for (const part of parts ?? []) {
    const p = part as unknown as Record<string, unknown>;
    const type = String(p.type ?? "");
    const source = p.source as Record<string, unknown> | undefined;
    const url = typeof p.url === "string" ? p.url : typeof source?.value === "string" && source?.type === "url" ? source.value : undefined;
    const mime = typeof p.mimeType === "string" ? p.mimeType : typeof source?.mimeType === "string" ? source.mimeType : undefined;
    if (!url || !mime) continue;
    const kind: InboundAttachment["kind"] =
      type === "image" ? "image" : type === "audio" ? "audio" : "document";
    out.push({ kind, url, mime });
  }
  return out;
}
