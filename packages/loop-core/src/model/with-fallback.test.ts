/**
 * Invariante 3: todo llamado a modelo tiene fallback de provider.
 *
 * Hasta ahora esto era una afirmacion del video sin verificacion. El test corre
 * sin red y sin gastar creditos: `resolveModel()` solo construye el objeto de
 * modelo, no lo llama, asi que con claves falsas alcanza.
 *
 * El caso que le importa al video es "FORCE_PROVIDER_FAILURE=1 tumba el
 * primario y el MISMO run termina por el secundario".
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  fallbackProvider,
  forcedFailure,
  isRetryable,
  primaryProvider,
  resolveFor,
  withFallback,
  type Attempt,
} from "./with-fallback";

const KEYS = [
  "MODEL_PROVIDER",
  "MODEL",
  "FALLBACK_MODEL",
  "FORCE_PROVIDER_FAILURE",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

const silent = () => {};
let saved: Record<string, string | undefined> = {};

/** Un error del provider, con la forma que isRetryable() inspecciona. */
function providerError(status: number): Error {
  return Object.assign(new Error(`provider ${status}`), { status });
}

beforeEach(() => {
  saved = {};
  for (const key of KEYS) saved[key] = process.env[key];
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.MODEL_PROVIDER = "openai";
  delete process.env.MODEL;
  delete process.env.FALLBACK_MODEL;
  delete process.env.FORCE_PROVIDER_FAILURE;
});

afterEach(() => {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("fallback de provider", () => {
  it("sin kill switch corre en el primario y no salta", async () => {
    const attempts: Attempt[] = [];

    const out = await withFallback(async (_model, attempt) => {
      attempts.push(attempt);
      return "ok";
    }, silent);

    assert.equal(out, "ok");
    assert.equal(attempts.length, 1, "no tendria que haber segundo intento");
    assert.equal(attempts[0]!.n, 1);
    assert.equal(attempts[0]!.provider, "openai");
  });

  it("FORCE_PROVIDER_FAILURE=1 tumba el primario y el mismo run termina en el secundario", async () => {
    process.env.FORCE_PROVIDER_FAILURE = "1";
    const lines: string[] = [];

    const attempt = await withFallback<Attempt>(
      async (_model, a) => a,
      (msg) => void lines.push(msg),
    );

    assert.equal(attempt.n, 2, "el run tiene que completarse en el segundo intento");
    assert.equal(attempt.provider, "openrouter");
    assert.ok(
      lines.includes("primary provider failed, switching provider"),
      "el salto tiene que quedar en el log: es lo que se ve en el video",
    );
    assert.ok(lines.includes("fallback provider succeeded"));
  });

  it("un error reintentable del primario salta de provider", async () => {
    let calls = 0;

    const attempt = await withFallback<Attempt>(async (_model, a) => {
      calls++;
      if (a.n === 1) throw providerError(503);
      return a;
    }, silent);

    assert.equal(calls, 2);
    assert.equal(attempt.provider, "openrouter");
  });

  it("un 400 nuestro NO se reintenta: un bug propio no se disfraza de caida del provider", async () => {
    let calls = 0;

    await assert.rejects(
      () =>
        withFallback(async () => {
          calls++;
          throw providerError(400);
        }, silent),
      /provider 400/,
    );

    assert.equal(calls, 1, "no tiene que haber segundo intento");
  });

  it("un solo salto: si el fallback tambien falla, propaga", async () => {
    let calls = 0;

    await assert.rejects(
      () =>
        withFallback(async () => {
          calls++;
          throw providerError(503);
        }, silent),
      /provider 503/,
    );

    assert.equal(calls, 2, "dos intentos y para: no reintenta para siempre");
  });

  it("es simetrico: con openrouter primario, el fallback es openai", async () => {
    process.env.MODEL_PROVIDER = "openrouter";
    process.env.FORCE_PROVIDER_FAILURE = "1";

    assert.equal(primaryProvider(), "openrouter");
    assert.equal(fallbackProvider(), "openai");

    const attempt = await withFallback<Attempt>(async (_model, a) => a, silent);
    assert.equal(attempt.provider, "openai");
  });
});

describe("isRetryable", () => {
  it("reintenta lo del provider y no lo nuestro", () => {
    assert.equal(isRetryable(providerError(500)), true);
    assert.equal(isRetryable(providerError(429)), true);
    assert.equal(isRetryable(providerError(408)), true);
    assert.equal(isRetryable(providerError(400)), false);
    assert.equal(isRetryable(providerError(404)), false);
  });

  it("reintenta cortes de red y timeouts", () => {
    assert.equal(isRetryable({ name: "AbortError" }), true);
    assert.equal(isRetryable({ name: "TimeoutError" }), true);
    assert.equal(isRetryable({ code: "ECONNRESET" }), true);
    assert.equal(isRetryable({ code: "ETIMEDOUT" }), true);
    assert.equal(isRetryable(new Error("algo generico")), false);
  });
});

describe("kill switch y entorno", () => {
  it("forcedFailure lee el entorno", () => {
    assert.equal(forcedFailure(), false);
    process.env.FORCE_PROVIDER_FAILURE = "1";
    assert.equal(forcedFailure(), true);
    process.env.FORCE_PROVIDER_FAILURE = "0";
    assert.equal(forcedFailure(), false, "solo '1' activa el kill switch");
  });

  it("resolveFor restaura el entorno: una fuga cambiaria de provider en silencio", () => {
    process.env.MODEL_PROVIDER = "openai";
    process.env.MODEL = "gpt-4.1";

    resolveFor("openrouter", "openai/gpt-4.1");

    assert.equal(process.env.MODEL_PROVIDER, "openai");
    assert.equal(process.env.MODEL, "gpt-4.1");
  });
});
