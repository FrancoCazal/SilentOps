# Ambiguous — contrato real de lectura (SilentOps)

Verificado contra el workspace **SilentOps** el 2026-09-12. El catálogo MCP
respondió con 856 tools. SilentOps usa solo las seis de esta tabla para leer:

| Hecho que necesita SilentOps | Tool MCP real | Normalización del adaptador |
| --- | --- | --- |
| Guardia que está cerrando | `list_calendars` + `list_events` | busca el calendario `SilentOps Demo`, interpreta las líneas `Turno/Sale/Entra` del evento activo y devuelve roster con horas locales |
| Existencia del handover | `search_workspace` | restringe la búsqueda a `docs` y devuelve `items` |
| Evidencia del canal | `list_channels` + `get_channel_messages` | resuelve `operaciones-hub-frio`, toma hasta 100 mensajes y filtra desde el inicio de guardia cuando hay fecha ISO |
| Órdenes abiertas | `list_tasks` | conserva solo `todo`, `in_progress` y `blocked` |

El código está en
[`boundary/ambiguous-reader.ts`](../packages/loop-core/src/boundary/ambiguous-reader.ts).
Las intenciones `silentops.*` de `domain/tools.ts` son un contrato interno: no
son nombres inventados para el MCP. El adaptador es el único lugar que conoce
los nombres del proveedor.

## Garantía

El lector no tiene referencia a `create_document`, `update_task`, `send_message`
ni a ninguna otra tool de escritura. Las escrituras continúan pasando por
`executeApproved` y el límite de aprobación humana.

## Caso demo sembrado

- Canal: `#operaciones-hub-frio`, con tres mensajes marcados como simulación.
- Calendario: `SilentOps Demo`, guardia Noche (Ana → Bruno), 22:00–06:00.
- Tres órdenes abiertas: OT-241, OT-242 y OT-243.
- Tres documentos: reglas, activos y el handover anterior.
- **No existe** `Handover Noche 2026-09-12`: es la evidencia de ausencia.

Prueba sin modelo y sin escribir nada:

```powershell
$env:SILENTOPS_DEMO_AT = '2026-09-12T05:45:00-03:00'
npm run silentops:detect --workspace loop-core
```

Debe devolver `detected: true`, tres mensajes y tres órdenes. Para el caso
negativo, crear el handover de prueba y volver a correrlo: debe devolver
`detected: false`.
