/**
 * El canal de SilentOps en Slack (R2). Reemplaza al `channel.tsx` heredado del
 * kit sin tocarlo: server.ts importa este.
 *
 * Flujo: mencion -> InboundEvent (inbound-slack.ts) -> handleEvent -> Proposal
 * guardada -> card en el hilo -> click Aprobar -> approveAndExecute (el unico
 * camino de escritura) -> la card se actualiza con lo ejecutado.
 *
 * Restriccion real del SDK (thread.d.ts: "Proactive delivery to subscribed
 * conversations is not yet wired"): el proceso no puede publicar en un canal de
 * Slack donde nadie lo menciono. Por eso una mencion ARMA la vigilancia: guarda
 * el hilo, y el detector programado publica ahi cuando encuentra la ausencia.
 * Ese arme es una accion humana de configuracion, no la deteccion.
 *
 * La card de abajo es PROVISORIA (R2). R3 la reemplaza por approval-card.tsx
 * manteniendo dos cosas: el marcador `proposal:<uuid>` en el texto y que
 * Aprobar llame SOLO a approveAndExecute.
 */
import {
  createChannel,
  Message,
  Header,
  Section,
  Markdown,
  Context,
  Divider,
  Actions,
  Button,
} from "@copilotkit/channels";
import type { InteractionContext, MessageRef, Renderable } from "@copilotkit/channels";

/**
 * Lo minimo que este archivo necesita de un hilo. Estructural a proposito: los
 * handlers reciben StatefulThread (interfaz de channels-ui) y los clicks el
 * Thread de channels-core; ambos cumplen esto.
 */
type SlackThread = {
  post(ui: Renderable): Promise<MessageRef>;
  update(ref: MessageRef, ui: Renderable): Promise<MessageRef>;
};
import {
  handleEvent,
  proposals,
  approveAndExecute,
  rejectProposal,
  registerOutbound,
  detectMissingHandover,
  effectiveActions,
  loggerFor,
  HighRiskError,
  NotApprovedError,
  systemPrompt,
  withWriteVocabulary,
} from "loop-core";
import type { InboundEvent, Proposal, ExecutionResult } from "loop-core";
import { makeChannelAgent } from "./agent";
import { required } from "./env";
import { toInboundEvent } from "./inbound-slack";
import { parseCommand, demoNow, liveProposalFor, absenceSentence } from "./silentops-logic";

const log = loggerFor("slack");

type Watch = { thread: SlackThread; conversationKey?: string; armedBy: string; armedAt: string };
let watch: Watch | undefined;
/** Hilo donde vive cada propuesta: ahi se actualiza la card y ahi contesta channel.send. */
const proposalThreads = new Map<string, SlackThread>();
/** Propuesta en ejecucion: channel.send no sabe de propuestas, solo de destinos. */
let executing: Proposal | undefined;

export const silentopsChannel = createChannel({
  name: required("CHANNEL_CODE"),
  identifyUser: "platform",
  // Requerido por Channels. No se usa: el loop corre por handleEvent, nunca por thread.runAgent().
  agent: makeChannelAgent,
  tools: [],
  components: [],
});

