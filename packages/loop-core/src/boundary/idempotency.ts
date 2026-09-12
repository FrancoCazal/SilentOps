/**
 * Invariante 2 (segunda mitad): reenviar el mismo evento no duplica escrituras.
 * La key sale del evento de origen, no del reloj: un webhook reintentado por
 * WhatsApp o Slack trae el mismo InboundEvent.id y cae en la misma key.
 */
import { createHash } from "node:crypto";

export type IdempotencyStore = {
  seen(key: string): Promise<boolean>;
  remember(key: string, value: unknown): Promise<void>;
  recall(key: string): Promise<unknown>;
};

export function idempotencyKey(eventId: string, proposalId: string, index: number): string {
  return createHash("sha256")
    .update(`${eventId}:${proposalId}:${index}`)
    .digest("hex")
    .slice(0, 48);
}

/** En memoria alcanza para el dia. Si sobra tiempo: SQLite o Ambiguous. */
export function memoryStore(): IdempotencyStore {
  const store = new Map<string, unknown>();
  return {
    async seen(key) {
      return store.has(key);
    },
    async remember(key, value) {
      store.set(key, value);
    },
    async recall(key) {
      return store.get(key);
    },
  };
}

let active: IdempotencyStore = memoryStore();

export function setIdempotencyStore(store: IdempotencyStore): void {
  active = store;
}
export const seen = (key: string) => active.seen(key);
export const remember = (key: string, value: unknown) => active.remember(key, value);
export const recall = (key: string) => active.recall(key);
