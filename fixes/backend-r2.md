# fixes/backend-r2 — errores, riesgos y verificaciones del backend

Bitácora de R2 (Rodrigo). Una línea por hallazgo. Se actualiza en cada commit.
Regla: **nada se arregla en silencio**. Si algo se cierra, queda el commit; si
queda abierto, queda el dueño y cómo verificarlo.

Convenciones: `sev` = alta (rompe la demo o el argumento del producto) ·
media (rompe un caso o degrada) · baja (deuda, cosmética).
`Estado` = ✅ cerrado · 🔧 en curso · ⏳ abierto · ❌ descartado (no era bug).

---

## 1. Abiertos, por severidad

| # | sev | Dónde | Qué pasa | Cómo se arregla / verifica | Dueño | Estado |
|---|---|---|---|---|---|---|
| F-01 | **alta** | `evals/golden.json`, `domain/prompts.ts` | Las propuestas `workspace.write` usan tools que **no existen** en Ambiguous: `TODO_docs_create` con `args.bullets`, `TODO_work_order_assign` con `assignee: "Bruno"`. Las reales son `create_document` (`required: type`; cuerpo Markdown en `content`) y `update_task` (`required: id` UUID; `assignee_id` UUID). Una propuesta aprobada hoy rebota en el MCP con "Tool not found". | **Lado R2 hecho** (`boundary/ambiguous-writer.ts`, registrado por defecto en `bootstrapBoundary`): acepta las intenciones `silentops.create-handover`, `silentops.reassign-work-order`, `silentops.annotate-work-order` (y los alias `TODO_docs_create` / `TODO_work_order_assign` con aviso en el log) y las traduce a `create_document` / `update_task`; descarta bullets sin fuente; recorta a 5; no crea dos veces el mismo título; valida cualquier tool real contra lista blanca + catálogo vivo + `required`. **Falta el lado R1:** que `propose_action` / `DOMAIN_BRIEF` nombren las intenciones (ver §6) y que `golden.json` use `silentops.*` en vez de `TODO_*`. Probado contra el workspace real (§4). | R2 ✅ · R1 ⏳ | 🔧 |
| F-02 | **alta** | Workspace Ambiguous (`list_users`) | Hay **un solo usuario** (Franco). "Ana" y "Bruno" no existen como usuarios, así que `update_task.assignee_id` no puede apuntar a Bruno. | (b) implementado como fallback visible en el writer: si el nombre no resuelve a un usuario, `update_task` agrega a la descripción `Responsable turno entrante: Bruno (reasignado por SilentOps con aprobacion humana, <ISO>)` sin tocar `status`, y el resultado dice `via: description-note`. Si Ivan invita a Ana y Bruno como usuarios, pasa solo a `via: assignee_id`. Decidir cuál se muestra en el video. | R4 (decisión) | 🔧 |
| F-03 | **alta** | SDK Channels (`thread.d.ts`) | "Proactive delivery to subscribed conversations is not yet wired": el proceso **no puede publicar** en un canal donde nadie mencionó al bot. | Flujo de demo: una mención a `@silentops` en `#operaciones-hub-frio` **arma la vigilancia** del hilo; el detector programado publica ahí. Contarlo así en el video: el arme es configuración humana, la detección es el cron. | R3 (relato) + R1 (spec) | ⏳ avisar |
| F-04 | media | `agent/index.ts` `buildProposal` | Genera un `id` nuevo por corrida. Si el detector corre dos veces para el mismo turno hay dos propuestas y la idempotency key (que incluye `proposalId`) no deduplica. | Mitigado en el canal: `liveProposalFor(eventId)` bloquea una segunda propuesta viva. Fix real: `id` derivado de `sourceEventId` o dedup en `approval/store.save`. | R1 | ⏳ |
| F-05 | media | Spec "post the handover link in Slack" | El `channel.send` lo redacta el modelo **antes** de ejecutar, así que no puede contener el link del documento que se crea recién al aprobar. | **Resuelto en el writer:** `create_document` y `get_document` no traen URL, pero `search_workspace` sí (relativa: `/docs/<id>`). Tras crear, el writer busca el doc por título, toma su `url` y la vuelve absoluta con `AMBIGUOUS_APP_URL` (default `https://app.ambiguous.ai`). Queda en `result.url` para la card y para el aviso. **Ivan: confirmar con el navegador que `https://app.ambiguous.ai/docs/<id>` abre el doc**; si la base es otra, setear `AMBIGUOUS_APP_URL` en `.env`. | R2 ✅ · R4 confirma | 🔧 |
| F-06 | media | Credenciales (`npm run first-calls`: 2/8) | Faltan `OPENAI_API_KEY`, `OPENROUTER_API_KEY` (sin las dos no hay demo de fallback), `AUTH0_*`, `INTELLIGENCE_API_KEY` + `CHANNEL_CODE`. `EXA` y `TRIGGER` no hacen falta para Tier 0. | Ivan: keys de modelo. Rodrigo: Auth0. David: `npm run channel:setup`. | R4 / R2 / R3 | ⏳ |
| F-07 | media | `boundary/write.ts` | `remember(key)` se guarda **después** de que el executor termina. Si el proceso muere entre ambos, un reintento duplica esa acción. | Aceptable hoy. Fix: write-ahead ("intent" antes, "done" después) y reconciliar leyendo el workspace, como hace `apps/web/src/lib/server/workplace.ts`. | R2 | ⏳ baja prioridad |
| F-08 | media | `jobs/followup.ts` | Los jobs programados (`job.schedule`) viven en memoria; un reinicio los pierde. Trigger.dev no está y **no hace falta** para Tier 0 (el detector corre en proceso en `silentops-channel.tsx`). | Si se usa `job.schedule` en la demo, persistir igual que propuestas (`file-store`). | R1 | ⏳ |
| F-09 | baja | `silentops-channel.tsx` (card provisoria) | La card de aprobación es de R2 y provisoria. | R3 la reemplaza por `approval-card.tsx` manteniendo: el marcador `proposal:<uuid>` en el texto, y que Aprobar llame **solo** a `approveAndExecute` (riesgo alto: segundo click con `confirmHighRisk: true`). | R3 | ⏳ |
| F-10 | baja | `silentops-channel.tsx` | Editar una propuesta respondiendo en el hilo (`context.editsProposal`) se detecta y se registra, pero no convierte el texto en acciones editadas (fuera de Tier 0). | Post-Tier 0: agente que reescribe `editedActions` + `applyEdit`. | R1/R2 | ⏳ |
| F-11 | baja | `silentops-channel.tsx` salida `slack` | `channel.send` publica en el hilo de la propuesta en ejecución o en el vigilado, e ignora `to`. Alcanza para un solo canal. | Si hay más canales: mapa `to` → hilo. | R2 | ⏳ |
| F-12 | baja | Brief R2 punto 6 / `team-docs` | Pide ngrok o Cloud Run. **No hace falta**: Channels managed abre un websocket saliente desde el proceso. Deploy = mantener el proceso vivo. | Corregir el doc. | R1 | ⏳ |
| F-13 | baja | Node 24 en Windows | Al morir con excepción no capturada, libuv tira `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`. No afecta el camino feliz. `.nvmrc` pide 22. | `nvm use 22` si molesta. | — | ⏳ |
| F-18 | **alta** | `agent/index.ts` `buildProposal`/`toAction`, `agent/propose-tool.ts`, `evals/golden.test.ts` | **Primer run con modelo real (Gemini 2.5 Flash, 15:00): 14/15 golden fallan.** Diagnóstico con g01: el modelo llama `propose_action` (ok) pero el payload viene sin `tool` porque ningún prompt le da nombres de escritura, y `toAction` descarta la acción **en silencio** → `actions: 0`. Además el harness real no registra lector: `shift_roster` y `search_documents` fallan (`ok:false`). | R2 (hecho): `boundary/write-vocabulary.ts` con el vocabulario `silentops.*`; el canal lo inyecta vía `handleEvent(evt, { prompt: withWriteVocabulary(systemPrompt()) })`. R1 (pendiente): (1) poner el mismo vocabulario en `propose-tool.ts` o `DOMAIN_BRIEF` para que el eval lo tenga; (2) que `toAction` loguee `action dropped: payload sin tool` en vez de callar; (3) en `golden.test.ts` con `EVAL_MOCK=0` registrar `fixtureReader` armado desde `caso.event.context` (shift, messagesSinceShiftStart, openWorkOrders, búsqueda vacía). | R1 | 🔧 |
| F-16 | **alta** | Ambiguous `search_workspace` (lo usa el detector de Franco y lo usaba mi writer) | **Devuelve documentos que están en la papelera, sin `trashed_at`.** Verificado: el doc de prueba borrado con `documents_delete` seguía apareciendo en `search "r2 smoke test"`. Consecuencia: si alguien crea un `Handover Noche 2026-09-12` de prueba y lo manda a la papelera, el detector lo sigue encontrando y **no dispara**: la demo muere en silencio. | (1) R1: en `ambiguous-reader.ts` `documentSearch`, cruzar los hits con `list_documents` (trae `trashed_at`) y descartar los borrados, o usar `list_documents` directo por título. (2) Regla de equipo: un handover de prueba se borra con `documents_permanent_delete`, no con `documents_delete`. (3) Mi writer ya busca duplicados en `list_documents` (commit siguiente). | R1 (detector) + equipo (regla) | ⏳ **urgente** |
| F-17 | baja | `team-docs/ambiguous-tools.md` (R1) | Tras el fix de F-16 en `ambiguous-reader.ts`, la tabla dice "seis tools" y que la existencia del handover sale solo de `search_workspace`. Ahora son siete: la búsqueda cruza con `list_documents` y descarta hits sin `trashed_at === null`. | Franco actualiza la fila "Existencia del handover": `search_workspace` + `list_documents`, "conserva solo hits cuyo id aparece en el listado con trashed_at null". | R1 | ⏳ |
| F-15 | baja | Ambiguous `get_document` sobre un doc en papelera | Devuelve `An error occurred while executing the tool` (genérico) en vez de "trashed". El writer no lo necesita, pero un `readTool` sobre un doc borrado va a fallar sin explicar por qué. | Tratar ese error como "no disponible" donde se lea por id. | R2 | ⏳ |
| F-14 | baja | `scripts/first-calls.ts` | Sale con código 1 si falta cualquier credencial, incluidas las que Tier 0 no usa (Exa, Trigger.dev). Confunde en CI. | Marcar opcionales como "omitida" en vez de "FALLA". | R1 | ⏳ |

