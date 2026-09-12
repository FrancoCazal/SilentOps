# Contratos — las interfaces entre los cuatro

Todo rol programa **contra este archivo**, no contra la implementación del otro.
Mientras respetes tu lado del contrato, el otro puede estar sin terminar y vos
seguís avanzando con un fake.

Los tipos viven en `packages/loop-core/src/contracts.ts` y se importan así:

```ts
import type { InboundEvent, Proposal, ProposedAction, Risk } from "loop-core";
```

**Están congelados.** Cambiarlos requiere acuerdo de los cuatro y aviso en el
canal. Si te falta un campo, primero preguntá si de verdad te falta.

---

## 1. `InboundEvent` — todo lo que entra

`packages/loop-core/src/channels/inbound.ts`

```ts
type InboundEvent = {
  id: string;                    // id del mensaje en el canal de origen; semilla de idempotencia
  channel: "whatsapp" | "voice" | "mail" | "camera" | "cron" | "slack";
  from: { externalId: string; displayName?: string };
  receivedAt: string;            // ISO 8601
  text?: string;                 // texto o transcripción
  attachments?: InboundAttachment[];
  context?: Record<string, unknown>;   // <-- ACÁ VIVE LA TESIS
};
```

El agente **nunca** ve el payload crudo de Slack. Cada adaptador traduce a esto.

### `context` es la tesis del proyecto

Es lo que el canal sabe y un chatbox no. En SilentOps Tier 0 el detector llena:

```ts
context: {
  facility: "Hub Frio Norte",
  shift: {
    name: "Noche", start: "22:00", end: "06:00",
    outgoing: ["Ana"], incoming: ["Bruno"]
  },
  channel: "#operaciones-hub-frio",
  absenceEvidence: {
    expectedRecord: "Handover Noche 2026-09-12",
    searchedIn: "Documents",
    searchedAt: "05:45",
    matches: []                  // <-- la evidencia central del producto
  },
  messagesSinceShiftStart: [ /* ... */ ],
  openWorkOrders: [ /* ... */ ],
  now: "05:45"
}
```

`absenceEvidence` no es opcional y no es cosmética: es **por qué el agente se
despertó**. El modelo nunca recibe un `handoverExists: false` sin explicación.

Convención reservada: `context.editsProposal = "<proposalId>"` marca una
respuesta en el thread de una card que edita una propuesta existente.

### Quién produce `InboundEvent`

| Productor | `channel` | Dueño |
|---|---|---|
| Detector programado `missing-handover` | `"cron"` | **R1 Franco** |
| Adaptador de Slack (menciones y threads) | `"slack"` | **R2 Rodrigo** |

Los dos entran por la misma puerta: `handleEvent(evt)`.

---

## 2. `Proposal` — todo lo que el agente puede decir

`packages/loop-core/src/approval/types.ts`

```ts
type ProposedAction =
  | { kind: "workspace.write"; tool: string; args: Record<string, unknown>; summary: string }
  | { kind: "channel.send"; channel: string; to: string; body: string; summary: string }
  | { kind: "job.schedule"; job: string; runAt: string; payload: Record<string, unknown>; summary: string };

type Proposal = {
  id: string;
  runId: string;              // run del agente; atraviesa logs, card y ejecución
  sourceEventId: string;      // el InboundEvent.id que la originó
  actions: ProposedAction[];
  rationale: string;          // UNA frase, va en la card
  risk: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected" | "edited" | "expired";
  approvedBy?: string;
  editedActions?: ProposedAction[];
  createdAt: string;
  expiresAt: string;
};

effectiveActions(p)   // las editadas ganan a las originales. USALA SIEMPRE.
```

En `workspace.write`, `tool` es el **nombre exacto de la tool del MCP de
Ambiguous**. No se inventa: sale de `ambiguous-tools.md`.

`Proposal` es **serializable y viaja entera** hasta la card. Si la card necesita
algo para pintarse, tiene que estar acá dentro — no se resuelve leyendo otra
cosa.

---

## 3. `OutboundChannel` — todo lo que sale

`packages/loop-core/src/channels/outbound.ts`

```ts
interface OutboundChannel {
  name: string;
  send(to: string, body: string, opts: { idempotencyKey: string }): Promise<{ externalId: string }>;
}

registerOutbound(channel)     // se registra al arrancar el proceso
outbound("slack").send(...)   // se usa desde el boundary
```

`idempotencyKey` no es opcional: un reenvío no puede duplicar un mensaje.

---

## 4. El write boundary — el único camino a una escritura

`packages/loop-core/src/boundary/write.ts` (R2 Rodrigo)

```ts
executeApproved(proposal)            // ejecuta effectiveActions, verifica scope, deduplica
registerWorkspaceExecutor(fn)        // quién ejecuta workspace.write
registerJobScheduler(fn)             // quién ejecuta job.schedule
SCOPE                                // mapa acción -> scope de Auth0
```

