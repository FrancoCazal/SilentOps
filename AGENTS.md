# Notes for coding agents

> **Equipo Club de Programacion FIUNA — leer esto primero.**
>
> Orden de lectura: este archivo -> `ESTADO.md` -> `docs/core-hackathon.md` ->
> la seccion de tu rol en `docs/equipo-hackathon.md` -> la seccion del tema en
> `docs/temas-hackathon.md`. (`docs/` esta gitignoreado: es material interno.)
>
> ## Lo que construimos nosotros: `packages/loop-core`
>
> El kit resuelve modelo, Exa, MCP de Ambiguous y Slack. Nuestra capa es el
> loop de aprobacion: canal -> agente -> propuesta -> persona -> write boundary.
>
> ```
> packages/loop-core/src/
>   contracts.ts        CONGELADO 10:00. InboundEvent, Proposal, OutboundChannel.
>   agent/              handleEvent(): evento -> Proposal. Nunca ejecuta.        (R1)
>   domain/             prompts.ts y tools.ts. Lo UNICO que cambia con el tema.  (R1)
>   model/              withFallback(): OpenAI <-> OpenRouter.                   (R1)
>   boundary/           write.ts, auth0.ts, idempotency.ts, workplace-mcp.ts.    (R2)
>   channels/           inbound.ts, outbound.ts + adaptadores del tema.          (R2)
>   approval/           store.ts + la card de Slack.                             (R3)
>   jobs/               follow-ups y expiracion.                                 (R1)
>   evals/              golden.json + harness con modelo scripted.               (R1/R4)
> ```
>
> ## Las cuatro invariantes (si tu cambio rompe una, no va)
>
> 1. Ninguna accion irreversible sale sin aprobacion humana. La unica salida del
>    agente es la tool `propose_action`, que es una tool de AG-UI: el agente
>    literalmente no puede ejecutarla.
> 2. Toda escritura pasa por `boundary/write.ts`, que verifica scope de Auth0 y
>    aplica idempotency key. Si escribis en Ambiguous o mandas un mensaje desde
>    otro archivo, es un bug.
> 3. Todo llamado a modelo pasa por `withFallback`.
> 4. `npm run verify` antes de cada commit.
>
> ## Reglas de convivencia
>
> - Cada rol es dueño de sus carpetas. No toques la de otro: pedilo en el canal.
> - `contracts.ts` se congela a las 10:00 y cambia solo por acuerdo de los cuatro.
> - **Nunca inventes nombres de tools de Ambiguous.** Salen del workspace vivo:
>   `npm run tools:list -w loop-core`.
> - El documento `core-hackathon.md` asume `@openai/agents` (Agent, run, handoff,
>   setDefaultOpenAIClient). **El kit no usa ese SDK**: usa `BuiltInAgent` de
>   `@copilotkit/runtime/v2` con modelos del AI SDK. Cuando el doc y el codigo
>   discrepen, gana el codigo.
> - Los globs de `--test` van entre comillas DOBLES. Con comillas simples,
>   cmd.exe no expande nada y `npm test` pasa en verde sin correr un solo test.

---

Read [hackathon-overview.md](hackathon-overview.md), [hackathon-rules.md](hackathon-rules.md), and [using-sponsor-tools.md](using-sponsor-tools.md), then the chosen app README in `apps/channel`, `apps/web`, or `apps/mobile`. Build the team's own workflow; the incident app is infrastructure reference code.

CopilotKit powers the Slack and web templates. The mobile starting point in `apps/mobile` has its own install and environment; follow its README for setup and checks.

For setup, follow [CopilotKit onboarding](README.md#copilotkit-onboarding) after choosing an app. For Slack, run `npm run channel:setup -- --no-clipboard` and continue with the emitted prompt and installed `channels-setup` skill. For web/mobile, explain the model-only and Intelligence options before starting the official `onboard start` workflow. Preserve the chosen app and its working behavior; do not scaffold over this checkout or provision every template. Use current CLI instructions instead of copying authentication and provisioning steps from memory.

Read `.agents/skills/build-channels-agent/SKILL.md` before touching anything in
`apps/channel/`. It carries the verified API surface; the most common
failure mode in this codebase is inventing a plausible-looking Channels API.

Hard-won rules that are easy to get wrong here:

- **`@ag-ui/client` must stay deduped.** The root `package.json` pins it via
  `overrides` to the exact version `@copilotkit/runtime` declares. Two copies
  produce two `AbstractAgent` types and every `createChannel({ agent })` fails
  on a private `_debug` property. If you bump `@copilotkit/runtime`, re-check
  `npm ls @ag-ui/client` and update the override.
- **`@copilotkit/channels` and `@copilotkit/runtime` are a tested pair.** Bump
  together, keep them exact.
- **Files containing JSX must be `.tsx`**, and the tsconfig must set
  `jsxImportSource: "@copilotkit/channels"`. This is not React.
- **`maxSteps` defaults to 1** on `BuiltInAgent`. Any agent with tools needs more,
  or it calls one tool and stops before seeing the result.
- **Do not add `identifyUser` to `CopilotRuntime`.** It belongs on
  `createChannel`, and must be absent on a Channels-only runtime.
- **Handlers return `void`.** `thread.post()` returns a `MessageRef`, so a
  concise arrow body fails under `strict`. Use a block body and `await`.
- **Never invent a component or prop.** The vocabulary is fixed — see
  `references/ui-components.md` in the skill.
- Run `npm run typecheck` before claiming anything works.
