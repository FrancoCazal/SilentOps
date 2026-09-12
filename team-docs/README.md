# team-docs — documentación de los devs de SilentOps

Docs escritos por nosotros, el equipo. Distinto de:

- `dev-docs/` — documentación del starter kit de CopilotKit (heredada, no la editamos).
- `docs/` — material interno de planificación (gitignoreado, no se publica).
- `SILENTOPS.md` — la especificación del producto. **Fuente de verdad del qué.**
- `ESTADO.md` — estado por rol en cada gate. **Se lee antes de tocar nada.**

Estos docs son el **cómo**: quién es dueño de qué archivo, contra qué interfaz
programa cada uno, y dónde están los cruces.

---

## Índice

| Doc | Para quién |
|---|---|
| [`contratos.md`](./contratos.md) | Los cuatro. Las interfaces congeladas y quién produce/consume cada una |
| [`R1-franco-cerebro.md`](./R1-franco-cerebro.md) | Franco — detector, agente, prompts, tools de lectura, evals, fallback |
| [`R2-rodrigo-backend.md`](./R2-rodrigo-backend.md) | Rodrigo — write boundary, Auth0, idempotencia, MCP, adaptador Slack, deploy |
| [`R3-david-superficie.md`](./R3-david-superficie.md) | David — card de aprobación, storyboard, video, submission, post |
| [`R4-ivan-integracion.md`](./R4-ivan-integracion.md) | Ivan — workspace de Ambiguous, `tools:list`, datos sintéticos, golden set, run end to end |

---

## Las cinco reglas de oro

1. **`ESTADO.md` antes de tocar nada.** Si tu línea dice algo distinto de lo que
   estás por hacer, preguntá en el canal primero.
2. **Nadie inventa nombres de tools de Ambiguous.** Salen de
   `npm run tools:list`, que corre Ivan y publica en
   [`ambiguous-tools.md`](./ambiguous-tools.md). Hasta que exista ese archivo,
   toda tool se escribe contra un fake y se marca `TODO(tools:list)`.
3. **Nadie verifica su propio trabajo.** Lo que escribe Franco lo corre Ivan. Lo
   que conecta Rodrigo lo prueba David desde Slack. Lo que arma David lo revisa
   Franco contra el rubro.
4. **Un tier no se abre hasta que el anterior está grabado en video.** Tier 0 es
   solo el handover ausente. Todo lo demás está en los no-goals de
   `SILENTOPS.md` y no se construye, ni "por si acaso".
5. **El modelo no escribe.** Si estás por darle al agente una tool que muta algo,
   pará: va como `propose_action` y la ejecuta el boundary de Rodrigo.

---

## Mapa de propiedad

Regla: **cada rol es dueño de archivos disjuntos.** Cuatro personas en cuatro
ramas sobre archivos distintos no generan conflictos de merge.

```
app/
├── packages/loop-core/src/
│   ├── contracts.ts .................... CONGELADO — los cuatro
│   ├── index.ts ........................ CONGELADO (append-only)
│   ├── channels/
│   │   ├── inbound.ts .................. CONGELADO — los cuatro
│   │   └── outbound.ts ................. CONGELADO — los cuatro
│   ├── approval/
│   │   ├── types.ts .................... CONGELADO — los cuatro
│   │   └── store.ts .................... R2 Rodrigo
│   ├── agent/ .......................... R1 Franco
│   ├── domain/
│   │   ├── prompts.ts .................. R1 Franco
│   │   └── tools.ts .................... R1 Franco
│   ├── model/with-fallback.ts ........... R1 Franco
│   ├── jobs/ ........................... R1 Franco
│   ├── observability/log.ts ............. R1 Franco
│   └── boundary/ ....................... R2 Rodrigo
│       ├── write.ts
│       ├── auth0.ts
│       ├── idempotency.ts
│       └── workplace-mcp.ts
├── packages/loop-core/evals/
│   ├── scripted-model.ts ............... R1 Franco (harness)
│   ├── golden.test.ts .................. R1 Franco (harness)
│   └── golden.json ..................... R4 Ivan (LOS DATOS)
├── apps/channel/src/ ................... carpeta COMPARTIDA, ver abajo
├── apps/web/ ........................... R3 David (tier 2, congelado hoy)
├── SILENTOPS.md ........................ Franco
├── ESTADO.md ........................... Franco
├── SUBMISSION.md ....................... R3 David
├── README.md ........................... R3 David (bloque nuevo) + R4 (quickstart)
└── team-docs/ .......................... Franco
```

