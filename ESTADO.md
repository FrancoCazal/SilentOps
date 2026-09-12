# ESTADO

Una linea por rol. Se actualiza en cada gate (10:00, 11:30, 13:00, 15:00).
Los coding agents leen este archivo antes de tocar nada.

| Gate | Hora | Estado |
|---|---|---|
| Contratos congelados | 10:00 | base tipada lista; confirmacion del equipo pendiente |
| Gate 1 (evento real -> Ambiguous -> salida) | 11:30 | no superado: integraciones reales pendientes; scope recortado |
| Gate 2 (ensayo grabado, scope congelado) | 13:00 | pendiente |
| Gate 3 (feature freeze) | 15:00 | pendiente |
| Entrega | 16:30 | pendiente |

**Tema elegido:** **SilentOps — continuidad para operaciones criticas de cadena de frio.** Un detector determinista y auditable encuentra un handover tecnico ausente entre guardias; el agente prepara, con fuentes, el documento, las reasignaciones y el aviso en Slack para aprobacion humana. Especificacion: [`SILENTOPS.md`](./SILENTOPS.md) — dentro del repo publico, es la fuente de verdad. La copia interna en `../docs/silentops-facilities.md` queda como material de equipo y no se publica.

**Recorte obligatorio:** Tier 0 es solo el handover ausente. No construir deteccion ambient, seguimiento automatico, Wiki de decisiones, WhatsApp, Torre de control ni segundo flujo antes de que el loop completo este verificado y grabado.

---

- **R1 Franco (agente, evals, fallback, jobs):** hecho — esqueleto de `loop-core`, `handleEvent`, `propose_action`, `withFallback`, harness de evals con modelo scripted. Proximo: prompts SilentOps, tools de lectura reales y 15 casos del dominio.
- **R2 Rodrigo (canales, boundary, Auth0):** pendiente — `boundary/write.ts`, `auth0.ts`, `idempotency.ts` y `workplace-mcp.ts` estan escritos y testeados con fakes; falta el adaptador Slack -> `InboundEvent`, registrar `ambiguousExecutor` y ejecutar el handover aprobado contra el workspace real.
- **R3 David (Slack, card, relato):** pendiente — falta `npm run channel:setup`, card de aprobacion conectada a una `Proposal` real y el storyboard de SilentOps.
- **R4 (integracion, datos, verificacion):** pendiente — falta workspace de Ambiguous, `npm run tools:list -w loop-core`, datos sinteticos de hub de frio y el primer run end to end. No usar datos de personas ni controlar equipos fisicos.

---

## Como retomar en frio

```bash
npm ci                  # una vez
npm run verify          # typecheck + tests + golden set (con mock, sin red)
npm run dev:slack       # el agente en Slack (necesita CHANNEL_CODE)
npm run tools:list -w loop-core   # tools vivas de Ambiguous (necesita AMBIGUOUS_API_KEY)
```