silentopsChannel.onMention(async ({ thread, message }) => {
  const conversationKey = conversationKeyOf(thread);
  const history = await thread.getMessages();
  const evt = toInboundEvent(message, { history, conversationKey });
  if (!evt) return;

  await thread.subscribe();
  const by = evt.from.displayName ?? evt.from.externalId;
  const command = parseCommand(evt.text);
  log("mention", { command, by, eventId: evt.id, editsProposal: evt.context?.editsProposal });

  if (evt.context?.editsProposal) {
    // Editar desde el hilo es contrato (context.editsProposal). Convertir texto
    // libre en acciones editadas es trabajo del agente y no entra en Tier 0:
    // se registra y se pide aprobar o rechazar la card tal cual.
    await thread.post(
      <Message>
        <Section>
          <Markdown>{`Recibido, ${by}. En esta version la propuesta \`proposal:${evt.context.editsProposal}\` se aprueba o se rechaza desde sus botones; la edicion por texto queda registrada y no cambia nada por si sola.`}</Markdown>
        </Section>
      </Message>,
    );
    return;
  }

  armWatch(thread, conversationKey, by);

  if (command === "detect") {
    await thread.post(statusCard(`Smoke test de desarrollo pedido por ${by}: corriendo el detector ahora (no es la deteccion del producto).`));
    await runDetectorOnce(thread, { reason: "mention" });
    return;
  }

  await thread.post(statusCard(`Vigilancia armada por ${by}. El detector programado publica aca si al cierre del turno falta el handover.`));
});

silentopsChannel.onMessage(async ({ thread }) => {
  // Sin mencion no se hace nada: el agente no contesta cada mensaje del canal.
  // La suscripcion solo sirve para que el hilo siga vivo para el detector.
  if (!(await thread.isSubscribed())) return;
});

silentopsChannel.onWelcome(async ({ thread }) => {
  await thread.post(
    statusCard("SilentOps: mencioname en el hilo del canal de operaciones para armar la vigilancia del turno. Nunca escribo sin aprobacion."),
  );
});

/** Salida `channel.send` del boundary: publica en el hilo de la propuesta en ejecucion, o en el vigilado. */
registerOutbound({
  name: "slack",
  async send(to, body) {
    const thread = (executing && proposalThreads.get(executing.id)) ?? watch?.thread;
    if (!thread) throw new Error(`no hay hilo de Slack para '${to}': nadie armo la vigilancia todavia`);
    const ref = await thread.post(
      <Message accent="#2EB67D">
        <Section>
          <Markdown>{body}</Markdown>
        </Section>
      </Message>,
    );
    return { externalId: String(ref.id) };
  },
});

export function armWatch(thread: SlackThread, conversationKey: string | undefined, by: string): void {
  watch = { thread, conversationKey, armedBy: by, armedAt: new Date().toISOString() };
  log("watch armed", { conversationKey, by });
}

export function watchStatus(): Omit<Watch, "thread"> | undefined {
  return watch ? { conversationKey: watch.conversationKey, armedBy: watch.armedBy, armedAt: watch.armedAt } : undefined;
}

/**
 * Una corrida del detector. null no es error: el turno no cierra o el handover
 * existe. Con evento, corre el loop en el hilo vigilado (o el que pidio el smoke).
 */
export async function runDetectorOnce(
  thread: SlackThread | undefined = watch?.thread,
  opts: { reason: "schedule" | "mention" } = { reason: "schedule" },
): Promise<Proposal | undefined> {
  if (!thread) {
    log("detector skipped: no armed thread", { reason: opts.reason });
    return undefined;
  }
  const now = demoNow();
  let evt: InboundEvent | null;
  try {
    evt = await detectMissingHandover({ now });
  } catch (e) {
    log("detector failed", { reason: opts.reason, error: String(e) });
    if (opts.reason === "mention") await thread.post(errorCard("El detector no pudo leer el workspace", e));
    return undefined;
  }
  if (!evt) {
    log("detector: nothing to do", { at: now.toISOString() });
    if (opts.reason === "mention") {
      await thread.post(statusCard(`Detector a las ${now.toISOString()}: no falta un handover o el turno no esta cerrando. No se dispara.`));
    }
    return undefined;
  }
  return runLoop(evt, thread);
}

