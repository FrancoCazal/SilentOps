/** Ensayo de backend. --dry simula escrituras; --mock evita llamar al modelo. */
import {
  ambiguousExecutor,
  approveAndExecute,
  bootstrapBoundary,
  buildProposal,
  callReadTool,
  createAmbiguousWorkspaceWriter,
  detectMissingHandover,
  effectiveActions,
  handleEvent,
  systemPrompt,
  withWriteVocabulary,
  localDateKey,
  newRunId,
  proposals,
  registerOutbound,
  WRITE_ALIASES,
  WRITE_INTENTS,
  type ExecutionResult,
  type InboundEvent,
  type Logger,
  type Proposal,
} from "../src/index.ts";

const flags = new Set(process.argv.slice(2));
const dry = flags.has("--dry");
const mock = flags.has("--mock");
const keep = flags.has("--keep");
const runId = newRunId("rehearsal");
const steps = new Map<number, { ok: boolean; note?: string }>();
const createdDocuments = new Set<string>();
let snapshot: TaskSnapshot[] = [];
let slackSends = 0;
let exitCode = 0;
let currentStep = 1;
let creationWithoutId = false;

type Row = Record<string, unknown>;
type TaskSnapshot = { id: string; description: string | null; assignee_id: string | null };

const log: Logger = (msg, extra = {}) => {
  console.log(JSON.stringify({ runId, msg, ...extra }));
  // El writer emite este log al crear, antes de que termine el lote. Permite
  // limpiar el documento incluso si la segunda accion o remember fallan.
  if (!dry && msg === "handover document created") {
    if (typeof extra.documentId === "string" && extra.documentId) createdDocuments.add(extra.documentId);
    else creationWithoutId = true;
  }
  if (!dry && msg === "handover creation unconfirmed") creationWithoutId = true;
};

function heading(n: number, title: string): void {
  currentStep = n;
  console.log(`== ${n}) ${title} ==`);
}

function checked(n: number, ok: boolean, note?: string): void {
  steps.set(n, { ok, note });
  console.log(`${ok ? "OK" : "FALLA"}${note ? `: ${note}` : ""}`);
  if (!ok && exitCode === 0) exitCode = 1;
}

function record(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("se esperaba un objeto en la respuesta del workspace");
  }
  return value as Row;
}

