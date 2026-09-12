# Guión del video (2 minutos)

Dos versiones: **A** con Slack (si `channel:setup` llega a tiempo) y **B** por terminal + Ambiguous (funciona hoy, verificado 9/9). Las dos cuentan lo mismo. Grabar pantalla con audio; hablar en inglés o subtitular.

## Preparación (5 minutos antes)

```powershell
# 1. Workspace limpio: NO debe existir "Handover Noche 2026-09-12" (ni en papelera)
npm run silentops:detect -w loop-core        # debe decir detected: true
# 2. .env: MODEL_PROVIDER=google, MODEL=gemini-2.5-flash, SILENTOPS_DEMO_AT=2026-09-12T05:45:00-03:00
#    AUTH0_* cargados (permisos tildados) o, si no, AUTH0_DOMAIN vacío para correr en bypass
npm run first-calls
# 3. Abrir en el navegador, pestañas listas: Ambiguous (Docs y Tasks del workspace SilentOps) y, en A, Slack #operaciones-hub-frio
```

## Versión B: terminal + Ambiguous

| Tiempo | Pantalla | Qué se dice |
|---|---|---|
| 0:00–0:15 | Ambiguous, Docs: se ve `Handover Tarde 2026-09-11` y **no** hay `Handover Noche 2026-09-12`. Tasks: OT-241, OT-242, OT-243 abiertas, responsable Ana. Chat: `#operaciones-hub-frio` con los mensajes del turno. | "Critical facilities do not fail only when equipment breaks. They fail when the next shift does not know what is still open. It is 05:45. Ana's night shift ends at 06:00. The handover document that should exist does not." |
| 0:15–0:45 | Terminal: `npm run silentops:rehearse -w loop-core -- --keep`. Se ve `== 3) Detector real ==` con `handover ausente`, `absenceEvidence ... matches: []`, y `== 4)` con la card en texto: `searched Documents for "Handover Noche 2026-09-12" at 05:45 -> 0 results` y las acciones propuestas. | "A deterministic detector, no LLM, reads the roster and searches Documents. It records the absence as evidence, verbatim: searched, where, when, zero results. Only then the agent reads the channel and the open work orders and proposes: a sourced handover, the reassignments, the notice. It can only propose. Its single tool is propose_action." |
| 0:45–1:15 | Terminal: `== 5) Aprobacion y ejecucion ==` → `handover document created`, `url`, `work order reassigned`. Cambiar a Ambiguous: refrescar Docs → aparece `Handover Noche 2026-09-12`; abrirlo: bullets con fuente, "Trabajo abierto que pasa al turno entrante". Tasks: OT-243 con "Responsable turno entrante: Bruno (reasignado por SilentOps con aprobación humana)". | "A human approves. Every write crosses one boundary: an Auth0 scope per action and an idempotency key derived from the event. The document lands in the workspace with its sources; a bullet without a source never enters. The work orders change owner; none is closed." |
| 1:15–1:35 | Terminal: `== 7) Reenvio ==` → `skipped=[true,true,true,true]`. | "Replay the same approval: nothing is written twice. The state is on disk, so a restart does not change that." |
| 1:35–1:50 | Terminal: `FORCE_PROVIDER_FAILURE=1 npm run silentops:rehearse -w loop-core -- --dry` → log `primary provider failed, switching provider` y el run termina. (Si Auth0 sin permisos: mostrar en cambio `FALLA: missing scope write:workspace` como camino de falla.) | "Failure path: the primary model provider fails and the same run completes on the fallback. And without the right scope, the boundary refuses and writes nothing." |
| 1:50–2:00 | Ambiguous con el documento abierto. | "SilentOps never controls equipment or decides safety. It prepares a sourced handover for the responsible human to approve. Built on CopilotKit, Ambiguous AI and Auth0 at Agents, Everywhere." |

Después de grabar: purgar el handover de prueba (dos pasos) para que el detector vuelva a disparar:
`node --env-file=.env --import tsx` sobre `documents_delete` + `documents_permanent_delete`, o volver a correr el ensayo sin `--keep` (limpia solo).

## Versión A: Slack (misma narración, otra pantalla)

1. `npm run dev:slack` → log `boundary bootstrapped {auth0: configured|bypass}`.
2. Slack, `#operaciones-hub-frio`: `@silentops vigilá esta guardia` → card "Vigilancia armada".
3. Esperar el tick del detector (1 minuto) o `@silentops detectar` (la card dice `replay de desarrollo`).
4. Card de David: evidencia de ausencia, propuesta, riesgo. Click **Aprobar** → card de resultado con el link del documento; mostrar Ambiguous.
5. Segundo click / `@silentops detectar` de nuevo → no hay segunda propuesta.
6. `FORCE_PROVIDER_FAILURE=1` y repetir el paso 3.

## Frases que NO se dicen
- Que el agente decide si un producto es seguro, o que opera equipos.
- Que la mención es la detección del producto (es un replay de desarrollo; el disparo real es el detector programado).
- Números de tests o de tools que no se muestren en pantalla.
