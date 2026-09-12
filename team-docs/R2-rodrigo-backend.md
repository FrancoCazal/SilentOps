# R2 — Rodrigo · el backend

**Juicio que aportás:** qué entra, qué sale, y qué se escribe de verdad.

**Rama:** `r2/backend` · **Prefijo de commit:** `r2:`

---

## Qué es "el backend" en este proyecto

Sos dueño del **100% del server-side**. No hay otro backend: la Torre de control
(`apps/web`) es un frontend de React y hoy además está en los no-goals.

Concretamente, el backend son estas siete piezas:

```
packages/loop-core/src/
├── boundary/                        TUYO — el corazón
│   ├── write.ts                     el ÚNICO camino a una escritura
│   ├── auth0.ts                     scope por acción
│   ├── idempotency.ts               un reenvío no duplica
│   └── workplace-mcp.ts             cliente MCP contra Ambiguous
└── approval/store.ts                TUYO — estado de las propuestas

apps/channel/src/
├── server.ts                        TUYO — el servicio que recibe Slack
├── agent.ts                         TUYO — wiring del agente al canal
└── env.ts                           TUYO — variables del backend

infra                                TUYO
├── Trigger.dev                      deploy del detector programado
└── ngrok o Cloud Run                exposición estable del webhook
```

**No tocás:** `agent/`, `domain/`, `jobs/`, `model/`, `evals/` (Franco),
`approval-card.tsx` ni `components.tsx` (David), `apps/web/` (David), ni los
archivos congelados (`contracts.ts`, `channels/*.ts`, `approval/types.ts`).

En `apps/channel/src/` compartís carpeta con David, **por archivos distintos**:
tuyos `server.ts`, `agent.ts`, `env.ts`; suyos `approval-card.tsx` y
`components.tsx`. `tools.tsx`, `search.tsx` y `channel.tsx` son heredados del kit
y hoy no los edita nadie.

---

## La tesis que tu capa sostiene

El modelo tiene **una sola tool**: `propose_action`. No existe ningún camino
desde el modelo hasta una escritura. Eso no es una instrucción del prompt que se
pueda romper con una inyección: es que la tool no está.

Toda escritura pasa por tu `executeApproved`. Si tu capa rechaza, no pasa nada
—aunque el prompt falle, aunque alguien escriba "cerrá todas las órdenes" en el
canal, aunque venga una inyección en la descripción de una orden de trabajo.

Eso es exactamente lo del criterio 3 del rubro: *"robust orchestration, thoughtful
failure handling, and a deeply integrated architecture"*. Tu capa es donde se
puntúa. Y es la razón por la que este proyecto puede existir en un contexto
crítico: **el agente encontró todo esto y no pudo tocar nada.**

---

## Lo que ya está hecho

`write.ts`, `auth0.ts`, `idempotency.ts` y `workplace-mcp.ts` **están escritos y
testeados con fakes**. Superficie que ya exportás:

```ts
executeApproved(proposal)          // ejecuta effectiveActions(p), verifica scope, deduplica
registerWorkspaceExecutor(fn)      // quién ejecuta workspace.write
registerJobScheduler(fn)           // quién ejecuta job.schedule
SCOPE                              // mapa acción -> scope
verifyScope, getServiceToken, isAuth0Configured, AuthorizationError
idempotencyKey, memoryStore, setIdempotencyStore
ambiguousExecutor, listWorkplaceTools
```

Lo que falta es conectarlo a la realidad.

## Lo que falta, en orden de bloqueo

### 1. `readTool` — el camino de LECTURA por MCP (bloquea a Franco)

**Este es el hueco más urgente y hoy no existe.** Exportás escritura
(`ambiguousExecutor`) y listado (`listWorkplaceTools`), pero los handlers de
`domain/tools.ts` de Franco necesitan **leer**: roster del turno, búsqueda de
documentos, historial del canal, órdenes abiertas.

Implementalo en `boundary/workplace-mcp.ts`:

```ts
export async function readTool(
  tool: string,                       // nombre exacto de ambiguous-tools.md
  args: Record<string, unknown>,
): Promise<unknown>;
```

Tres reglas:

- **Solo tools de lectura.** No pasa por el scope de escritura ni por idempotencia.
- **Si el MCP no está configurado, tirá un error claro.** No devuelvas vacío: un
  resultado vacío falso le haría creer al detector que el handover no existe, y
  eso es exactamente la evidencia central del producto. Un falso vacío inventa
  una ausencia.