### La única carpeta compartida

`apps/channel/src/` la tocan dos personas. **Por archivos distintos, nunca los
mismos:**

| Archivo | Dueño |
|---|---|
| `server.ts`, `agent.ts`, `env.ts` | **R2 Rodrigo** |
| `approval-card.tsx` (nuevo), `components.tsx` | **R3 David** |
| `tools.tsx`, `search.tsx`, `channel.tsx` | heredados del kit — **nadie los edita hoy** |

Si necesitás editar un archivo que no es tuyo: pedilo en el canal, no lo edites.

---

## Ramas y commits

Rama de integración: `main`. **Nadie pushea a `main` salvo Franco.**

| Rol | Rama |
|---|---|
| R1 Franco | `r1/agent` |
| R2 Rodrigo | `r2/backend` |
| R3 David | `r3/surface` |
| R4 Ivan | `r4/integration` |

Flujo, cada 30-45 minutos (no al final):

```bash
git pull --rebase origin main      # traés lo de los demás
npm run verify                     # typecheck + tests, no negociable
git commit -m "r2: el boundary ejecuta workspace.write contra Ambiguous" -- <archivos>
git push origin r2/backend
```

Reglas:

- **Commiteá con pathspec** (`git commit -- <archivos>`), nunca con `git add .`.
  Varios trabajan en paralelo y un `add .` se lleva trabajo ajeno.
- **Prefijo de rol** en el mensaje (`r1:`, `r2:`, `r3:`, `r4:`).
- **Nunca `--force`** sobre una rama que otro pueda haber traído.
- Si `npm run verify` falla, no pushees: arreglalo o avisá.
- Franco mergea a `main` y avisa en el canal cuando lo hizo.

---

## Stack real (verificado en el repo)

- **Node >= 22** (`.nvmrc`), npm workspaces: `packages/*`, `apps/channel`, `apps/web`.
  `apps/mobile` **no** es workspace y hoy no se toca.
- **TypeScript 5.7**, ESM (`"type": "module"`), `tsx` para ejecutar scripts.
- **Tests con `node:test`**, no vitest — es lo que usa el kit. No agregues otro runner.
- **Agente**: `BuiltInAgent` de `@copilotkit/runtime/v2` sobre AI SDK.
  `setDefaultOpenAIClient` y `handoff()` **no existen acá** aunque los docs
  internos los mencionen.
- **Canal**: CopilotKit Channels (Slack managed). Los botones disparan
  (`block_actions`); los **modales no** (`view_submission` no se maneja) y los
  **slash commands no llegan**. Editar una propuesta es responder en el thread.
- **Workspace**: Ambiguous AI vía MCP.
- **Jobs**: Trigger.dev.
- **Auth**: Auth0, scope por acción.

### Comandos

```bash
npm ci                    # una vez
npm run verify            # typecheck + todos los tests (sin red)
npm run first-calls       # los 8 pings de credenciales
npm run tools:list        # tools vivas del MCP de Ambiguous (necesita AMBIGUOUS_API_KEY)
npm run eval              # golden set
npm run dev:slack         # el agente en Slack (necesita CHANNEL_CODE)
npm run channel:status    # estado del canal
npm run dev:web           # la Torre (tier 2, hoy no)
```

---

## Gates de hoy

| Hora | Gate | Qué tiene que ser cierto |
|---|---|---|
| 13:00 | Gate 2 | Ensayo **grabado** del loop completo. Scope congelado. |
| 15:00 | Gate 3 | Feature freeze. El video existe. |
| 16:30 | Entrega | Repo público, video, descripción, post. |

El reloj de los gates lo lleva **Franco**. El run end to end cada 30 minutos lo
lleva **Ivan**. Son dos relojes distintos y los dos tienen que sonar.
