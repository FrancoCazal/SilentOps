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
 *
 * The Model group asks `loop-core` which provider and model each hop resolves
 * to, instead of re-deriving it here, so this page cannot describe a fallback
 * the runtime would not take.
 */
import {
  fallbackTarget,
  isProviderConfigured,
  primaryProvider,
  type ProviderName,
} from "loop-core";

const providerKeys: readonly { provider: ProviderName; label: string }[] = [
  { provider: "openai", label: "OpenAI key" },
  { provider: "openrouter", label: "OpenRouter key" },
  { provider: "google", label: "Google AI key" },
];

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
  const primary = primaryProvider();
  const model = process.env.MODEL?.trim() || "(provider default)";
  const primaryReady = isProviderConfigured(primary);
  const fallback = fallbackTarget();
  const fallbackReady = isProviderConfigured(fallback.provider);
  // A hop to the same provider and model retries the call that just failed.
  const sameTarget =
    fallback.provider === primary && (fallback.model ?? model) === model;
  const auth0 = isSet("AUTH0_DOMAIN") && isSet("AUTH0_AUDIENCE");
  const bypass = process.env.ALLOW_UNVERIFIED_WRITES === "1";

  return [
    {
      title: "Model",
      note: "Every model call goes through the fallback: a retryable failure is retried once on another provider or model. The failure-path demo needs both hops configured.",
      checks: [
        {
          label: "Primary",
          state: primaryReady ? "ready" : "missing",
          detail: primaryReady
            ? `${primary} · ${model}`
            : `${primary} · ${model} · key not configured`,
        },
        {
          label: "Fallback",
          state: !fallbackReady || !fallback.model
            ? "missing"
            : sameTarget
              ? "warning"
              : "ready",
          detail: !fallbackReady
            ? `${fallback.provider} · key not configured`
            : !fallback.model
              ? `${fallback.provider} · FALLBACK_MODEL not set`
              : sameTarget
                ? `${fallback.provider} · ${fallback.model} · same as the primary`
                : `${fallback.provider} · ${fallback.model}`,
        },
        ...providerKeys.map(({ provider, label }): Check => {
          const ready = isProviderConfigured(provider);
          return {
            label,
            state: ready ? "ready" : "missing",
            detail: ready ? "configured" : "not configured",
          };
        }),
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