## 2. Descartados (no eran bug)

| # | Dónde | Por qué se pensó | Por qué no lo es |
|---|---|---|---|
| D-01 | `model/with-fallback.ts` `resolveFor` | Muta `process.env` y lo restaura; con dos eventos concurrentes podrían cruzarse de provider. | `resolveModel()` es **síncrono** y no hay `await` entre el set y el `finally`: en un solo hilo de Node no puede interferir otro evento. El test de Franco lo cubre. |

## 3. Cerrados (con commit)

| # | Dónde | Qué pasaba | Fix | Commit |
|---|---|---|---|---|
| C-01 | `boundary/workplace-mcp.ts` | El cliente MCP envolvía `fetch` y perdía el `Content-Type`: Ambiguous respondía **415** y ninguna llamada real funcionaba. | `requestInit: { headers: { Authorization } }`, igual que el cliente de `apps/web`. (Franco aplicó el mismo fix en paralelo.) | `f9f46c3`, merge `0d4ece1` |
| C-02 | `boundary/auth0.ts` / `write.ts` | El bypass `ALLOW_UNVERIFIED_WRITES=1` dejaba pasar sin rastro. | Log `AUTH0 BYPASS` por ejecución y `scope verified {verified:false}` por acción. | `f9f46c3` |
| C-03 | `approval/store.ts`, `idempotency.ts` | Todo en memoria: un reinicio entre propuesta y aprobación perdía la propuesta y la garantía de no duplicar. | `file-store.ts`: JSON con escritura atómica en `.data/loop-core` (`LOOP_STATE_DIR`), activado por `bootstrapBoundary`. | `f9f46c3`, `d833dc8` |
| C-04 | `boundary/workplace-mcp.ts` | Cliente MCP cacheado sin recuperación: si caía el transporte quedaba roto para siempre. | `invalidateOnTransient`: descarta el cliente ante ECONNRESET/ETIMEDOUT/timeout y reconecta. | `f9f46c3` |
| C-05 | `boundary/write.ts` | No había una sola entrada para el botón Aprobar; la card tendría que hacer setStatus + token + execute. Sin gate para riesgo alto. | `approveAndExecute(id, by, {confirmHighRisk})`, `rejectProposal`, `HighRiskError`. Un segundo click sobre `approved` reintenta sin duplicar. | `f9f46c3` |
| C-06 | Contrato de lectura (§6) | Faltaba el camino de lectura por MCP. | Franco declaró el puerto (`domain/workspace-reader.ts`); R2 lo registra en `bootstrapBoundary` con `createAmbiguousWorkspaceReader()`. Mi lectura cruda se llama `callReadTool`. | `0d4ece1`, `44522ae` |
| C-07 | `apps/channel` | Seguía corriendo el demo de incidentes del kit; nada conectado al loop. | `silentops-channel.tsx` + `inbound-slack.ts` + `server.ts` con `bootstrapBoundary()` y el detector en proceso. `channel.tsx` del kit intacto. | `d219c34`, `9c2d64b` |

