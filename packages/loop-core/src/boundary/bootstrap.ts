/**
 * Arranque del boundary. Lo llama server.ts UNA vez antes de aceptar eventos.
 *
 * Es la unica pieza que decide "quien escribe de verdad": registra el ejecutor
 * de Ambiguous, el scheduler y activa la persistencia en disco. El resto del
 * proceso solo conoce executeApproved / approveAndExecute.
 *
 * Todo lo que degrada lo dice en el log al arrancar, nunca en silencio: si en
 * el video se ve que escribio sin verificar scope, se pierde el argumento.
 */
import { registerWorkspaceExecutor, registerJobScheduler } from "./write";
import type { WorkspaceExecutor, JobScheduler } from "./write";
import { createAmbiguousWorkspaceWriter } from "./ambiguous-writer";
import { setIdempotencyStore, memoryStore } from "./idempotency";
import { fileIdempotencyStore, defaultStatePaths } from "./file-store";
import { isAuth0Configured } from "./auth0";
import { enablePersistence, disablePersistence } from "../approval/store";
import { inProcessScheduler } from "../jobs/followup";
import { registerWorkspaceReader, type WorkspaceReader } from "../domain/workspace-reader";
import { createAmbiguousWorkspaceReader } from "./ambiguous-reader";
import type { Logger } from "../observability/log";

export type BootstrapOptions = {
  log: Logger;
  /**
   * Por defecto el writer de Ambiguous (boundary/ambiguous-writer.ts): traduce
   * intenciones silentops.* a create_document / update_task y valida cualquier
   * tool real contra el catalogo. Inyectable para tests y ensayos sin escribir.
   */
  workspaceExecutor?: WorkspaceExecutor;
  /** Por defecto inProcessScheduler (sin durabilidad; Trigger.dev es de R1). */
  jobScheduler?: JobScheduler;
  /** false = todo en memoria. Por defecto true: .data/loop-core (LOOP_STATE_DIR). */
  persist?: boolean;
  /**
   * Puerto de LECTURA (contrato §6: R1 lo declara, R2 lo registra). Por defecto
   * el lector real de Ambiguous; fixtureReader(...) para evals y ensayos.
   */
  workspaceReader?: WorkspaceReader;
};

export type BootstrapReport = {
  workspace: "ambiguous" | "custom" | "unconfigured";
  reader: "ambiguous" | "custom";
  auth0: "configured" | "bypass" | "blocked";
  statePaths?: { idempotency: string; proposals: string };
};

export async function bootstrapBoundary(opts: BootstrapOptions): Promise<BootstrapReport> {
  const persist = opts.persist ?? true;
  let statePaths: BootstrapReport["statePaths"];
  if (persist) {
    statePaths = defaultStatePaths();
    setIdempotencyStore(fileIdempotencyStore(statePaths.idempotency));
    await enablePersistence(statePaths.proposals);
  } else {
    setIdempotencyStore(memoryStore());
    disablePersistence();
  }

  const workspace: BootstrapReport["workspace"] = opts.workspaceExecutor
    ? "custom"
    : process.env.AMBIGUOUS_API_KEY?.trim()
      ? "ambiguous"
      : "unconfigured";
  // Sin key, el writer tira un error claro al primer uso: falla visible, no
  // escritura fantasma.
  registerWorkspaceExecutor(opts.workspaceExecutor ?? createAmbiguousWorkspaceWriter({ log: opts.log }));
  registerJobScheduler(opts.jobScheduler ?? inProcessScheduler);

  // Lectura: el detector y las tools de dominio leen por aca. Sin key, el
  // lector real tira en el primer uso (nunca devuelve vacio: contrato §6).
  const reader: BootstrapReport["reader"] = opts.workspaceReader ? "custom" : "ambiguous";
  registerWorkspaceReader(opts.workspaceReader ?? createAmbiguousWorkspaceReader());

  const auth0: BootstrapReport["auth0"] = isAuth0Configured()
    ? "configured"
    : process.env.ALLOW_UNVERIFIED_WRITES === "1"
      ? "bypass"
      : "blocked";

  const report: BootstrapReport = { workspace, reader, auth0, statePaths };
  opts.log("boundary bootstrapped", { ...report });
  if (workspace === "unconfigured") {
    opts.log("AMBIGUOUS_API_KEY ausente: toda workspace.write va a fallar de forma visible");
  }
  if (auth0 === "bypass") {
    opts.log("AUTH0 BYPASS activo: las escrituras NO verifican scope (ALLOW_UNVERIFIED_WRITES=1, solo desarrollo)");
  }
  if (auth0 === "blocked") {
    opts.log("Auth0 no configurado y sin bypass: toda escritura sera rechazada hasta cargar AUTH0_* o ALLOW_UNVERIFIED_WRITES=1");
  }
  return report;
}
