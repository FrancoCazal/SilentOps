# ESTADO

Una linea por rol. Se actualiza en cada gate (10:00, 11:30, 13:00, 15:00).
Los coding agents leen este archivo antes de tocar nada.

_Ultima actualizacion: 14:35._

| Gate | Hora | Estado |
|---|---|---|
| Contratos congelados | 10:00 | base tipada lista; confirmacion del equipo pendiente |
| Gate 1 (evento real -> Ambiguous -> salida) | 11:30 | **cerrado en codigo, sin correr en vivo**: detector -> agente -> card -> `executeApproved` estan cableados en `apps/channel/src/silentops.tsx` y verdes offline. Nadie lo corrio todavia contra Slack + Ambiguous reales |
| Gate 2 (ensayo grabado, scope congelado) | 13:00 | **no superado** — sigue sin haber un write aprobado end to end ni un solo plano filmado |
| Gate 3 (feature freeze) | 15:00 | pendiente — el freeze significa "video filmado", y el video no empezo |
| Entrega | 16:30 | pendiente |
| **Freeze final (confirmado por David)** | **16:45** | ventana real de trabajo: 2h10 desde las 14:35 |

**Verificacion (14:29):** `npm run verify` verde — typecheck limpio y 182 tests
(agent-core 37, loop-core 47, channel 64, web 34), 0 fallas, sin red.

**Tema elegido:** **SilentOps — continuidad para operaciones criticas de cadena de frio.** Un detector determinista y auditable encuentra un handover tecnico ausente entre guardias; el agente prepara, con fuentes, el documento, las reasignaciones y el aviso en Slack para aprobacion humana. Especificacion: [`SILENTOPS.md`](./SILENTOPS.md) — dentro del repo publico, es la fuente de verdad. La copia interna en `../docs/silentops-facilities.md` queda como material de equipo y no se publica.

**Recorte obligatorio:** Tier 0 es solo el handover ausente. No construir deteccion ambient, seguimiento automatico, Wiki de decisiones, WhatsApp, Torre de control ni segundo flujo antes de que el loop completo este verificado y grabado.

---

- **R1 Franco (agente, evals, fallback, jobs):** parcial fuerte — prompts SilentOps, detector determinista, cuatro lecturas de dominio y 15 golden cases listos. El detector cubre el caso negativo (handover existente → `null`) y preserva la evidencia de ausencia. **Fallback de provider verificado** con test hermético de 10 casos: `FORCE_PROVIDER_FAILURE=1` completa el mismo run por el secundario y deja el salto en el log, un 400 propio no se reintenta, y `resolveFor` no fuga el entorno. 47 tests en `loop-core`. **Huecos:** que el runtime de canal invoque el detector, y correr el loop una vez con modelo real (`EVAL_MOCK=0 npm run eval -w loop-core`) — los prompts todavía no vieron un LLM, solo el modelo scripted.
- **R2 Rodrigo (canales, boundary, Auth0):** parcial — en `main`: `boundary/write.ts`, `auth0.ts`, `idempotency.ts`, `workplace-mcp.ts` y el lector real `boundary/ambiguous-reader.ts`, testeados con fakes. En `origin/r2/backend` (12d7ab1, **sin mergear**) ya hay writer de Ambiguous (`silentops.*` -> `create_document`/`update_task`), `bootstrapBoundary` registrando el lector, canal SilentOps en Slack y `Aprobar -> approveAndExecute`. Falta mergear y reconciliarlo con la superficie de R3.
- **R3 David (Slack, card, relato):** **parcial fuerte — la superficie existe.**
  - `apps/channel/src/approval-card.tsx` + `approval-card.test.tsx`: card de
    handover con **evidencia antes de propuesta**. `absenceLine()` imprime
    `⌕ searched Documents for "..." at 05:45 → 0 results`, asi que `matches: []`
    se lee como afirmacion y no como hueco. Bullet sin fuente se marca
    `⚠ sin fuente` en vez de maquillarse. `Aprobar` -> `confirmApproval` ->
    `onApprove` (unica salida a escritura); `Rechazar` no escribe.
    `handoverPresentNotice()` cubre el plano del agente **callado** cuando el
    handover ya existe.
  - `apps/channel/src/silentops.tsx` + `silentops.test.tsx`: la costura del loop
    (`detectMissingHandover` -> `handleEvent` -> card -> `executeApproved`),
    `boundaryFor()` registra el ejecutor de Ambiguous y el outbound del thread, y
    `channel.tsx` hace que una mencion reproduzca el detector (solo smoke test de
    desarrollo, no es la deteccion proactiva del demo). Este archivo pisa
    territorio de R2: **acordar con Rodrigo antes de mergear.**
  - `apps/web/src/app/landing/` (`page.tsx`, `landing.module.css`,
    `approval-states.tsx`) + `Console approval states mockup/`: landing y estados
    de la card como material visual para el video y el repo.
  - **Huecos:** nada esta commiteado (todo untracked sobre `main`, sin rama
    `r3/surface`); **el video no empezo** (es el entregable que mas puntua);
    `SUBMISSION.md` **cerrado** (titulo + 4 bloques de descripcion + aportes de
    sponsors); `README.md` raiz **abre como SilentOps** (bloque arriba del
    starter kit); post de redes sin preparar.
