/**
 * Invariante 3 del core: todo llamado a modelo tiene fallback de provider.
 *
 * OJO, difiere del documento de arquitectura: el kit NO usa `@openai/agents`
 * ni `setDefaultOpenAIClient`. Usa `BuiltInAgent` de `@copilotkit/runtime/v2`
 * con un modelo del AI SDK que resuelve `resolveModel()` desde el entorno
 * (packages/agent-core/src/model.ts). Por eso el fallback no cambia un cliente
 * global: re-resuelve el modelo apuntando al otro provider y reintenta.
 */
import { resolveModel } from "agent-core";
import type { Logger } from "../observability/log";

export type ModelRef = ReturnType<typeof resolveModel>;
export type ProviderName = "openai" | "openrouter";

export type Attempt = {
  provider: ProviderName;
  /** 1 = primario, 2 = fallback */
  n: number;
  model: ModelRef;
};

/** Errores que justifican cambiar de provider. Un 400 nuestro no se reintenta. */
export function isRetryable(e: unknown): boolean {
  const err = e as { status?: number; statusCode?: number; code?: string; name?: string };
  const status = err?.status ?? err?.statusCode;
  if (typeof status === "number" && (status >= 500 || status === 429 || status === 408)) return true;
  if (err?.name === "AbortError" || err?.name === "TimeoutError") return true;
  return ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"].includes(
    err?.code ?? "",
  );
}

/** resolveModel() lee el entorno; lo apuntamos al provider pedido y lo devolvemos. */
export function resolveFor(provider: ProviderName, model?: string): ModelRef {
  const prevProvider = process.env.MODEL_PROVIDER;
  const prevModel = process.env.MODEL;
  try {
    process.env.MODEL_PROVIDER = provider;
    if (model) process.env.MODEL = model;
    return resolveModel();
  } finally {
    restore("MODEL_PROVIDER", prevProvider);
    restore("MODEL", prevModel);
  }
}

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

export function primaryProvider(): ProviderName {
  return (process.env.MODEL_PROVIDER || "openai").toLowerCase() === "openrouter"
    ? "openrouter"
    : "openai";
}

export function fallbackProvider(): ProviderName {
  return primaryProvider() === "openai" ? "openrouter" : "openai";
}

/** Kill switch para la toma del video: FORCE_PROVIDER_FAILURE=1 tumba el primario. */
export function forcedFailure(): boolean {
  return process.env.FORCE_PROVIDER_FAILURE === "1";
}

class ForcedProviderFailure extends Error {
  status = 503;
  constructor() {
    super("FORCE_PROVIDER_FAILURE=1: primary provider returned 503 (simulado para la demo)");
    this.name = "ForcedProviderFailure";
  }
}

/**
 * Corre `fn` con el modelo primario. Si falla con un error reintentable
 * (o si el kill switch esta activo), re-resuelve contra el otro provider y
 * vuelve a correr. Un solo salto: si el fallback tambien falla, propaga.
 */
export async function withFallback<T>(
  fn: (model: ModelRef, attempt: Attempt) => Promise<T>,
  log: Logger,
): Promise<T> {
  const primary = primaryProvider();
  try {
    if (forcedFailure()) throw new ForcedProviderFailure();
    const model = resolveFor(primary);
    log("model attempt", { provider: primary, attempt: 1 });
    return await fn(model, { provider: primary, n: 1, model });
  } catch (e) {
    if (!isRetryable(e)) throw e;
    const next = fallbackProvider();
    const reason = (e as { status?: number; code?: string })?.status ?? (e as { code?: string })?.code;
    log("primary provider failed, switching provider", { from: primary, to: next, reason });
    const model = resolveFor(next, process.env.FALLBACK_MODEL ?? defaultFallbackModel(next));
    const out = await fn(model, { provider: next, n: 2, model });
    log("fallback provider succeeded", { provider: next });
    return out;
  }
}

function defaultFallbackModel(provider: ProviderName): string | undefined {
  // OpenRouter necesita slug publisher/model; OpenAI se queda con MODEL.
  return provider === "openrouter" ? "openai/gpt-4.1" : undefined;
}