/** InboundEvent -> Proposal -> card. Idempotente por evento: una propuesta viva bloquea otra. */
export async function runLoop(evt: InboundEvent, thread: SlackThread): Promise<Proposal | undefined> {
  const live = liveProposalFor(evt.id, proposals.list());
  if (live) {
    log("event already has a live proposal", { eventId: evt.id, proposalId: live.id, status: live.status });
    return live;
  }
  let proposal: Proposal;
  try {
    // El prompt de dominio + el vocabulario de escritura del boundary: sin
    // esto el modelo manda payloads sin `tool` y la propuesta sale vacia.
    proposal = await handleEvent(evt, { log, prompt: withWriteVocabulary(systemPrompt()) });
  } catch (e) {
    log("handleEvent failed", { eventId: evt.id, error: String(e) });
    await thread.post(errorCard("El agente no pudo preparar la propuesta", e));
    return undefined;
  }
  proposals.save(proposal);
  proposalThreads.set(proposal.id, thread);
  await thread.post(proposalCard(proposal, evt));
  log("proposal posted", { proposalId: proposal.id, actions: proposal.actions.length, risk: proposal.risk });
  return proposal;
}

/** Cron en proceso. Sin Trigger.dev: si el proceso vive, el detector corre. */
export function startDetectorLoop(opts: { everyMs?: number } = {}): () => void {
  const everyMs = opts.everyMs ?? Number(process.env.SILENTOPS_DETECT_EVERY_MS ?? 60_000);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDetectorOnce(undefined, { reason: "schedule" });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref();
  log("detector loop started", { everyMs, demoAt: process.env.SILENTOPS_DEMO_AT ?? null });
  void tick();
  return () => clearInterval(timer);
}

// ───────────────────────── card provisoria (R3 la reemplaza) ─────────────────────────

function proposalCard(p: Proposal, evt: InboundEvent, extra?: { note?: string }) {
  const evidence = absenceSentence(evt);
  const lines = effectiveActions(p).map(
    (a, i) => `${i + 1}. **${a.summary}** · \`${a.kind}\`${a.kind === "workspace.write" ? ` · tool \`${a.tool}\`` : ""}`,
  );
  const shift = evt.context?.shift as { name?: string; outgoing?: string[]; incoming?: string[] } | undefined;
  return (
    <Message accent={p.risk === "high" ? "#E01E5A" : p.risk === "medium" ? "#ECB22E" : "#2EB67D"}>
      <Header>{`Handover ausente${shift?.name ? ` · turno ${shift.name}` : ""}`}</Header>
      {evidence ? (
        <Section>
          <Markdown>{`Evidencia del detector: \`${evidence}\``}</Markdown>
        </Section>
      ) : null}
      {shift?.outgoing?.length ? (
        <Context>{`Sale: ${shift.outgoing.join(", ")}${shift.incoming?.length ? ` · Entra: ${shift.incoming.join(", ")}` : ""}`}</Context>
      ) : null}
      <Divider />
      <Section>
        <Markdown>{lines.length ? lines.join("\n") : "_El agente no propuso acciones: sin actividad con fuente, no se inventa trabajo._"}</Markdown>
      </Section>
      <Context>{`Por que: ${p.rationale} · riesgo ${p.risk} · vence ${p.expiresAt}`}</Context>
      {extra?.note ? <Context>{extra.note}</Context> : null}
      <Context>{`proposal:${p.id} · run ${p.runId} · evento ${p.sourceEventId}`}</Context>
      <Actions>
        <Button value="approve" style="primary" onClick={(ctx) => decide(ctx, p.id, "approve")}>
          Aprobar
        </Button>
        <Button value="reject" style="danger" onClick={(ctx) => decide(ctx, p.id, "reject")}>
          Rechazar
        </Button>
      </Actions>
    </Message>
  );
}

function resultCard(p: Proposal, by: string, results: ExecutionResult[]) {
  const done = results.filter((r) => !r.skipped).length;
  const skipped = results.length - done;
  return (
    <Message accent="#2EB67D">
      <Header>{`Aprobado por ${by} y ejecutado`}</Header>
      <Section>
        <Markdown>
          {effectiveActions(p)
            .map((a, i) => `${i + 1}. ${a.summary} · ${results[i]?.skipped ? "ya estaba hecho (idempotente)" : "hecho"}`)
            .join("\n")}
        </Markdown>
      </Section>
      <Context>{`${done} ejecutadas · ${skipped} omitidas por idempotencia · proposal:${p.id}`}</Context>
    </Message>
  );
}