**Nadie más escribe.** No hay otra función que mute algo en Ambiguous ni que
mande un mensaje. Si aparece una segunda, el proyecto perdió su argumento
central y con él los puntos del criterio 3.

Scopes por tipo de acción:

| Acción | Scope de Auth0 |
|---|---|
| `workspace.write` | `write:workspace` |
| `channel.send` | `send:channel` |
| `job.schedule` | `schedule:job` |

---

## 5. La tabla de cruces

Quién produce y quién consume. Si tu columna "consumís" no está lista, usá un
fake y seguí — no esperes a nadie.

| Interfaz | Produce | Consume | Fake mientras no exista |
|---|---|---|---|
| Lista de tools de Ambiguous | **R4 Ivan** (`tools:list`) | R1 (tools de lectura), R2 (executor) | Nombres `TODO(tools:list)` + handler que devuelve fixture |
| `InboundEvent` desde cron | **R1 Franco** | R1 (`handleEvent`), R4 (run e2e) | JSON a mano en `evals/golden.json` |
| `InboundEvent` desde Slack | **R2 Rodrigo** | R1 (`handleEvent`) | El detector, que ya emite eventos |
| Lectura por MCP (ver abajo) | **R2 Rodrigo** | R1 (handlers de `domain/tools.ts`) | Handler que devuelve fixture |
| `Proposal` | **R1 Franco** | R3 (card), R2 (ejecución) | `Proposal` literal hardcodeada en la card |
| Click en Aprobar → `executeApproved` | **R3 David** dispara, **R2 Rodrigo** ejecuta | — | `executeApproved` con executor fake que loguea |
| Datos sintéticos del hub | **R4 Ivan** | R1 (prompts), R3 (video) | Los del `SILENTOPS.md` |
| Run end to end verde | **R4 Ivan** | los cuatro | — |

---

## 6. El puerto de lectura — RESUELTO

**El camino de LECTURA por MCP no estaba en los contratos.** `workplace-mcp.ts`
expone `ambiguousExecutor` (escritura) y `listWorkplaceTools` (listado), pero el
detector y los handlers de `domain/tools.ts` necesitan **leer**: roster del turno,
búsqueda de documentos, historial del canal, órdenes abiertas.

Se resolvió sin esperar a nadie: **R1 declara el puerto, R2 registra la
implementación.** Mismo patrón que `registerWorkspaceExecutor` en
`boundary/write.ts`, así que no se tocó ningún archivo congelado.

Vive en `packages/loop-core/src/domain/workspace-reader.ts` (dueño R1):

```ts
export type WorkspaceReader = (tool: string, args?: Record<string, unknown>) => Promise<unknown>;

registerWorkspaceReader(fn)      // R2 llama esto al arrancar el proceso
readTool(tool, args)             // lo que consumen el detector y las tools
fixtureReader(fixtures)          // para evals y desarrollo
isWorkspaceReaderRegistered()
```

### Implementación real

```ts
import { createAmbiguousWorkspaceReader } from "./boundary/ambiguous-reader";
import { registerWorkspaceReader } from "./domain/workspace-reader";

// Al arrancar el proceso que ejecuta el detector:
registerWorkspaceReader(createAmbiguousWorkspaceReader());
```

`boundary/ambiguous-reader.ts` ya implementa el adaptador y usa solo seis tools
MCP de lectura. Su mapeo y el comando de prueba están en
[`ambiguous-tools.md`](./ambiguous-tools.md). Sin scope de escritura y sin
idempotencia: es lectura.

### La regla que no se puede romper

**`readTool` TIRA si no hay lector registrado, y `fixtureReader` tira si falta un
fixture.** Es deliberado. Devolver vacío sería peor que fallar: el detector leería
ese vacío como "el handover no existe" e inventaría una ausencia. Siendo la
ausencia la evidencia central del producto, un falso vacío no es un bug menor —
es el producto mintiendo.

Si implementás el lector MCP y no hay credenciales, fallá ruidosamente. Nunca
devuelvas `[]`.

### Los nombres de las tools

Viven en **un solo lugar**: la constante `TOOLS` de
`packages/loop-core/src/domain/tools.ts`, hoy con placeholders `TODO_`. Cuando
R4 publique `ambiguous-tools.md`, es reemplazar cuatro strings.

---

## 7. Qué NO está en los contratos y no se agrega hoy

- Segundo detector (pedidos sin respuesta).
- Wiki de decisiones.
- WhatsApp, Telegram, Teams, voz.
- Torre de control (`apps/web`).
- Cualquier tool que el modelo pueda llamar para escribir.

Todo eso está en los no-goals de `SILENTOPS.md`. Si alguien lo necesita para que
su parte funcione, es señal de que su parte se salió de scope.
