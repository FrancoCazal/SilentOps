/** Estado de las propuestas, opcionalmente respaldado por un archivo atomico. */
import { existsSync } from "node:fs";
import { fileProposalStore, type FileProposalStore } from "../boundary/file-store";
import type { Proposal, ProposalStatus, ProposedAction } from "./types";

const proposals = new Map<string, Proposal>();
let persistence: FileProposalStore | undefined;

function persist(next = proposals): void {
  persistence?.flushSync(next);
}

/**
 * El archivo existente es autoritativo. Si todavia no existe, conserva y
 * vuelca las propuestas que pudieron crearse durante el arranque.
 */
/** Vuelve a memoria pura. Lo usan tests y bootstrapBoundary({ persist: false }). */
export function disablePersistence(): void {
  persistence = undefined;
}

export async function enablePersistence(path: string): Promise<void> {
  const nextPersistence = fileProposalStore(path);
  if (existsSync(path)) {
    const loaded = nextPersistence.load();
    proposals.clear();
    for (const entry of loaded) proposals.set(...entry);
  } else {
    nextPersistence.flushSync(proposals);
  }
  persistence = nextPersistence;
}

export function save(p: Proposal): Proposal {
  const next = new Map(proposals);
  next.set(p.id, p);
  persist(next);
  proposals.set(p.id, p);
  return p;
}

export function get(id: string): Proposal | undefined {
  return proposals.get(id);
}

export function list(status?: ProposalStatus): Proposal[] {
  const all = [...proposals.values()];
  return status ? all.filter((p) => p.status === status) : all;
}

export function setStatus(id: string, status: ProposalStatus, by?: string): Proposal {
  const p = proposals.get(id);
  if (!p) throw new Error(`proposal ${id} no existe`);
  const updated = { ...p, status };
  if (by) updated.approvedBy = by;
  const next = new Map(proposals);
  next.set(id, updated);
  persist(next);
  Object.assign(p, updated);
  return p;
}

/** Edicion por respuesta en el thread: no hay modal en Channels managed. */
export function applyEdit(id: string, editedActions: ProposedAction[], by?: string): Proposal {
  const p = proposals.get(id);
  if (!p) throw new Error(`proposal ${id} no existe`);
  const updated = { ...p, editedActions, status: "edited" as const };
  if (by) updated.approvedBy = by;
  const next = new Map(proposals);
  next.set(id, updated);
  persist(next);
  Object.assign(p, updated);
  return p;
}

/** Trigger.dev marca vencidas cada 5 minutos; esto es la parte pura. */
export function expireOverdue(now = new Date()): Proposal[] {
  const expired: Proposal[] = [];
  const updates: Array<[Proposal, Proposal]> = [];
  const next = new Map(proposals);
  for (const p of proposals.values()) {
    if (p.status === "pending" && new Date(p.expiresAt) <= now) {
      const updated = { ...p, status: "expired" as const };
      next.set(p.id, updated);
      updates.push([p, updated]);
    }
  }
  if (updates.length > 0) persist(next);
  for (const [p, updated] of updates) {
    Object.assign(p, updated);
    expired.push(p);
  }
  return expired;
}

export function reset(): void {
  persist(new Map());
  proposals.clear();
}