function records(value: unknown): Row[] {
  const rows = Array.isArray(value) ? value : record(value).data ?? record(value).items;
  if (!Array.isArray(rows)) throw new Error("se esperaba una lista del workspace");
  return rows.map(record);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function taskSnapshot(task: Row): TaskSnapshot {
  const id = text(task.id);
  if (!id) throw new Error("task sin id: no se puede garantizar su restauracion");
  return {
    id,
    description: typeof task.description === "string" ? task.description : null,
    assignee_id: typeof task.assignee_id === "string" ? task.assignee_id : null,
  };
}

function mockProposal(evt: InboundEvent, now: Date): Proposal {
  const context = record(evt.context);
  const shift = record(context.shift);
  const orders = records(context.openWorkOrders);
  const first = orders[0];
  const ref = first && (text(first.task_key) ?? text(first.title)?.match(/^OT-[\w-]+/)?.[0]);
  const assignee = Array.isArray(shift.incoming) ? text(shift.incoming[0]) : undefined;
  if (!ref || !assignee) throw new Error("mock requiere una OT con task_key/OT- y un responsable entrante");
  const bullets = records(context.messagesSinceShiftStart).slice(0, 3).flatMap((message) => {
    const source = text(message.id);
    const body = text(message.text) ?? text(message.content) ?? text(message.body);
    return source && body ? [{ text: body, source }] : [];
  });
  return buildProposal({
    runId, evt, ttlMinutes: 10,
    raw: [
      {
        kind: "workspace.write", summary: "Crear el handover con fuentes", risk: "medium",
        rationale: "Falta el handover al cierre del turno.",
        payload: { tool: "silentops.create-handover", args: {
          title: `Handover ${shift.name} ${localDateKey(now)}`, bullets,
          openWorkOrders: orders.map((order) => text(order.title)).filter((title) => title !== undefined),
          shift,
        } },
      },
      {
        kind: "workspace.write", summary: `Reasignar ${ref} a ${assignee}`, risk: "medium",
        rationale: "El responsable entrante recibe la primera orden abierta.",
        payload: { tool: "silentops.reassign-work-order", args: { id: ref, assignee } },
      },
      {
        kind: "channel.send", summary: "Avisar el traspaso en Slack", risk: "medium",
        rationale: "El equipo debe conocer el traspaso aprobado.",
        payload: { channel: "slack", to: "#operaciones-hub-frio", body: "Handover preparado y primera orden transferida con aprobacion humana." },
      },
    ],
  });
}

function printResults(results: ExecutionResult[]): void {
  for (const result of results) {
    const value = result.skipped ? result.previous : result.result;
    const detail = value && typeof value === "object" ? value as Row : {};
    console.log(JSON.stringify({ index: result.index, skipped: result.skipped,
      documentId: detail.documentId, url: detail.url, via: detail.via }));
  }
}

function validateRehearsal(proposal: Proposal, evt: InboundEvent, title: string): void {
  const orders = records(evt.context?.openWorkOrders);
  const shift = record(evt.context?.shift);
  const incoming = new Set((Array.isArray(shift.incoming) ? shift.incoming : [])
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.trim().toLowerCase()));
  const refs = new Set(orders.flatMap((order) => [
    text(order.id), text(order.task_key), text(order.title)?.match(/^OT-[\w-]+/)?.[0],
  ]).filter((ref): ref is string => !!ref).map((ref) => ref.toLowerCase()));
  let handovers = 0;
  let assignments = 0;
  let notices = 0;
  for (const action of effectiveActions(proposal)) {
    if (action.kind === "channel.send" && action.channel === "slack" && action.to === "#operaciones-hub-frio") {
      notices += 1;
      continue;
    }
    if (action.kind !== "workspace.write") throw new Error(`accion fuera del ensayo: ${action.kind}`);
    const intent = WRITE_ALIASES[action.tool] ?? action.tool;
    if (intent === WRITE_INTENTS.createHandover) {
      if (action.args.title !== title) console.log(`aviso: el modelo titulo el handover "${String(action.args.title)}" (esperado "${title}"); se ejecuta igual y se purga por id`);
      handovers += 1;
    }
    else if (intent === WRITE_INTENTS.reassignWorkOrder) {
      const ref = text(action.args.id) ?? text(action.args.key) ?? text(action.args.workOrder);
      if (!ref || !refs.has(ref.toLowerCase())) throw new Error("reasignacion fuera de las OT del detector");
      const assignee = text(action.args.assignee) ?? text(action.args.assignee_id) ?? text(action.args.to);
      if (!assignee || !incoming.has(assignee.trim().toLowerCase())) throw new Error("responsable fuera del turno entrante");
      assignments += 1;
    } else throw new Error(`accion o titulo fuera del ensayo restaurable: ${action.tool}`);
  }
  // Con un LLM real la mezcla varia entre corridas: lo unico obligatorio es el
  // handover. Reasignaciones y avisos se verifican si el modelo los propuso.
  console.log(JSON.stringify({ handovers, assignments, notices }));
  if (handovers < 1) throw new Error("el ensayo requiere al menos un handover (silentops.create-handover)");
}