## 4. Verificaciones del backend (bitácora)

Formato: hora local · comando · resultado · qué prueba.

| Hora | Comando | Resultado | Prueba |
|---|---|---|---|
| 12:45 | `npm run tools:list -w loop-core` | 856 tools | El transporte MCP funciona tras C-01. |
| 13:30 | script `callReadTool` (whoami, docs, tasks, users, tool inexistente) | OK; tool inexistente → `Error: Tool ... not found` | Lectura cruda y fallo visible. |
| 13:35 | inventario del workspace | docs: Activos, Reglas, `Handover Tarde 2026-09-11`; **no existe** `Handover Noche 2026-09-12`; 3 OT; canal `#operaciones-hub-frio` | La ausencia que detecta el producto es real. |
| 13:50 | `npm run first-calls` | 2/8: Ambiguous REST y MCP OK | Estado de credenciales (F-06). |
| 13:52 | `SILENTOPS_DEMO_AT=2026-09-12T05:45:00-03:00 npm run silentops:detect -w loop-core` | `detected: true`, id `missing-handover:Noche:2026-09-12`, 3 mensajes, 3 OT | Detector real + lector registrado, sin modelo y sin escribir. |
| 13:55 | `npm run tools:list -w loop-core -- --full` | schemas de `create_document`, `update_task`, `send_message`, `documents_delete` | Base para F-01. |
| 13:58 | `smoke-write.mts` (scratchpad): `bootstrapBoundary` + `executeApproved` con `silentops.create-handover` + `channel.send`, `ALLOW_UNVERIFIED_WRITES=1` | Doc `r2 smoke test 16:58 — borrar` creado en Ambiguous (Markdown → ProseMirror, labels `silentops,handover`), bullet sin fuente descartado y logueado; **reenvío: `skipped: [true, true]`, un solo mensaje**; `idempotency.json` y `proposals.json` escritos; log `AUTH0 BYPASS` visible en cada ejecución | **Criterio de aceptación de R2 cumplido**: una escritura aprobada aterriza en el workspace real y un reenvío no duplica. |
| 13:58 | reasignación en seco (`call` falso) | `OT-243 → Bruno`: `update_task {id: acdb2aaf…, description: …Responsable turno entrante: Bruno…}` (`via: description-note`). `TASK-001 → Franco`: `update_task {id: d7430b96…, assignee_id: ce351aba…}` (`via: assignee_id`) | Resolución de OT por prefijo/task_key y de usuario por nombre; fallback F-02. |
| 14:02 | `documents_delete` + `documents_trash_list` + `list_documents` | Doc de prueba en papelera; los 4 docs sembrados intactos | Limpieza (parcial, ver siguiente). |
| 14:10 | `search_workspace {query:"r2 smoke test", modules:["docs"]}` con el doc ya en papelera | **1 resultado**, sin `trashed_at`; keys: `id, title, module, type, icon, url, snippet, score`; `url` = `/docs/<id>` | Origen de F-16 y de la URL para F-05. `search "Handover Noche 2026-09-12"` → 0 (la ausencia sigue intacta). |
| 14:12 | `documents_permanent_delete` sobre el doc de prueba, `documents_trash_list`, `search_workspace` | search → 0 resultados, papelera vacía, 4 docs sembrados intactos | **Limpieza definitiva verificada.** |

