/**
 * El reloj del dominio.
 *
 * El detector ya aceptaba `now` por opciones, pero las tools de lectura del
 * agente no: cuando el modelo llama `shift_roster` sin `at`, el lector usaba
 * `new Date()` — la hora real de la maquina. En un ensayo a las 15:00 eso cae
 * fuera de la guardia Noche (22:00-06:00) y el lector tira
 * "no hay una guardia con roster activo", asi que el agente se queda sin roster
 * y no sabe a quien reasignar.
 *
 * Un solo lugar decide "ahora" para todo el dominio.
 */

/** ISO 8601 para reproducir un borde de turno. Invalido tira, no cae a `now`. */
export function silentopsNow(raw = process.env.SILENTOPS_DEMO_AT): Date {
  if (!raw) return new Date();
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) {
    throw new Error("SILENTOPS_DEMO_AT debe ser una fecha ISO 8601 valida");
  }
  return at;
}

/** El `at` que recibe una tool de lectura, con el reloj del ensayo por defecto. */
export function resolveAt(at: unknown): string {
  return typeof at === "string" && at.trim() ? at : silentopsNow().toISOString();
}
