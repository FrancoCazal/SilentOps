# R3 — David · la superficie y el relato

**Juicio que aportás:** cómo se ve, cómo se aprueba y cómo se cuenta.

**Rama:** `r3/surface` · **Prefijo de commit:** `r3:`

---

## Por qué tu rol es el que más puntúa

Un dato de la página oficial del hackathon que cambia la estrategia del día:

> *"Judging: One global pool, one rubric, and one central finalist process.
> **Local demos are for the room, not separate competitions.**"*

El puntaje sale de un jurado **global y asincrónico** que evalúa título,
descripción, repo público y video de 2 minutos. **Nadie que puntúa va a ver la
demo en vivo en el aula B1.**

Consecuencia directa: el video y el repo **son** el proyecto a efectos del
puntaje. Todo lo que funcione y no se vea en el video, no existe. Y el feature
freeze de las 15:00 no significa "la app anda", significa **"el video está
filmado"**.

---

## Tu dominio

```
apps/channel/src/
├── approval-card.tsx                TUYO — NUEVO, la card de aprobación
└── components.tsx                   TUYO

apps/web/                            TUYO — Torre de control (TIER 2, HOY CONGELADO)

app/
├── SUBMISSION.md                    TUYO
└── README.md                        TUYO (el bloque de arriba)

assets/                              TUYO — storyboard, planos, imagen de arquitectura
```

**No tocás:** `server.ts`, `agent.ts`, `env.ts` de `apps/channel` (Rodrigo),
`boundary/` (Rodrigo), `agent/`, `domain/`, `jobs/`, `evals/` (Franco), ni los
archivos congelados.

En `apps/channel/src/` compartís carpeta con Rodrigo **por archivos distintos**.
Si necesitás algo de `server.ts`, pedíselo; no lo edites.

---

## 1. La card de aprobación

Recibís un `Proposal` completo y serializable. **Todo lo que necesitás para
pintar está adentro** — no leas nada más:

```ts
type Proposal = {
  id, runId, sourceEventId,
  actions: ProposedAction[],
  rationale: string,          // UNA frase
  risk: "low" | "medium" | "high",
  status, approvedBy, editedActions, createdAt, expiresAt
};

effectiveActions(p)   // las editadas ganan a las originales. USALA SIEMPRE.
```

### Lo que la card muestra, en este orden

**Primero la evidencia de la ausencia. Después la propuesta.** El orden importa:
es lo que distingue a este agente de un bot de notificaciones.

```
┌─────────────────────────────────────────────────────────┐
│  Turno Noche cierra 06:00 · Ana sale, Bruno entra       │
│                                                          │
│  ⌕  searched Documents for                               │
│     "Handover Noche 2026-09-12" at 05:45  →  0 results   │
│                                                          │
│  ─────────────────────────────────────────────────────   │
│                                                          │
│  Propuesta · riesgo medio                                │
│  <rationale, una frase>                                  │
│                                                          │
│  • <bullet 1>                        ↗ fuente            │
│  • <bullet 2>                        ↗ fuente            │
│  ... (máximo 5)                                          │
│                                                          │
│  Órdenes que se reasignan a Bruno:                       │
│  • #<id> <título>                                        │
│                                                          │
│  [ Aprobar ]   [ Rechazar ]                              │
└─────────────────────────────────────────────────────────┘
```

**La regla más importante de tu parte:** `matches: []` es la evidencia central del
producto y un array vacío **se ve como nada**. Tenés que renderizarlo como una
afirmación explícita —`searched Documents for "..." at 05:45 → 0 results`—, no
como un espacio en blanco. Si eso queda flojo, la innovación no se lee y el
proyecto pierde el punto que más vale.

Cada bullet lleva link a su fuente (el mensaje del canal o la orden de trabajo).
Si un bullet no tiene fuente, es un bug de Franco: avisale, no lo maquilles.

### Los botones

`[Aprobar]` llama a **`executeApproved(proposal)`**, la función de Rodrigo. Y
nada más. **No hay un segundo camino de escritura**: la card no escribe en
Ambiguous ni manda mensajes por su cuenta. Esa es la garantía que el video vende.

### Restricciones reales de Slack (Channels managed)

- Los botones **sí** disparan (`block_actions`).
- **Los modales no funcionan** (`view_submission` no se maneja). No diseñes con modal.
- **Los slash commands no llegan.** Nada de `/comandos`.
- Editar una propuesta es **responder en el thread** ("cambiá el dueño a Ana").
  Eso vuelve a entrar como evento y la card se actualiza.

---

## 2. El video de 2 minutos — tu entregable más valioso

Empezalo **ahora**, no a las 15:30. Podés filmar planos del "lugar" antes de que
el software funcione.

### Guion

| Tiempo | Plano | Qué se ve |
|---|---|---|
| 0:00–0:12 | **El libro de guardia con el hueco** | El ledger del turno: entradas a las 22:10, 23:40, 01:15... y después nada. La fila del handover requerido, visiblemente ausente: `Handover: missing` |
| 0:12–0:20 | La tesis | *"Critical facilities do not fail only when equipment breaks. They fail when the next shift does not know what is still open."* |
| 0:20–0:30 | La búsqueda vacía | El detector buscando el documento y no encontrándolo. **Nadie escribió un mensaje. Nadie preguntó. No hubo evento.** Decilo en voz alta |
| 0:30–1:20 | **Una secuencia sin cortes** | Card con evidencia + propuesta → una persona aprueba → el documento aparece en Ambiguous → las órdenes cambian de responsable → el link en Slack |
| 1:20–1:32 | **El fallback** | `FORCE_PROVIDER_FAILURE=1`: el proveedor principal falla y el mismo run termina por el secundario. **No se corta por tiempo** |
| 1:32–1:45 | Arquitectura | Una imagen: el modelo solo emite `propose_action`; toda escritura cruza el boundary con scope de Auth0 e idempotencia |
| 1:45–2:00 | Cierre | *"SilentOps never controls equipment or decides safety. It prepares a sourced handover for the responsible human to approve."* + nombre del equipo y repo |

