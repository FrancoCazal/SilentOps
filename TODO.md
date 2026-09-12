# TODO — R3 (David) · superficie SilentOps

_Actualizado 15:40. Freeze final 16:45 → **65 minutos**._

Verificado en esta pasada: `npm run verify` → **exit 0**, 200 tests
(agent-core 37, loop-core 58, channel 71, web 34), 0 fallas, sin red.

---

## 🔴 LO ÚNICO QUE IMPORTA AHORA: el video no existe

El jurado es **global y asincrónico**: no ve la demo en vivo. El video y el repo
**son** el proyecto a efectos del puntaje. `ESTADO.md` fija el último momento
razonable para empezar a filmar en **15:45**. Ya pasó la hora.

Todo lo demás de esta lista vale menos que empezar a filmar.

### Lo que SÍ se puede filmar ahora mismo, sin credenciales

```bash
npm run preview:card -w channel
# → apps/channel/preview/*.json
# → pegar en https://app.slack.com/block-kit-builder → screenshot
```

| Archivo | Plano | Sirve para |
|---|---|---|
| `01-pending.json` | card con evidencia de ausencia + propuesta | 0:30–1:20, el corazón del video |
| `02-approved.json` | "✓ Aprobado por Ana · handover creado" | la aprobación como firma de salida |
| `03-rejected.json` | "rechazada · nada se escribió" | control: se puede decir no |
| `04-silent.json` | `→ 1 result` · "Sin acción" | el agente que **no** dispara |

Más planos que no dependen de nada: el ledger con el hueco, el canal, el
workspace de Ambiguous, `npm run silentops:detect -w loop-core` en la terminal
(lectura real, `matches: []`), `npm run verify` en verde.

---

## 🔴 Slack sigue bloqueado — y `.env` se vació otra vez

A las 15:26 `ESTADO.md` reportaba 11 claves con `INTELLIGENCE_API_KEY` y
`CHANNEL_CODE` **vacías**. A las 15:34, leyendo `.env` (sólo nombres y si están
seteadas, nunca valores), quedaban **tres**:

```
CONSOLE_ACCESS_CODE      set
CONSOLE_SESSION_SECRET   set
LOG_LEVEL                set
```

Es decir: **desaparecieron también Gemini y Ambiguous**. Alguien reescribió el
archivo. Consecuencia: `npm run dev:slack` no arranca y **los planos 0:30–1:20 no
se pueden filmar en vivo**. Van con el preview de Block Kit.

> Corrección de algo que dije antes: afirmé que las claves estaban y que
> `dev:slack` corría. Era falso — había listado **nombres** de variables, no
> valores. Estaban vacías.

**Antes de tocar nada más: preguntar en el canal quién reescribió `.env`.** Si
alguien tiene las claves de Gemini/Ambiguous en su máquina, se recuperan en un
minuto y el plano en vivo vuelve a la mesa.

---

## 🟡 El plano del fallback no se puede filmar

Sólo hay (había) `GOOGLE_API_KEY`. `withFallback` salta a **openai**, que no
tiene clave, y muere con `OPENAI_API_KEY is required`. Verificado offline:

```
primary        : google
fallback hop to: openai
  configured openai      : false
  configured openrouter  : false
  configured google      : true
```

`ESTADO.md` confirma que **perdieron las keys de OpenRouter en el evento**. Con
una sola (`OPENROUTER_API_KEY` u `OPENAI_API_KEY`) el plano vuelve a ser real;
ojo que entonces hay que cambiar `FALLBACK_MODEL`, que hoy es `gemini-2.5-flash`,
por un id del provider nuevo.

Si no aparece: **no filmar el fallback y no reclamarlo.** `SUBMISSION.md` ya está
redactado con la verdad.

---

## 🟡 Riesgo de merge: mi superficie puede desaparecer

El `server.ts` de `origin/r2/backend` importa `silentops-channel.tsx`, no
`channel.tsx`. Después del merge **gana el cableado de R2** y
`apps/channel/src/silentops.tsx` queda muerto. Eso está bien.