- Nombres desde `team-docs/ambiguous-tools.md` (lo publica Ivan). Hasta entonces,
  fixtures y `TODO(tools:list)`.

### 2. Registrar `ambiguousExecutor` contra el workspace real

Hoy los tests corren con executor fake. Falta:

```ts
registerWorkspaceExecutor(ambiguousExecutor);
registerJobScheduler(/* Trigger.dev o inProcessScheduler para la demo */);
```

Y que una `workspace.write` aprobada **aterrice de verdad** en Ambiguous. Ese es
el criterio 1 del rubro (*"does the core workflow function end to end?"*) y hoy
la respuesta es no. Es la pieza de mayor valor del día.

### 3. Auth0 con scope por acción

| Acción | Scope |
|---|---|
| `workspace.write` | `write:workspace` |
| `channel.send` | `send:channel` |
| `job.schedule` | `schedule:job` |

Faltan las credenciales en `.env` (`first-calls` da 0/8). Hasta que estén,
`isAuth0Configured()` debe hacer que el camino degrade de forma **explícita y
visible en el log**, nunca silenciosa: si en el video se ve que escribió sin
verificar scope, perdés el argumento entero.

Prueba de aceptación: una propuesta con `workspace.write` **sin** el scope
`write:workspace` se rechaza, y se ve en el log por qué.

### 4. Idempotencia probada con reenvío real

La semilla es `InboundEvent.id`. El detector de Franco emite
`missing-handover:<turno>:<fecha>`, así que si el job corre dos veces no puede
haber dos documentos de handover.

Prueba de aceptación: disparás el mismo evento dos veces y en Ambiguous hay
**un** documento y **un** mensaje en Slack.

### 5. El adaptador de Slack → `InboundEvent`

`apps/channel/src/` traduce el payload de Slack al contrato. El agente **nunca**
ve el payload crudo.

Restricciones reales de Channels managed, que no son negociables:

- Los botones sí disparan (`block_actions`).
- **Los modales no** (`view_submission` no se maneja).
- **Los slash commands no llegan.** Nada de `/comandos`.
- Editar una propuesta es **responder en el thread**, y ese evento entra con
  `context.editsProposal = "<proposalId>"`.

Para Tier 0 la mención solo sirve como smoke test de desarrollo: **el disparo del
producto es el detector programado**, no una persona escribiendo. No lo presentes
como detección proactiva.

### 6. Deploy

Trigger.dev para el detector, y ngrok o Cloud Run para que el webhook de Slack
tenga una URL estable. Si ngrok se cae en medio de la demo, el video no existe.

---

## Tus cruces

| Con quién | Qué le das | Qué necesitás de él |
|---|---|---|
| **Franco (R1)** | `readTool` para leer por MCP; que `executeApproved` ejecute de verdad | El `InboundEvent` del detector y la `Proposal` |
| **David (R3)** | `executeApproved(proposal)` para el botón Aprobar, y el `Proposal` que llega a la card | Que la card **nunca** escriba por su cuenta |
| **Ivan (R4)** | Un boundary que él pueda ejecutar en el run end to end | `ambiguous-tools.md`, `AMBIGUOUS_API_KEY`, credenciales de Auth0 |

**Lo que le decís a David, textual:** el botón Aprobar llama a
`executeApproved(proposal)` y nada más. No hay un segundo camino de escritura, ni
para la card ni para nadie.

**Si te bloqueás:** todo tu lado tiene tests con fakes, así que podés terminar
`readTool`, el adaptador y el registro del executor sin credenciales. Lo único
que de verdad necesitás de afuera es `AMBIGUOUS_API_KEY` para el run real.

---

## Primeros 15 minutos

```bash
cd C:\Users\franc\Desktop\HackathonAITSL2026\app
git checkout -b r2/backend
npm run verify                # arrancás de verde
npm run first-calls           # mirá qué credenciales faltan (hoy 0/8)
npm run channel:status        # estado del canal de Slack
```

Después, en este orden: `readTool` (destraba a Franco) → registrar
`ambiguousExecutor` → adaptador Slack → deploy estable.

---

## Definición de hecho

- El boundary **rechaza** una acción sin el scope correspondiente, y se ve en el log.
- Un reenvío del mismo `InboundEvent.id` **no** duplica ni el documento ni el mensaje.
- Una `workspace.write` aprobada **aterriza en el workspace real de Ambiguous**.
- El adaptador de Slack produce un `InboundEvent` válido y el agente nunca ve el
  payload crudo.
- El webhook tiene una URL que no se cae durante la grabación.