## 5. Checklist del run end to end real

1. `.env`: `AMBIGUOUS_API_KEY` ✅ · `OPENAI_API_KEY` + `OPENROUTER_API_KEY` ⏳ · `AUTH0_DOMAIN/AUDIENCE/CLIENT_ID/CLIENT_SECRET` ⏳ · `INTELLIGENCE_API_KEY` + `CHANNEL_CODE` ⏳ · `SILENTOPS_DEMO_AT=2026-09-12T05:45:00-03:00`.
2. `npm run verify` verde y `npm run first-calls` con lo de arriba en OK.
3. `npm run dev:slack` → log `boundary bootstrapped {workspace: ambiguous, reader: ambiguous, auth0: configured}`.
4. En Slack, en `#operaciones-hub-frio`: `@silentops vigilá esta guardia` → card "Vigilancia armada".
5. `@silentops detectar` (smoke) o esperar el tick → card de propuesta con la evidencia verbatim.
6. Aprobar → card de resultado; en Ambiguous aparece el documento y las OT actualizadas; en Slack el aviso.
7. Repetir el paso 5 con el mismo reloj: **no** sale segunda propuesta (dedupe por evento). Reiniciar el proceso y volver a aprobar: todo `skipped` (idempotencia persistida).
8. `FORCE_PROVIDER_FAILURE=1` y repetir: el mismo run completa por OpenRouter y el log muestra el salto.