### Las tres frases que no se improvisan

Copialas textual, no las parafrasees. Están calibradas contra el rubro:

1. **La imposibilidad** (criterio 2, el 5 pide *"could not be reproduced in a
   standalone chatbox"*):
   > *"A standalone chat cannot wake at the expected shift boundary, query for the
   > required record and preserve that chain of evidence."*

2. **El control** (criterio 4 pide *"clear and controllable"*):
   > *"The agent has no write access. Everything you just saw was approved by the
   > technician going off shift."*

3. **El límite** (lo que evita que el jurado piense que decide cosas críticas):
   > *"SilentOps never controls equipment or decides safety."*

### Dos jugadas que casi nadie hace y suben el puntaje

- **Mostrá al agente NO disparando.** Un caso donde el handover ya existe y el
  agente se queda callado. Prueba control mejor que diez aprobaciones, y responde
  la primera objeción del jurado: *"¿y si molesta todo el tiempo?"*
- **La aprobación como firma de salida.** El que sale de turno aprueba: es el
  gesto que ya hacía igual. Eso es literalmente *"native to its environment"*,
  palabra por palabra del criterio 4. Decilo.

### Producción

- **Casting:** alguien tiene que ser "Ana", la supervisora que sale de turno y
  aprieta Aprobar. Definilo antes de filmar.
- **Subtítulos:** el Slack va en castellano (`#operaciones-hub-frio`) y la voz
  probablemente en inglés. Sin subtítulos, un jurado que no habla español pierde
  la mitad.
- **Audio:** revisalo. Un video de 2 minutos con audio malo se puntúa peor que uno
  sin voz.
- **Nada clínico ni de seguridad en pantalla.** Ni pacientes, ni medicación, ni
  umbrales de temperatura, ni afirmaciones de que un producto está apto. Sí:
  número de activo, orden de trabajo, turno, sector, técnico.
- **Revisá cada frame por secretos** antes de subir: un token en una terminal
  visible arruina la entrega.

---

## 3. `SUBMISSION.md` y el post

### La descripción

Cuatro bloques que ya están esbozados en `SUBMISSION.md` y hay que cerrar:
qué construiste, para quién, por qué importa el contexto, y qué tecnologías de
sponsors usaste con su contribución visible.

Nombrá los sponsors por su aporte real, no por cantidad —el rubro dice explícito
que la cuenta de sponsors **no** es un criterio:

- **CopilotKit** — Channels para la superficie de Slack con aprobación.
- **Ambiguous AI** — el workspace es el sistema de registro: turnos, documentos,
  órdenes de trabajo, vía MCP, en lectura y escritura.
- **Trigger.dev** — no es decoración: el cron **es** el disparador del producto.
- **Auth0** — el scope que el boundary verifica antes de cada escritura.
- **OpenAI / OpenRouter** — modelos, con fallback entre proveedores demostrado en
  el video.

La sección *inherited vs. built* la escribe Franco: es un riesgo de
**elegibilidad** por ser fork de un template, y él sabe exactamente qué escribió.

### El post en redes

Requisito **formal** de entrega y la víctima clásica de las 16:25. Preparalo a
las **15:00**, no a las 16:20. Linkea el repo y el video, y taggeá a los partners
según las instrucciones del organizador.

---

## 4. `README.md` — lo primero que abre un jurado

Hoy es el README del starter kit de CopilotKit: le dice al jurado que esto es una
plantilla ajena, justo el riesgo que `SUBMISSION.md` intenta cubrir. Ahora que el
repo se llama **SilentOps**, el contraste es peor.

Un bloque arriba, cinco líneas: qué es SilentOps, la frase de la imposibilidad,
link a [`SILENTOPS.md`](../SILENTOPS.md) y al video. Ivan verifica que el
quickstart corra desde un clone limpio.

---

## Tus cruces

| Con quién | Qué le das | Qué necesitás de él |
|---|---|---|
| **Franco (R1)** | Feedback si un bullet llega sin fuente | La `Proposal` con `absenceEvidence` en el contexto |
| **Rodrigo (R2)** | El click de Aprobar → `executeApproved(proposal)` | Que el boundary ejecute de verdad; que el adaptador de Slack ande |
| **Ivan (R4)** | La lista de planos que necesitás para filmar | Los datos sintéticos del hub y el ledger con el hueco |

**Si te bloqueás:** no esperes a nadie. Hardcodeá un `Proposal` literal en la card
y pintala completa; filmá los planos del "lugar" (el ledger, el canal, el
workspace) antes de que el loop funcione. Esos planos son la mitad del video y no
dependen de una sola línea de backend.

---

## Primeros 15 minutos

```bash
cd C:\Users\franc\Desktop\HackathonAITSL2026\app
git checkout -b r3/surface
npm run verify
npm run channel:setup      # si el canal de Slack todavía no está
npm run dev:slack          # necesita CHANNEL_CODE
```

Después, en paralelo: card con un `Proposal` hardcodeado, y el storyboard con los
planos del ledger.

---

## Definición de hecho

- La card se ve, muestra **la evidencia antes de la propuesta**, y el botón dispara
  `executeApproved`.
- `matches: []` se lee como una afirmación explícita, no como un espacio vacío.
- **El video está filmado** e incluye el plano del fallback.
- La descripción del submission está completa y el post preparado a las 15:00.
- El README abre diciendo qué es SilentOps.
