/**
 * Configuration health for the Settings page.
 *
 * SECRETS NEVER LEAVE THIS FILE. Every credential is reported as a boolean —
 * no values, no prefixes, no lengths, nothing that narrows a guess. The two
 * values that are returned, `MODEL_PROVIDER` and `MODEL`, are routing choices
 * rather than credentials.
 *
 * This is read-only. Nothing here writes to the environment: a browser that can
 * change a safety-relevant setting is a browser that can turn one off.
 */

function isSet(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export type CheckState = "ready" | "missing" | "warning";

export type Check = {
  label: string;
  state: CheckState;
  detail: string;
};

export type ConfigGroup = {
  title: string;
  note: string;
  checks: Check[];
};

export function configGroups(): ConfigGroup[] {
  const provider = process.env.MODEL_PROVIDER?.trim() || "openai";
  const model = process.env.MODEL?.trim() || "(provider default)";
  const openai = isSet("OPENAI_API_KEY");
  const openrouter = isSet("OPENROUTER_API_KEY");
  const bothProviders = openai && openrouter;
  const auth0 = isSet("AUTH0_DOMAIN") && isSet("AUTH0_AUDIENCE");
  const bypass = process.env.ALLOW_UNVERIFIED_WRITES === "1";

  return [
    {
      title: "Model",
      note: "Every model call goes through the fallback, which switches to the other provider. The failure-path demo needs both keys.",
      checks: [
        {
          label: "Primary provider",
          state: "ready",
          detail: `${provider} · ${model}`,
        },
        {
          label: "OpenAI key",
          state: openai ? "ready" : "missing",
          detail: openai ? "configured" : "not configured",
        },
        {
          label: "OpenRouter key",
          state: openrouter ? "ready" : "missing",
          detail: openrouter ? "configured" : "not configured",
        },
        {
          label: "Provider fallback",
          state: bothProviders ? "ready" : "warning",
          detail: bothProviders
            ? "both providers configured"
            : "needs both keys, or the fallback fails with the primary",
        },
      ],
    },
    {
      title: "Workspace and channel",
      note: "The detector reads shifts, documents and work orders from Ambiguous, and posts through the managed Channel.",
      checks: [
        {
          label: "Ambiguous workspace",
          state: isSet("AMBIGUOUS_API_KEY") ? "ready" : "missing",
          detail: isSet("AMBIGUOUS_API_KEY") ? "configured" : "not configured",
        },
        {
          label: "Intelligence key",
          state: isSet("INTELLIGENCE_API_KEY") ? "ready" : "missing",
          detail: isSet("INTELLIGENCE_API_KEY") ? "configured" : "not configured",
        },
        {
          label: "Channel code",
          state: isSet("CHANNEL_CODE") ? "ready" : "missing",
          detail: isSet("CHANNEL_CODE") ? "configured" : "not configured",
        },
        {
          label: "Exa search",
          state: isSet("EXA_API_KEY") ? "ready" : "missing",
          detail: isSet("EXA_API_KEY")
            ? "configured"
            : "not configured · not required for handover detection",
        },
      ],
    },
    {
      title: "Write boundary",
      note: "Approved writes require an Auth0 service scope and an idempotency key. The console itself never writes.",
      checks: [
        {
          label: "Auth0 scope verification",
          state: auth0 ? "ready" : "missing",
          detail: auth0
            ? "domain and audience configured"
            : "AUTH0_DOMAIN and AUTH0_AUDIENCE not configured",
        },
        {
          label: "Unverified writes",
          state: bypass ? "warning" : "ready",
          detail: bypass
            ? "ALLOW_UNVERIFIED_WRITES=1 — the Auth0 scope check is bypassed. Development only."
            : "disabled · scope is enforced",
        },
      ],
    },
    {
      title: "Control tower access",
      note: "This surface is gated by a shared hub code exchanged for a signed, HttpOnly session cookie.",
      checks: [
        {
          label: "Hub access code",
          state: isSet("CONSOLE_ACCESS_CODE") ? "ready" : "missing",
          detail: isSet("CONSOLE_ACCESS_CODE")
            ? "configured"
            : "not configured · the tower stays locked",
        },
        {
          label: "Session signing key",
          state: isSet("CONSOLE_SESSION_SECRET") ? "ready" : "warning",
          detail: isSet("CONSOLE_SESSION_SECRET")
            ? "configured · sessions survive restarts"
            : "generated per process · a restart signs everyone out",
        },
      ],
    },
  ];
}