**Lo que hay que preservar del lado R3 es `approval-card.tsx`.** Decírselo a
Rodrigo *antes* de mergear, o la card sale del build sin que nadie lo note.

---

## ✅ Hecho y verificado (superficie R3)

| Pieza | Evidencia |
|---|---|
| `approval-card.tsx` — evidencia antes de propuesta | `matches: []` se imprime como `⌕ searched Documents for "..." at 05:45 → 0 results` |
| Bullet sin fuente | se marca `⚠ sin fuente`, no se maquilla |
| `Aprobar` → `confirmApproval` → `onApprove` | única salida a escritura; `Rechazar` no escribe |
| Puerta de expiración | `confirmApproval` **no llama al boundary** si venció o ya se decidió; `refusedNotice` dice "No se escribió nada" |
| Replay etiquetado | una mención pasa `origin: "manual-replay"` y la card lo dice: no puede confundirse con detección proactiva |
| Caso silencioso | `handoverPresentNotice()` — el agente callado cuando el handover existe |
| Preview sin credenciales | `npm run preview:card -w channel`, 4 estados, Block Kit válido |
| `README.md` | abre como SilentOps + cómo ver la card sin credenciales |
| Tests | 71 en `channel`, 0 fallas |

### `SUBMISSION.md` — tres afirmaciones falsas corregidas

Cada una era comprobable por el jurado en 30 segundos:

1. **"47 tests… incluyendo los 15 golden cases"** → falso. Ahora: **200 tests
   offline**, los golden marcados como **modelo scripted**, y declarado que con
   modelo real dan **5/15**, con las dos causas conocidas.
2. **"OpenAI / OpenRouter — the model, with a demonstrated cross-provider
   fallback"** → el build corre **Gemini** y no hay segundo provider. Ahora:
   Gemini como el modelo real; el fallback como *implementado y testeado, no
   demostrado en vivo*.
3. **"Auth0 — verifica el scope before every action"** → no hay tenant y corre
   `ALLOW_UNVERIFIED_WRITES=1`. Ahora se declara el bypass y que la puerta
   **falla cerrada** sin él.

Además: **`Console approval states mockup/` estaba sin declarar** — 5 archivos
trackeados, 2.605 líneas, de las cuales `support.js` (1.911) es runtime de una
herramienta ajena. Las reglas exigen separar heredado de construido. Ya está
declarado como salida generada por herramienta de diseño, que no se importa ni se
publica como producto. Revisado: sin secretos (sólo el placeholder sintético
`ana@hubfrionorte.com`).

También: `apps/channel/preview/` gitignoreado (salida generada).

---

## Checklist que queda (en orden)

- [ ] **FILMAR.** Con el preview si Slack no vuelve. 15:45 ya pasó.
- [ ] Preguntar en el canal por `.env` (Gemini + Ambiguous).
- [ ] Avisar a Rodrigo: preservar `approval-card.tsx` en el merge.
- [ ] Link del video en `README.md` y en `SUBMISSION.md`.
- [ ] Post de redes (era para las 15:00).
- [ ] Subtítulos (canal en castellano, voz en inglés).
- [ ] Barrido de secretos frame por frame antes de subir.
- [ ] Los checkboxes de video/post de `SUBMISSION.md` (los de repo ya están).

## Las tres frases que no se improvisan

1. *"A standalone chat cannot wake at the expected shift boundary, query for the
   required record and preserve that chain of evidence."*
2. *"The agent has no write access. Everything you just saw was approved by the
   technician going off shift."*
3. *"SilentOps never controls equipment or decides safety."*

## Riesgo abierto que no arreglé (a propósito)

Los `onClick` se rutean **sólo en proceso**: si el runtime se reinicia entre
postear la card y apretarla, el botón responde "action expired". El arreglo real
(componente registrado + store durable) es cirugía sobre el seam de R2 a una hora
de la entrega. Mitigación: **no reiniciar el proceso durante el ensayo**; si un
botón no responde, reposteá la card.
