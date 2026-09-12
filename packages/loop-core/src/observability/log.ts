/** Un runId por evento de entrada, propagado a agente, propuesta, card y ejecucion. */

export type LogFields = Record<string, unknown>;

export function log(runId: string, msg: string, extra: LogFields = {}): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), runId, msg, ...extra }));
}

export function newRunId(prefix = "run"): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

export type Logger = (msg: string, extra?: LogFields) => void;

export function loggerFor(runId: string): Logger {
  return (msg, extra = {}) => log(runId, msg, extra);
}