async function cleanup(): Promise<void> {
  heading(8, "Limpieza");
  if (dry || keep) {
    checked(8, true, `omitida por ${dry ? "--dry" : "--keep"}`);
    return;
  }
  const failures: string[] = [];
  if (creationWithoutId) failures.push("el writer informo una creacion sin documentId; limpieza no confirmada");
  // Cada restauracion se intenta aunque otra falle. Nunca se borra un doc
  // reutilizado: solo ids observados en el log de una creacion de este ensayo.
  for (const id of createdDocuments) {
    try {
      // Ambiguous solo purga lo que ya esta en papelera: primero documents_delete
      // (idempotente si ya estaba), despues documents_permanent_delete. La papelera
      // no alcanza: search_workspace la sigue devolviendo (F-16).
      await ambiguousExecutor("documents_delete", { id }).catch(() => undefined);
      const result = record(await ambiguousExecutor("documents_permanent_delete", { id }));
      if (result.isError) throw new Error(JSON.stringify(result.content));
      console.log(JSON.stringify({ deletedDocumentId: id }));
    } catch (error) { failures.push(`documento ${id}: ${String(error)}`); }
  }
  if (snapshot.length) {
    try {
      const current = new Map(records(await callReadTool("list_tasks", { limit: 100 }))
        .map((task) => { const value = taskSnapshot(task); return [value.id, value] as const; }));
      for (const original of snapshot) {
        const after = current.get(original.id);
        if (!after) { failures.push(`task ${original.id} no aparece al restaurar`); continue; }
        if (after.description === original.description && after.assignee_id === original.assignee_id) continue;
        try {
          const result = record(await ambiguousExecutor("update_task", { ...original }));
          if (result.isError) throw new Error(JSON.stringify(result.content));
          console.log(JSON.stringify({ restoredTaskId: original.id }));
        } catch (error) { failures.push(`task ${original.id}: ${String(error)}`); }
      }
    } catch (error) { failures.push(`lectura para restaurar: ${String(error)}`); }
  }
  checked(8, failures.length === 0, failures.length ? failures.join("; ") : "workspace restaurado");
  if (failures.length && exitCode === 0) exitCode = 1;
}

