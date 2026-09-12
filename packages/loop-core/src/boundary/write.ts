/**
 * Invariante 1 y 2: nada irreversible sale sin aprobacion, y una sola funcion
 * ejecuta. Si un archivo fuera de esta carpeta escribe en Ambiguous o manda un
 * mensaje, es un bug (R4 lo veta en la revision de codigo).
 *
 * Los ejecutores concretos se inyectan. Motivo: los nombres de tools de
 * Ambiguous salen del workspace vivo por MCP y no se inventan; R4 los lista al
 * arrancar y R2 registra el ejecutor real contra esa lista.
 */
import { getServiceToken, isAuth0Configured, verifyScope } from "./auth0";
import { idempotencyKey, remember, seen, recall } from "./idempotency";
import { outbound } from "../channels/outbound";
import { effectiveActions, type Proposal, type ProposedAction } from "../approval/types";
import { get, setStatus } from "../approval/store";
import type { Logger } from "../observability/log";

/**
 * Un scope distinto por tipo de accion. Los nombres son los que existen de
 * verdad en el tenant de Auth0 (API `silentops`), verificados con
 * `npm run auth0:check -w loop-core`.
 *
 * Si algun dia se crean los permisos granulares (`write:workspace`,
 * `send:channel`, `schedule:job`), alcanza con cambiar los valores de aca: el
 * checker y el boundary leen los dos de esta misma constante, asi que no pueden
 * quedar desalineados.
 */
export const SCOPE: Record<ProposedAction["kind"], string> = {
  "workspace.write": "write",
  "channel.send": "send",
  "job.schedule": "schedule",
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

export class HighRiskError extends Error {
  status = 412;
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

  if (!isAuth0Configured() && process.env.ALLOW_UNVERIFIED_WRITES === "1") {
    opts.log("AUTH0 BYPASS: scope no verificado (ALLOW_UNVERIFIED_WRITES=1, solo desarrollo)", {
      proposalId: p.id,
    });
  }

  for (const [index, action] of actions.entries()) {
    // 401/403 antes de tocar nada.
    const scope = SCOPE[action.kind];
    const payload = await verifyScope(opts.serviceToken, scope);
    opts.log("scope verified", { index, kind: action.kind, scope, verified: payload.sub !== "dev-bypass" });

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

/** Entrada del boton Aprobar: registra la decision humana antes de ejecutar. */
export async function approveAndExecute(
  proposalId: string,
  by: string,
  opts: { log: Logger; confirmHighRisk?: boolean },
): Promise<ExecutionResult[]> {
  const p = get(proposalId);
  if (!p) throw new Error(`proposal ${proposalId} no existe`);
  // "approved" tambien entra: es el reintento del boton despues de que fallo
  // el token o la ejecucion. La idempotencia omite lo que ya se ejecuto, asi
  // que un segundo click nunca duplica. rejected / expired no se reabren.
  if (p.status !== "pending" && p.status !== "edited" && p.status !== "approved") {
    throw new NotApprovedError(`proposal ${p.id} no se puede aprobar (status: ${p.status})`);
  }
  if (p.risk === "high" && !opts.confirmHighRisk) {
    throw new HighRiskError(`proposal ${p.id} de riesgo alto requiere confirmacion explicita`);
  }

  if (p.status === "approved") {
    opts.log("retrying approved proposal", { proposalId: p.id, by });
  } else {
    setStatus(p.id, p.status === "edited" ? "edited" : "approved", by);
  }
  // No revertir el status si falla el token o la ejecucion: se reintenta con
  // el mismo boton.
  const serviceToken = isAuth0Configured() ? await getServiceToken() : undefined;
  return executeApproved(p, { serviceToken, log: opts.log });
}

export function rejectProposal(proposalId: string, by: string): Proposal {
  return setStatus(proposalId, "rejected", by);
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
