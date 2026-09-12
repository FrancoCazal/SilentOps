/** Estado de las propuestas. En memoria para el dia; una sola fuente de verdad. */
import type { Proposal, ProposalStatus, ProposedAction } from "./types";

const proposals = new Map<string, Proposal>();

export function save(p: Proposal): Proposal {
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
  p.status = status;
  if (by) p.approvedBy = by;
  return p;
}

/** Edicion por respuesta en el thread: no hay modal en Channels managed. */
export function applyEdit(id: string, editedActions: ProposedAction[], by?: string): Proposal {
  const p = proposals.get(id);
  if (!p) throw new Error(`proposal ${id} no existe`);
  p.editedActions = editedActions;
  p.status = "edited";
  if (by) p.approvedBy = by;
  return p;
}

/** Trigger.dev marca vencidas cada 5 minutos; esto es la parte pura. */
export function expireOverdue(now = new Date()): Proposal[] {
  const expired: Proposal[] = [];
  for (const p of proposals.values()) {
    if (p.status === "pending" && new Date(p.expiresAt) <= now) {
      p.status = "expired";
      expired.push(p);
    }
  }
  return expired;
}

export function reset(): void {
  proposals.clear();
}
