/**
 * Invariante 1 y 2: nada irreversible sale sin aprobacion, y una sola funcion
 * ejecuta. Si un archivo fuera de esta carpeta escribe en Ambiguous o manda un
 * mensaje, es un bug (R4 lo veta en la revision de codigo).
 *
 * Los ejecutores concretos se inyectan. Motivo: los nombres de tools de
 * Ambiguous salen del workspace vivo por MCP y no se inventan; R4 los lista al
 * arrancar y R2 registra el ejecutor real contra esa lista.
 */
import { verifyScope } from "./auth0";
import { idempotencyKey, remember, seen, recall } from "./idempotency";
import { outbound } from "../channels/outbound";
import { effectiveActions, type Proposal, type ProposedAction } from "../approval/types";
import type { Logger } from "../observability/log";

export const SCOPE: Record<ProposedAction["kind"], string> = {
  "workspace.write": "write:workspace",
  "channel.send": "send:channel",
  "job.schedule": "schedule:job",
};

export type WorkspaceExecutor = (tool: string, args: Record<string, unknown>) => Promise<unknown>;
export type JobScheduler = (
  job: string,
  runAt: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
) => Promise<unknown>;

let workspaceExecutor: WorkspaceExecutor | undefined;
let jobScheduler: JobScheduler | undefined;

export function registerWorkspaceExecutor(fn: WorkspaceExecutor): void {
  workspaceExecutor = fn;
}
export function registerJobScheduler(fn: JobScheduler): void {
  jobScheduler = fn;
}

export type ExecutionResult =
  | { index: number; skipped: true; key: string; previous: unknown }
  | { index: number; skipped: false; key: string; result: unknown };

export class NotApprovedError extends Error {
  status = 409;
}

export async function executeApproved(
  p: Proposal,
  opts: { serviceToken?: string; log: Logger },
): Promise<ExecutionResult[]> {
  if (p.status !== "approved" && p.status !== "edited") {
    throw new NotApprovedError(`proposal ${p.id} no esta aprobada (status: ${p.status})`);
  }

  const actions = effectiveActions(p);
  const results: ExecutionResult[] = [];

  for (const [index, action] of actions.entries()) {
    // 401/403 antes de tocar nada.
    await verifyScope(opts.serviceToken, SCOPE[action.kind]);

    const key = idempotencyKey(p.sourceEventId, p.id, index);
    if (await seen(key)) {
      opts.log("skipped duplicate action", { proposalId: p.id, index, key });
      results.push({ index, skipped: true, key, previous: await recall(key) });
      continue;
    }

    const result = await dispatch(action, key);
    await remember(key, result);
    opts.log("executed action", { proposalId: p.id, index, kind: action.kind, key });
    results.push({ index, skipped: false, key, result });
  }

  return results;
}

async function dispatch(action: ProposedAction, key: string): Promise<unknown> {
  switch (action.kind) {
    case "workspace.write": {
      if (!workspaceExecutor) throw new Error("no hay WorkspaceExecutor registrado");
      return workspaceExecutor(action.tool, action.args);
    }
    case "channel.send": {
      return outbound(action.channel).send(action.to, action.body, { idempotencyKey: key });
    }
    case "job.schedule": {
      if (!jobScheduler) throw new Error("no hay JobScheduler registrado");
      return jobScheduler(action.job, action.runAt, action.payload, key);
    }
  }
}
