# TODO — R3 (David) · superficie SilentOps

Lo que está construido, lo que falta, y **qué de eso está bloqueado por llaves
que no tengo**. El principio de este archivo: nada de mi parte espera una
credencial para poder verse o testearse.

> Actualizado después de que Rodrigo (R2) landeara `src/silentops.tsx`: el wiring
> ya **no** es un bloqueo. Lo único que falta para verlo en Slack son credenciales.

---

## Estado

| Pieza | Estado | Bloqueado por |
|---|---|---|
| `apps/channel/src/approval-card.tsx` | ✅ hecho · typecheck + tests verdes | — |
| `apps/channel/src/approval-card.test.tsx` | ✅ 19 tests offline, sin credenciales | — |
| Preview en Block Kit (`npm run preview:card -w channel`) | ✅ hecho, sin credenciales | — |
| Wiring detector → agente → card → boundary | ✅ **hecho por Rodrigo** (`silentops.tsx`, `channel.tsx:60`) | — |
| La card posteada en un thread real de Slack | 🟡 **desbloqueado** — las keys están en `.env` | correrlo y verificarlo |
| El click de Aprobar escribiendo de verdad en Ambiguous | 🟡 `AMBIGUOUS_API_KEY` está; Auth0 no (corre con bypass) | prueba end to end |
| Plano del fallback del video | ⛔ **roto** — falta un 2º provider | `OPENAI_API_KEY` u `OPENROUTER_API_KEY` |
| Video de 2 minutos | ⏳ en progreso | nada — se puede filmar con el preview |
| Bloque SilentOps arriba del `README.md` | ✅ hecho · + cómo ver la card sin credenciales | — |
| `SUBMISSION.md` (4 bloques) | ⏳ pendiente | nada |
| Post en redes | ⏳ pendiente (preparar 15:00) | nada |

Verificado: `npm run typecheck -w channel` → exit 0 · `npm test -w channel` → **56 tests, 0 fail**.

---

## 1. Credenciales que necesito y no tengo

**Dueño: Ivan (R4).** Su doc dice `.env  TUYO — coordinar las 8 credenciales`, y
en su tabla de prioridades la fila 2 nombra explícitamente mi card:

> `| 2 | CHANNEL_CODE (Slack) | el adaptador de Rodrigo y la card de David |`

Ivan **coordina**, pero cada dueño de cuenta carga su bloque.

### Estado REAL, verificado leyendo `.env` (nombres, no valores)

**Ya están, no hay que pedirlas:** `CHANNEL_CODE`, `INTELLIGENCE_API_KEY`,
`AMBIGUOUS_API_KEY`, `GOOGLE_API_KEY`.
→ **`npm run dev:slack` se puede correr AHORA.**

| Falta | Para qué | A quién |
|---|---|---|
| `OPENAI_API_KEY` **o** `OPENROUTER_API_KEY` (una sola alcanza) | **el plano del fallback del video** | Ivan (R4), prioridad 3 |
| `AUTH0_DOMAIN` + `AUTH0_AUDIENCE` | que el boundary verifique scope de verdad | Rodrigo (R2) — hoy corre con `ALLOW_UNVERIFIED_WRITES=1` |

### 🚨 El plano del fallback está ROTO (verificado, no supuesto)

Con el `.env` actual, corriendo `withFallback` offline:

```
primary        : google
fallback hop to: openai
  configured openai      : false
  configured openrouter  : false
  configured google      : true
```

`FORCE_PROVIDER_FAILURE=1` tumba el primario, salta a **openai**, que **no tiene
key**, y muere con `OPENAI_API_KEY is required`. El comentario del propio código
lo anticipa: *"the resulting '<KEY> is required' is the honest explanation"*.

**El video mostraría un crash, no una supervivencia** — y ese plano es
obligatorio en el guion (1:20–1:32) y es la evidencia del criterio 3.

Dos salidas:

1. **Conseguir `OPENROUTER_API_KEY` u `OPENAI_API_KEY`.** El salto google → ese
   provider funciona y el plano vuelve a ser real. **Ojo:** `FALLBACK_MODEL` está
   en `gemini-2.5-flash`; si el fallback pasa a OpenAI/OpenRouter hay que poner un
   id de ESE provider, o el salto le pide a OpenAI un modelo de Gemini.
2. **No filmar el fallback ni reclamarlo.** Se pierde el punto del criterio 3.
   `SUBMISSION.md` ya quedó redactado con la verdad por si queda así.

```bash
npm run first-calls      # ¿cuántas de las 8 hay?
npm run channel:status   # ¿el Channel está online?
```

---

## 2. Wiring — ✅ ya está (no es mío, es de Rodrigo)

`src/silentops.tsx` es el seam donde se juntan las cuatro etapas, y
`channel.tsx` lo dispara:

```
detectMissingHandover()  → la ausencia + su evidencia (determinista, sin LLM)
handleEvent()            → el modelo, cuya única salida es propose_action
handoverApprovalCard()   → MI CARD: evidencia primero, propuesta después
executeApproved()        → el único camino de escritura, tras el click humano
```

Mi card recibe `onApprove: boundaryFor(thread, log)` → `executeApproved(...)`.
La invariante se mantiene: la card no escribe nada por su cuenta.

Bonus que aporta el seam y me sirve para el video:

- **`SILENTOPS_DEMO_AT`** — replaya el borde de turno de 05:45 a cualquier hora.
  Un valor inválido lanza error en vez de evaluar el instante equivocado.
  ```bash
  $env:SILENTOPS_DEMO_AT = '2026-09-12T05:45:00-03:00'
  ```
