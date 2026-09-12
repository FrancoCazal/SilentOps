/**
 * El puerto de LECTURA del workspace. R1 lo declara, R2 lo implementa.
 *
 * Existe porque el camino de lectura no estaba en los contratos:
 * boundary/workplace-mcp.ts expone escritura (ambiguousExecutor) y listado
 * (listWorkplaceTools), pero el detector y las tools de dominio necesitan LEER
 * el roster del turno, buscar documentos y listar ordenes abiertas.
 *
 * En vez de esperar a que R2 disenie la interfaz, R1 la declara y R2 registra la
 * implementacion real: mismo patron que registerWorkspaceExecutor en
 * boundary/write.ts. Asi ninguno de los dos se bloquea.
 */

export type WorkspaceReader = (
  tool: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

let reader: WorkspaceReader | undefined;

/** R2: registrar aca el lector MCP al arrancar el proceso. */
export function registerWorkspaceReader(fn: WorkspaceReader): void {
  reader = fn;
}

export function isWorkspaceReaderRegistered(): boolean {
  return reader !== undefined;
}

/** Solo para tests: volver al estado sin lector. */
export function resetWorkspaceReader(): void {
  reader = undefined;
}

/**
 * Lectura del workspace.
 *
 * TIRA si no hay lector registrado, a proposito. Devolver vacio seria peor que
 * fallar: el detector leeria ese vacio como "el handover no existe" e inventaria
 * una ausencia. La ausencia es la evidencia central del producto, asi que un
 * falso vacio no es un bug menor, es el producto mintiendo.
 */
export async function readTool(
  tool: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  if (!reader) {
    throw new Error(
      `no hay WorkspaceReader registrado: no se puede leer '${tool}'. ` +
        `R2 registra el lector MCP con registerWorkspaceReader(); ` +
        `los evals y el desarrollo usan fixtureReader().`,
    );
  }
  return reader(tool, args);
}

/**
 * Lector de fixtures para evals y desarrollo. Falla ruidosamente si falta un
 * fixture, por la misma razon que readTool: un vacio silencioso miente.
 */
export function fixtureReader(fixtures: Record<string, unknown>): WorkspaceReader {
  return async (tool) => {
    if (!(tool in fixtures)) {
      throw new Error(
        `fixture faltante para la tool '${tool}' (hay: ${Object.keys(fixtures).join(", ") || "ninguno"})`,
      );
    }
    return fixtures[tool];
  };
}