function decisionCard(title: string, detail: string, proposalId: string, accent = "#616061") {
  return (
    <Message accent={accent}>
      <Header>{title}</Header>
      <Section>
        <Markdown>{detail}</Markdown>
      </Section>
      <Context>{`proposal:${proposalId}`}</Context>
    </Message>
  );
}

function statusCard(text: string) {
  const w = watchStatus();
  return (
    <Message accent="#4A154B">
      <Section>
        <Markdown>{text}</Markdown>
      </Section>
      <Context>{w ? `Vigilancia: armada por ${w.armedBy} a las ${w.armedAt}` : "Vigilancia: sin armar"}</Context>
      <Context>{`Propuestas pendientes: ${proposals.list("pending").length}`}</Context>
    </Message>
  );
}

function errorCard(title: string, e: unknown) {
  return (
    <Message accent="#E01E5A">
      <Header>{title}</Header>
      <Section>
        <Markdown>{`\`${String(e).slice(0, 400)}\``}</Markdown>
      </Section>
      <Context>Nada se escribio. Falla visible, no silenciosa.</Context>
    </Message>
  );
}

/**
 * El click. Aprobar llama SOLO a approveAndExecute. Riesgo alto pide un segundo
 * click explicito (HighRiskError -> la card se re-publica con confirmacion).
 */
async function decide(
  ctx: InteractionContext<string>,
  proposalId: string,
  decision: "approve" | "reject" | "confirm-high",
): Promise<void> {
  const by = ctx.user?.name ?? ctx.actor?.name ?? ctx.actor?.id ?? "supervisor";
  const thread = ctx.thread;
  const ref = ctx.message.ref;
  proposalThreads.set(proposalId, thread);

  if (decision === "reject") {
    try {
      rejectProposal(proposalId, by);
      await thread.update(ref, decisionCard(`Rechazada por ${by}`, "No se ejecuto nada.", proposalId));
    } catch (e) {
      await thread.update(ref, errorCard("No se pudo rechazar", e));
    }
    return;
  }

  const p = proposals.get(proposalId);
  executing = p;
  try {
    const results = await approveAndExecute(proposalId, by, {
      log,
      confirmHighRisk: decision === "confirm-high",
    });
    await thread.update(ref, resultCard(proposals.get(proposalId) ?? p!, by, results));
  } catch (e) {
    if (e instanceof HighRiskError && p) {
      await thread.update(
        ref,
        <Message accent="#E01E5A">
          <Header>Riesgo alto: confirmacion explicita</Header>
          <Section>
            <Markdown>{`${by}, esta propuesta es de riesgo **alto** y no se ejecuta con un solo click. Confirmá para ejecutar o rechazá.`}</Markdown>
          </Section>
          <Context>{`proposal:${p.id}`}</Context>
          <Actions>
            <Button value="confirm-high" style="danger" onClick={(c) => decide(c, p.id, "confirm-high")}>
              Confirmar riesgo alto
            </Button>
            <Button value="reject" onClick={(c) => decide(c, p.id, "reject")}>
              Rechazar
            </Button>
          </Actions>
        </Message>,
      );
      return;
    }
    const title = e instanceof NotApprovedError ? "La propuesta ya no se puede aprobar" : "La ejecucion fallo";
    log("approve failed", { proposalId, by, error: String(e) });
    await thread.update(ref, errorCard(title, e));
  } finally {
    executing = undefined;
  }
}

function conversationKeyOf(thread: unknown): string | undefined {
  const k = (thread as { conversationKey?: unknown })?.conversationKey;
  return typeof k === "string" ? k : undefined;
}