- **R4 (integracion, datos, verificacion):** parcial fuerte — key de Ambiguous validada, catálogo de 856 tools inspeccionado, workspace demo sembrado (canal, calendario, 3 documentos, 3 OT) y detector real probado a las 05:45. Mapeo y comando reproducible: [`team-docs/ambiguous-tools.md`](./team-docs/ambiguous-tools.md). No usar datos de personas ni controlar equipos físicos.

---

## Riesgos abiertos a las 14:35

1. **El video no existe.** El jurado es global y asincronico: no ve la demo en
   vivo. Con freeze final 16:45, el ultimo momento razonable para empezar a
   filmar es 15:45 (queda edicion, subtitulos, subida y post).
2. **Dos cableados del canal en paralelo.** `origin/r2/backend` (12d7ab1) ya trae
   card y `approveAndExecute` en `apps/channel`, y local hay `silentops.tsx`
   sobre `main`. Si no se reconcilia, se duplica el camino de escritura —
   justo la invariante que el video vende.
3. **Nada corrio con LLM real ni con Slack real.** Todo lo verde es offline con
   modelo scripted y fakes. **No hay `.env` en la maquina de David**: todo script
   vivo usa `node --env-file=../../.env` y falla al arrancar. Esa credencial
   desbloquea cuatro de los siete planos del video.
4. **`SUBMISSION.md` afirma Trigger.dev y el repo no lo tiene.** No hay
   dependencia de Trigger.dev en el `package.json` raiz, ni en `loop-core`, ni en
   `channel`; el disparo real hoy es `npm run silentops:detect` mas el replay por
   mencion. O R2 conecta `registerJobScheduler` a un scheduler en proceso, o hay
   que reescribir la linea. Una afirmacion de sponsor sin respaldo cuesta mas que
   un sponsor menos.
5. **Los `onClick` de la card se rutean solo en proceso.** Si el runtime se
   reinicia entre que la card se postea y alguien la aprieta, el boton deja de
   responder sin decir nada. Mitigacion de hoy: no reiniciar el proceso durante el
   ensayo; si un boton no responde, repostear la card en vez de debuggear.

---

## Como retomar en frio

```bash
npm ci                  # una vez
npm run verify          # typecheck + tests + golden set (con mock, sin red)
npm run dev:slack       # el agente en Slack (necesita CHANNEL_CODE)
npm run tools:list -w loop-core   # tools vivas de Ambiguous (necesita AMBIGUOUS_API_KEY)
$env:SILENTOPS_DEMO_AT = '2026-09-12T05:45:00-03:00'
npm run silentops:detect -w loop-core  # prueba real, solo lectura
```
