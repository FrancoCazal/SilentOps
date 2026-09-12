/** CONTRATO CONGELADO (gate de las 10:00). */

export interface OutboundChannel {
  name: string;
  send(
    to: string,
    body: string,
    opts: { idempotencyKey: string },
  ): Promise<{ externalId: string }>;
}

const registry = new Map<string, OutboundChannel>();

export function registerOutbound(channel: OutboundChannel): void {
  registry.set(channel.name, channel);
}

export function outbound(name: string): OutboundChannel {
  const channel = registry.get(name);
  if (!channel) {
    throw new Error(
      `no outbound channel registered for '${name}' (registrados: ${[...registry.keys()].join(", ") || "ninguno"})`,
    );
  }
  return channel;
}

export function registeredOutboundNames(): string[] {
  return [...registry.keys()];
}
