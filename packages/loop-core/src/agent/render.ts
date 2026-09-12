/**
 * El canal traduce; el agente lee castellano. Que el contexto del canal llegue
 * como texto explicito ("llego por WhatsApp a las 22:40, fuera de horario") es
 * lo que hace que el agente sea "de ese lugar" y no un chatbot con un webhook.
 */
import type { InboundEvent } from "../channels/inbound";

const CHANNEL_LABEL: Record<InboundEvent["channel"], string> = {
  whatsapp: "WhatsApp",
  voice: "una llamada de voz",
  mail: "un mail",
  camera: "una camara",
  cron: "un disparo programado",
  slack: "Slack",
};

export function renderEvent(evt: InboundEvent): string {
  const when = new Date(evt.receivedAt);
  const hour = Number.isNaN(when.getTime()) ? undefined : when.getHours();
  const lines: string[] = [];

  lines.push(
    `Entro un evento por ${CHANNEL_LABEL[evt.channel]}` +
      (hour === undefined ? "." : ` a las ${pad(hour)}:${pad(when.getMinutes())}.`),
  );
  if (hour !== undefined && (hour >= 20 || hour < 7)) {
    lines.push("Es fuera de horario de oficina.");
  }
  lines.push(`De: ${evt.from.displayName ?? evt.from.externalId}.`);

  if (evt.text) lines.push("", "MENSAJE:", evt.text);

  if (evt.attachments?.length) {
    lines.push(
      "",
      "ADJUNTOS:",
      ...evt.attachments.map((a) => `- ${a.kind} (${a.mime}): ${a.url}`),
    );
  }

  const context = evt.context ?? {};
  const entries = Object.entries(context).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length) {
    lines.push("", "CONTEXTO DEL CANAL (esto lo sabes por estar aca):");
    for (const [k, v] of entries) lines.push(`- ${k}: ${stringify(v)}`);
  }

  return lines.join("\n");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
