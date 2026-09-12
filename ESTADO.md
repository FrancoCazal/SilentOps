# ESTADO

Una linea por rol. Se actualiza en cada gate (10:00, 11:30, 13:00, 15:00).
Los coding agents leen este archivo antes de tocar nada.

| Gate | Hora | Estado |
|---|---|---|
| Contratos congelados | 10:00 | pendiente |
| Gate 1 (evento real -> Ambiguous -> salida) | 11:30 | pendiente |
| Gate 2 (ensayo grabado, scope congelado) | 13:00 | pendiente |
| Gate 3 (feature freeze) | 15:00 | pendiente |
| Entrega | 16:30 | pendiente |

**Tema elegido:** POR DEFINIR. Todo `src/domain/` y el adaptador de canal esperan esta decision.
Terna recomendada por los docs: Acta, Cambio de turno, Dos empresas. Fallback universal: Cambio de turno.

---

- **R1 Franco (agente, evals, fallback, jobs):** hecho — esqueleto de `loop-core`, `handleEvent`, `propose_action`, `withFallback`, harness de evals con modelo scripted. Bloquea: tema y lista de tools del MCP. Proximo: prompts del tema y 15 casos reales.
- **R2 Rodrigo (canales, boundary, Auth0):** pendiente — `boundary/write.ts`, `auth0.ts`, `idempotency.ts` y `workplace-mcp.ts` estan escritos y testeados con fakes; falta el adaptador de entrada del tema, registrar `ambiguousExecutor` y las credenciales de Auth0.
- **R3 David (Slack, card, relato):** pendiente — falta `npm run channel:setup`, `approval/slack.tsx` y el storyboard.
- **R4 (integracion, datos, verificacion):** pendiente — falta workspace de Ambiguous, `npm run tools:list -w loop-core`, datos de demo y el primer run end to end.

---

## Como retomar en frio

```bash
npm ci                  # una vez
npm run verify          # typecheck + tests + golden set (con mock, sin red)
npm run dev:slack       # el agente en Slack (necesita CHANNEL_CODE)
npm run tools:list -w loop-core   # tools vivas de Ambiguous (necesita AMBIGUOUS_API_KEY)
```