try {
  heading(1, "Entorno y boundary");
  for (const flag of flags) {
    if (!["--dry", "--mock", "--keep"].includes(flag)) throw new Error(`flag desconocido: ${flag}`);
  }
  process.env.SILENTOPS_DEMO_AT ??= "2026-09-12T05:45:00-03:00";
  process.env.LOOP_STATE_DIR ??= ".data/rehearsal";
  process.env.TZ ??= "America/Asuncion";
  const now = new Date(process.env.SILENTOPS_DEMO_AT);
  if (Number.isNaN(now.getTime())) throw new Error("SILENTOPS_DEMO_AT invalido");
  if (!process.env.AUTH0_DOMAIN) {
    process.env.ALLOW_UNVERIFIED_WRITES = "1";
    console.log("AUTH0 BYPASS: ensayo en desarrollo sin AUTH0_DOMAIN");
  }
  console.log(JSON.stringify({ dry, mock, keep, demoAt: process.env.SILENTOPS_DEMO_AT }));
  registerOutbound({ name: "slack", async send(to, body) {
    slackSends += 1;
    console.log(`SLACK -> ${to}: ${body}`);
    return { externalId: `${runId}-slack-${slackSends}` };
  } });
  const dryWriter = dry ? createAmbiguousWorkspaceWriter({
    log, now: () => now,
    call: async (tool, args) => {
      console.log(`DRY-WRITE ${tool} ${JSON.stringify(args)}`);
      return { content: [{ type: "text", text: JSON.stringify({ id: "dry-doc-id" }) }] };
    },
  }) : undefined;
  const report = await bootstrapBoundary({ log, ...(dryWriter ? { workspaceExecutor: dryWriter } : {}) });
  console.log(JSON.stringify(report));
  checked(1, true);

  heading(2, "Snapshot para restauracion");
  if (!dry) snapshot = records(await callReadTool("list_tasks", { limit: 100 })).map(taskSnapshot);
  checked(2, true, dry ? "omitido por --dry" : `${snapshot.length} tasks guardadas`);

  heading(3, "Detector real");
  const evt = await detectMissingHandover({ now });
  if (!evt) {
    exitCode = 2;
    throw new Error("no hay ausencia: ¿quedo un handover de prueba sin purgar? (ver fixes F-16)");
  }
  console.log(JSON.stringify({ eventId: evt.id, absenceEvidence: evt.context?.absenceEvidence }));
  checked(3, true);

  heading(4, "Propuesta y card en texto");
  let proposal: Proposal;
  if (mock) proposal = mockProposal(evt, now);
  else {
    // Con el vocabulario de escritura: sin el, el modelo manda payloads sin tool (fixes F-18).
    // Gemini a veces devuelve una respuesta vacia (0 texto, 0 tool calls) con
    // el evento real; un reintento la resuelve casi siempre. Igual que el canal.
    const prompt = withWriteVocabulary(systemPrompt());
    try {
      proposal = await handleEvent(evt, { log, prompt });
      if (proposal.actions.length === 0) {
        console.log("el modelo no propuso acciones; reintentando una vez");
        proposal = await handleEvent(evt, { log, prompt });
      }
    }
    catch (error) { exitCode = 3; throw error; }
  }
  const evidence = record(evt.context?.absenceEvidence);
  const expectedTitle = text(evidence.expectedRecord);
  if (!expectedTitle) throw new Error("evidencia sin expectedRecord");
  // El ensayo solo aprueba operaciones que su snapshot/cleanup puede restaurar.
  validateRehearsal(proposal, evt, expectedTitle);
  proposals.save(proposal);
  console.log(expectedTitle);
  console.log(`searched Documents for "${expectedTitle}" at ${evidence.searchedAt} -> ${Array.isArray(evidence.matches) ? evidence.matches.length : "?"} results`);
  for (const [index, action] of effectiveActions(proposal).entries()) {
    console.log(`${index + 1}. ${action.summary} · ${action.kind} · ${action.kind === "workspace.write" ? action.tool : action.kind === "channel.send" ? action.channel : action.job}`);
  }
  console.log(JSON.stringify({ proposalId: proposal.id, risk: proposal.risk, rationale: proposal.rationale }));
  checked(4, true);

  heading(5, "Aprobacion y ejecucion");
  const results = await approveAndExecute(proposal.id, "rehearsal", { log, confirmHighRisk: true });
  printResults(results);
  checked(5, results.length > 0, `${results.length} acciones`);

  heading(6, "Verificacion del workspace");
  if (dry) checked(6, true, "omitida por --dry; las escrituras son simuladas");
  else {
    const documents = records(await callReadTool("list_documents", {}));
    const documentOk = documents.some((doc) => doc.title === expectedTitle && doc.trashed_at === null);
    console.log(`${documentOk ? "OK" : "FALLA"}: handover vivo`);
    const assignments = results.flatMap((result) => {
      const detail = record(result.skipped ? result.previous : result.result);
      return text(detail.taskId) && (detail.via === "assignee_id" || detail.via === "description-note") ? [detail] : [];
    });
    let tasksOk = true;
    if (assignments.length === 0) console.log("OK: el modelo no propuso reasignaciones; nada que verificar en tasks");
    for (const assignment of assignments) {
      const id = String(assignment.taskId);
      const response = record(await callReadTool("get_task", { id }));
      // get_task devuelve { task: {...} } (verificado 15:12); tolerar tambien data o plano.
      const task = response.task && typeof response.task === "object" ? record(response.task)
        : response.data && typeof response.data === "object" ? record(response.data) : response;
      const before = snapshot.find((item) => item.id === id);
      const ok = !!before && (assignment.via === "assignee_id"
        ? !!text(task.assignee_id) && task.assignee_id !== before.assignee_id
        : (text(task.description) ?? "").includes(`Responsable turno entrante: ${assignment.assignee}`) && task.description !== before.description);
      console.log(`${ok ? "OK" : "FALLA"}: reasignacion ${id} via ${assignment.via}`);
      tasksOk = tasksOk && ok;
    }
    checked(6, documentOk && tasksOk);
  }

  heading(7, "Reenvio de la misma aprobacion");
  // El modelo puede no proponer aviso: se compara contra lo propuesto, no contra 1.
  const expectedNotices = proposal.actions.filter((action) => action.kind === "channel.send").length;
  const sentBefore = slackSends;
  const repeated = await approveAndExecute(proposal.id, "rehearsal", { log, confirmHighRisk: true });
  printResults(repeated);
  checked(7, repeated.length === results.length && repeated.length > 0 && repeated.every((result) => result.skipped)
    && sentBefore === expectedNotices && slackSends === sentBefore, `skipped=${JSON.stringify(repeated.map((result) => result.skipped))}; mensajes Slack=${slackSends} (propuestos: ${expectedNotices})`);
} catch (error) {
  checked(currentStep, false, error instanceof Error ? error.message : String(error));
} finally {
  await cleanup();
  heading(9, "Resumen final");
  for (let step = 1; step <= 8; step += 1) {
    const result = steps.get(step);
    console.log(`${step}: ${result?.ok ? "OK" : "FALLA"}${result?.note ? ` (${result.note})` : !result ? " (no alcanzado)" : ""}`);
  }
  console.log(`exit=${exitCode}`);
  process.exitCode = exitCode;
}
