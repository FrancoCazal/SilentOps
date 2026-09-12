/**
 * Trigger.dev v3. No viene en el kit: `npm i @trigger.dev/sdk -w loop-core`
 * y `npx trigger.dev@latest init` cuando R1 llegue a este bloque (13:30).
 *
 * Hasta entonces esto corre en proceso: misma firma, sin durabilidad. Cambiar
 * el import no cambia nada mas, porque todo vuelve a entrar por el boundary
 * con la misma idempotency key.
 */
import type { JobScheduler } from "../boundary/write";
import { log } from "../observability/log";

type Pending = { job: string; runAt: string; payload: Record<string, unknown>; key: string };

const pending = new Map<string, Pending>();

export const inProcessScheduler: JobScheduler = async (job, runAt, payload, key) => {
  pending.set(key, { job, runAt, payload, key });
  log("jobs", "job scheduled", { job, runAt, key, durable: false });
  return { scheduled: true, job, runAt, key, durable: false };
};

export function pendingJobs(): Pending[] {
  return [...pending.values()];
}

/** Los jobs vencidos: lo que el cron de Trigger.dev va a disparar. */
export function dueJobs(now = new Date()): Pending[] {
  return pendingJobs().filter((j) => new Date(j.runAt) <= now);
}
