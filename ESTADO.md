# ESTADO

Una linea por rol. Se actualiza en cada gate (10:00, 11:30, 13:00, 15:00).
Los coding agents leen este archivo antes de tocar nada.

| Gate | Hora | Estado |
|---|---|---|
| Contratos congelados | 10:00 | base tipada lista; confirmacion del equipo pendiente |
| Gate 1 (evento real -> Ambiguous -> salida) | 11:30 | parcial: detector lee Ambiguous real y emite el evento; faltan card/aprobación/write de SilentOps en el canal |
| Gate 2 (ensayo grabado, scope congelado) | 13:00 | **no superado** — el loop de lectura corre contra Ambiguous real, pero no hay nada grabado: falta la card de aprobación y el write aprobado end to end |
| Gate 3 (feature freeze) | 15:00 | pendiente |
| Entrega | 16:30 | pendiente |

**Tema elegido:** **SilentOps — continuidad para operaciones criticas de cadena de frio.** Un detector determinista y auditable encuentra un handover tecnico ausente entre guardias; el agente prepara, con fuentes, el documento, las reasignaciones y el aviso en Slack para aprobacion humana. Especificacion: [`SILENTOPS.md`](./SILENTOPS.md) — dentro del repo publico, es la fuente de verdad. La copia interna en `../docs/silentops-facilities.md` queda como material de equipo y no se publica.

**Recorte obligatorio:** Tier 0 es solo el handover ausente. No construir deteccion ambient, seguimiento automatico, Wiki de decisiones, WhatsApp, Torre de control ni segundo flujo antes de que el loop completo este verificado y grabado.

---

- **R1 Franco (agente, evals, fallback, jobs):** parcial fuerte — prompts SilentOps, detector determinista, cuatro lecturas de dominio y 15 golden cases listos. El detector cubre el caso negativo (handover existente → `null`) y preserva la evidencia de ausencia. **Fallback de provider verificado** con test hermético de 10 casos: `FORCE_PROVIDER_FAILURE=1` completa el mismo run por el secundario y deja el salto en el log, un 400 propio no se reintenta, y `resolveFor` no fuga el entorno. 47 tests en `loop-core`. **Huecos:** que el runtime de canal invoque el detector, y correr el loop una vez con modelo real (`EVAL_MOCK=0 npm run eval -w loop-core`) — los prompts todavía no vieron un LLM, solo el modelo scripted.
- **R2 Rodrigo (canales, boundary, Auth0):** parcial — `boundary/write.ts`, `auth0.ts`, `idempotency.ts` y `workplace-mcp.ts` existen y se testean con fakes. El lector real de Ambiguous está en `boundary/ambiguous-reader.ts`; falta registrar ejecutores y conectar la aprobación de SilentOps al write boundary.
- **R3 David (Slack, card, relato):** pendiente — `apps/channel` sigue mostrando el ejemplo genérico de incidents. Falta `npm run channel:setup`, reemplazarlo por la card de propuesta SilentOps y conectar su decisión a una `Proposal` real.
- **R4 (integracion, datos, verificacion):** parcial fuerte — key de Ambiguous validada, catálogo de 856 tools inspeccionado, workspace demo sembrado (canal, calendario, 3 documentos, 3 OT) y detector real probado a las 05:45. Mapeo y comando reproducible: [`team-docs/ambiguous-tools.md`](./team-docs/ambiguous-tools.md). No usar datos de personas ni controlar equipos físicos.

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