## 6. Para R1 (Franco): el vocabulario de escritura que el modelo tiene que usar

El boundary ya acepta esto. Falta que el prompt lo diga (hoy `propose_action` deja `payload.tool` libre y el modelo inventa nombres).

Texto sugerido para `propose-tool.ts` (descripción de `payload`) o para `DOMAIN_BRIEF`:

```
workspace.write: { tool, args } donde tool es UNA de estas intenciones (nunca un nombre de tool del proveedor):
- "silentops.create-handover": args { title: "Handover <Turno> <AAAA-MM-DD>", bullets: [{ text, source }], openWorkOrders?: ["OT-243 · Revisar burlete · Muelle 3"], shift?: { name, start, end, outgoing, incoming }, summary? }.
  Cada bullet lleva source (id de mensaje u OT). Un bullet sin source se descarta. Máximo cinco.
- "silentops.reassign-work-order": args { id: "OT-243", assignee: "Bruno", note? }. Nunca cierra la orden; solo cambia el responsable.
- "silentops.annotate-work-order": args { id: "OT-243", note }.
```

Golden: reemplazar `TODO_docs_create` → `silentops.create-handover` y `TODO_work_order_assign` → `silentops.reassign-work-order` (los alias siguen funcionando, pero con aviso en el log). Los `args` de los mocks ya tienen la forma correcta (`title`, `bullets[{text,source}]`, `id`, `assignee`).
