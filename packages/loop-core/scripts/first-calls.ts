/**
 * Checklist de arranque en un comando: npm run first-calls
 *
 * Pings reales (no solo "hay una variable"): si un sponsor no contesta, se ve
 * ahora y no a las 15:30. Ningun ping escribe nada en ningun lado.
 */
const results: Array<{ name: string; ok: boolean; detail: string }> = [];

async function check(name: string, fn: () => Promise<string>) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: `${detail} (${Date.now() - started}ms)` });
  } catch (e) {
    results.push({ name, ok: false, detail: String((e as Error)?.message ?? e).split("\n")[0]! });
  }
}

const need = (key: string): string => {
  const v = process.env[key];
  if (!v || v === "stub-replace-me") throw new Error(`falta ${key} en .env`);
  return v;
};

await check("OpenAI", async () => {
  const key = need("OPENAI_API_KEY");
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
  const body = (await res.json()) as { data: Array<{ id: string }> };
  const wanted = process.env.MODEL ?? "";
  const has = body.data.some((m) => m.id === wanted);
  return `${body.data.length} modelos${wanted ? `; MODEL="${wanted}" ${has ? "disponible" : "NO aparece en la cuenta"}` : ""}`;
});

await check("OpenRouter", async () => {
  const key = need("OPENROUTER_API_KEY");
  const res = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
  return `key valida; FALLBACK_MODEL=${process.env.FALLBACK_MODEL ?? "(sin definir)"}`;
});

await check("Exa", async () => {
  const key = need("EXA_API_KEY");
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ query: "AI Tinkerers", numResults: 1, type: process.env.EXA_SEARCH_TYPE ?? "fast" }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
  return "search responde";
});

await check("Ambiguous (REST)", async () => {
  const key = need("AMBIGUOUS_API_KEY");
  const res = await fetch("https://app.ambiguous.ai/api/users/me", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
  const me = (await res.json()) as Record<string, unknown>;
  return `identidad: ${me.email ?? me.name ?? JSON.stringify(me).slice(0, 60)}`;
});

await check("Ambiguous (MCP tools)", async () => {
  need("AMBIGUOUS_API_KEY");
  const { listWorkplaceTools } = await import("../src/boundary/workplace-mcp");
  const tools = await listWorkplaceTools();
  return `${tools.length} tools. Correr 'npm run tools:list -w loop-core' y pegar la lista en el canal`;
});

await check("Auth0 (M2M)", async () => {
  need("AUTH0_DOMAIN");
  const { getServiceToken, verifyScope } = await import("../src/boundary/auth0");
  const token = await getServiceToken();
  await verifyScope(token, "write:workspace");
  return "token emitido y scope write:workspace presente";
});

await check("CopilotKit Channels", async () => {
  need("INTELLIGENCE_API_KEY");
  const code = need("CHANNEL_CODE");
  return `configurado (channel: ${code}). Estado real: npm run channel:status`;
});

await check("Trigger.dev", async () => {
  need("TRIGGER_SECRET_KEY");
  return "key presente (el deploy se prueba con el primer job)";
});

console.log("");
for (const r of results) {
  console.log(`${r.ok ? "OK  " : "FALLA"} ${r.name.padEnd(24)} ${r.detail}`);
}
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} verdes.`);
process.exit(fails === 0 ? 0 : 1);