- **El caso silencioso ya está en el runtime**: si el detector no dispara,
  `runHandover` postea "Sin acción" y no muestra ningún botón.

### ✅ Trampa del video — ARREGLADA

`channel.tsx` dispara el detector **por @mention**, y `SILENTOPS.md` es explícito:
una mención manual replaya el detector **sólo como smoke test de desarrollo** y
**no se puede presentar como la detección proactiva del producto**.

**Arreglado.** El origen ahora viaja hasta la card: `channel.onMention` pasa
`origin: "manual-replay"` y la card **se etiqueta sola**:

```
⚙︎ replay de desarrollo · disparado por mención, no por el borde de turno
```

Un frame filmado por accidente ya no puede confundirse con el disparo real. La
etiqueta sale en la card, en el aviso silencioso y en el "Sin acción". Cubierto
por 3 tests, incluido uno que verifica que el camino del detector **no** la lleva.

**Igual, para el video:** filmar el disparo por cron / `SILENTOPS_DEMO_AT`, no por
mención. La etiqueta es una red de seguridad, no un permiso.

### ✅ Durabilidad / clicks viejos — DECIDIDO Y ARREGLADO DONDE IMPORTA

Dos correcciones a lo que decía antes:

1. **No falla en silencio.** Sin store durable, un click sobre una card posteada
   antes de un reinicio degrada a **"action expired"** (`hitl-patterns.md`). Malo,
   pero visible.
2. **Había un bug real detrás, y era mío.** La card ignoraba
   `proposal.expiresAt`. Una card vieja en el thread conserva los botones vivos, y
   `executeApproved` **sólo mira el status, no la expiración**. `expireOverdue()`
   existe en `approval/store.ts` pero muta la copia del store, no la que la card
   capturó en su closure. Resultado: un click tardío **escribía igual**.

**Decisión: no implementar store durable.** El skill lo dice explícito — *"for a
demo or a short-lived prompt, in-memory is fine"*. El arreglo real exige convertir
la card en componente registrado (`defineChannelComponent` + props serializables,
o sea sacar `proposal`/`onApprove` del closure) más un `StateStore` propio, y eso
es cirugía sobre el seam que Rodrigo acaba de dejar verde, a dos horas de la
entrega. Mala relación riesgo/beneficio.

**En cambio se cerró el agujero en la puerta de aprobación** (`approval-card.tsx`):

- `isExpired(p, now)` — una `expiresAt` ilegible cuenta como vencida (fallar del
  lado seguro).
- `confirmApproval` devuelve `ApprovalOutcome` y **no llama al boundary** si la
  ventana cerró o la propuesta ya fue decidida. Nada se escribe en una negativa.
- `refusedNotice` lo dice en la card: *"Sin acción. La ventana de aprobación ya
  venció. **No se escribió nada.**"*
- La card muestra la ventana: `válida hasta 06:30`.
- Doble click / doble decisión: se niega en vez de escribir dos veces.

Cubierto por 8 tests nuevos.

**Verificado que NO rompe el ensayo:** `buildProposal` (en `agent/index.ts`) sella
`createdAt`/`expiresAt` con `new Date()` — reloj de pared, **no** el instante
replayado. Con `SILENTOPS_DEMO_AT=05:45` la propuesta vence a *ahora + ttl*, así
que se puede aprobar a las 14:30 sin problema. (Lo que sí vence es el fixture del
preview, que nadie aprieta.)

Queda vivo: si el proceso se reinicia entre postear y aprobar, el botón responde
"action expired". Mitigación de hoy: **no reiniciar el proceso en ese intervalo**;
si pasa, reposteá la card.

---

## 3. Lo que puedo hacer sin una sola credencial

```bash
# ver la card exactamente como la renderiza Slack:
npm run preview:card -w channel
# → escribe apps/channel/preview/*.json
# → pegar 01-pending.json en https://app.slack.com/block-kit-builder
# → screenshot para el video

npm test -w channel        # 56 tests, 0 fail
npm run typecheck -w channel
```

Los cuatro estados del preview son los planos del video:

| Archivo | Plano del video |
|---|---|
| `01-pending.json` | la card con evidencia de ausencia + propuesta (0:30–1:20) |
| `02-approved.json` | la aprobación como firma de salida |
| `03-rejected.json` | control: se puede rechazar y no se escribe nada |
| `04-silent.json` | el agente que **no** dispara (handover ya existe) |

---

## 4. Pendientes míos sin bloqueo

- [x] Bloque SilentOps arriba del `README.md` (qué es, la frase de la
      imposibilidad, links a `SILENTOPS.md` y `SUBMISSION.md`, y el preview de la
      card sin credenciales). **Falta sólo pegar el link del video.**
- [ ] `SUBMISSION.md`: los 4 bloques. La sección *inherited vs. built* la escribe
      Franco (riesgo de elegibilidad por ser fork de un template).
- [ ] Filmar: ledger con el hueco, búsqueda vacía, card, aprobación, fallback
      (`FORCE_PROVIDER_FAILURE=1`), arquitectura, cierre.
- [ ] Subtítulos (el canal está en castellano, la voz probablemente en inglés).
- [ ] Revisar cada frame por secretos antes de subir.
- [ ] Post en redes preparado **a las 15:00**, no a las 16:20.

---

## 5. Higiene

- `apps/channel/preview/` es salida generada — no hace falta commitearla.
- Datos del preview: sintéticos. Sin personas reales, sin temperaturas, sin
  afirmaciones de que un producto está apto.
- Nunca commitear `.env`.
