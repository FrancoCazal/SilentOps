/**
 * Ejecutor de ESCRITURA contra Ambiguous (R2). Espejo de ambiguous-reader.ts.
 *
 * El modelo propone INTENCIONES de dominio (silentops.*), no tools del
 * proveedor. Este archivo es el unico que conoce las tools MCP de escritura,
 * sus schemas y como se construye un handover. Consecuencias:
 *
 * - El modelo no puede nombrar una tool de escritura real aunque quiera: una
 *   tool que no es intencion pasa por una lista blanca corta y por el catalogo
 *   vivo del workspace, con sus campos `required` verificados antes de escribir.
 * - Un bullet sin fuente NO entra al handover (SILENTOPS.md). Se descarta aca,
 *   en el boundary, no en el prompt.
 * - Un handover que ya existe con el mismo titulo no se crea dos veces, aunque
 *   la propuesta sea otra (mitiga el id no determinista de buildProposal).
 * - Reasignar una OT a alguien que no es usuario del workspace no falla en
 *   silencio ni inventa un id: queda registrado en la descripcion de la OT y el
 *   resultado dice por cual camino fue.
 *
 * Solo se llama desde boundary/write.ts, despues de la aprobacion humana.
 */
import { ambiguousExecutor, callReadTool, listWorkplaceTools } from "./workplace-mcp";
import type { WorkspaceExecutor } from "./write";

export const WRITE_INTENTS = {
  createHandover: "silentops.create-handover",
  reassignWorkOrder: "silentops.reassign-work-order",
  annotateWorkOrder: "silentops.annotate-work-order",
} as const;

/** Nombres historicos de golden.json y prompts. Se aceptan con aviso en el log. */
export const WRITE_ALIASES: Record<string, string> = {
  TODO_docs_create: WRITE_INTENTS.createHandover,
  TODO_work_order_assign: WRITE_INTENTS.reassignWorkOrder,
  TODO_work_order_note: WRITE_INTENTS.annotateWorkOrder,
};

export const AMBIGUOUS_WRITE_TOOLS = {
  createDocument: "create_document",
  updateTask: "update_task",
} as const;

/** Tools reales que el boundary deja pasar tal cual (validadas contra el catalogo). Nada mas. */
export const PASS_THROUGH_ALLOWLIST: ReadonlySet<string> = new Set([
  "create_document",
  "update_document",
  "create_task",
  "update_task",
  "send_message",
]);

const READ_TOOLS = {
  searchDocuments: "search_workspace",
  listTasks: "list_tasks",
  listUsers: "list_users",
} as const;

export const MAX_HANDOVER_BULLETS = 5;

export type WriteCall = (tool: string, args: Record<string, unknown>) => Promise<unknown>;
export type CatalogEntry = { name: string; inputSchema: unknown };

export type WriterOptions = {
  /** Escritura real. Inyectable para tests. */
  call?: WriteCall;
  /** Lectura para resolver ids y detectar duplicados. Inyectable para tests. */
  read?: WriteCall;
  /** Catalogo vivo de tools (nombre + schema). Inyectable para tests. */
  catalog?: () => Promise<CatalogEntry[]>;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
  now?: () => Date;
};

export type HandoverBullet = { text: string; source?: string };

export class WriteNotAllowedError extends Error {
  status = 422;
}

export function createAmbiguousWorkspaceWriter(options: WriterOptions = {}): WorkspaceExecutor {
  const call = options.call ?? ambiguousExecutor;
  const read = options.read ?? callReadTool;
  const log = options.log ?? (() => {});
  const now = options.now ?? (() => new Date());
  let catalogCache: Promise<Map<string, unknown>> | undefined;
  const catalog = () =>
    (catalogCache ??= (options.catalog ?? listWorkplaceTools)().then(
      (tools) => new Map(tools.map((t) => [t.name, t.inputSchema] as const)),
    ));

  return async (tool, args) => {
    const intent = WRITE_ALIASES[tool] ?? tool;
    if (intent !== tool) log("write intent alias", { from: tool, to: intent });

    switch (intent) {
      case WRITE_INTENTS.createHandover:
        return createHandover(args, { call, read, log, now });
      case WRITE_INTENTS.reassignWorkOrder:
        return reassignWorkOrder(args, { call, read, log, now });
      case WRITE_INTENTS.annotateWorkOrder:
        return annotateWorkOrder(args, { call, read, log, now });
      default:
        return passThrough(intent, args, { call, catalog, log });
    }
  };
}

type Deps = {
  call: WriteCall;
  read: WriteCall;
  log: NonNullable<WriterOptions["log"]>;
  now: () => Date;
};

// ───────────────────────────── handover ─────────────────────────────

async function createHandover(args: Record<string, unknown>, d: Deps): Promise<unknown> {
  const title = str(args.title);
  if (!title) throw new WriteNotAllowedError(`${WRITE_INTENTS.createHandover}: falta title`);

  // Idempotencia a nivel workspace: mismo titulo, mismo documento.
  const existing = await findDocumentByTitle(title, d.read);
  if (existing) {
    d.log("handover already exists, not creating again", { title, documentId: existing.id });
    return { tool: AMBIGUOUS_WRITE_TOOLS.createDocument, skipped: true, documentId: existing.id, title };
  }

  const { kept, dropped } = sourcedBullets(args.bullets);
  if (dropped.length) d.log("bullets sin fuente descartados", { title, dropped: dropped.map((b) => b.text) });
  const capped = kept.slice(0, MAX_HANDOVER_BULLETS);
  if (kept.length > capped.length) d.log("bullets recortados a cinco", { title, total: kept.length });

  const content = str(args.content) ?? renderHandover({
    title,
    bullets: capped,
    openWorkOrders: workOrderLines(args.openWorkOrders),
    shift: args.shift as Record<string, unknown> | undefined,
    summary: str(args.summary),
    now: d.now(),
  });

  const result = await d.call(AMBIGUOUS_WRITE_TOOLS.createDocument, {
    type: "doc",
    title,
    content,
    labels: ["silentops", "handover"],
  });
  const doc = unwrap(result);
  const documentId = str(doc?.id);
  d.log("handover document created", { title, documentId, bullets: capped.length });
  return {
    tool: AMBIGUOUS_WRITE_TOOLS.createDocument,
    skipped: false,
    documentId,
    title,
    url: str(doc?.url) ?? str(doc?.link),
    bullets: capped.length,
    droppedWithoutSource: dropped.length,
  };
}

function sourcedBullets(raw: unknown): { kept: HandoverBullet[]; dropped: HandoverBullet[] } {
  const kept: HandoverBullet[] = [];
  const dropped: HandoverBullet[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const b = typeof item === "string" ? { text: item } : (item as Record<string, unknown>);
    const text = str(b?.text)?.trim();
    const source = str(b?.source)?.trim();
    if (!text) continue;
    (source ? kept : dropped).push({ text, source });
  }
  return { kept, dropped };
}

function workOrderLines(raw: unknown): string[] {
  const out: string[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    const r = item as Record<string, unknown>;
    const key = str(r.key) ?? str(r.task_key) ?? str(r.id);
    const title = str(r.title);
    const who = str(r.assignee) ?? str(r.responsable);
    const line = [key, title].filter(Boolean).join(" · ");
    if (line) out.push(who ? `${line} · responsable: ${who}` : line);
  }
  return out;
}

export function renderHandover(input: {
  title: string;
  bullets: HandoverBullet[];
  openWorkOrders: string[];
  shift?: Record<string, unknown>;
  summary?: string;
  now: Date;
}): string {
  const lines: string[] = [`# ${input.title}`, ""];
  const shift = input.shift;
  if (shift) {
    const name = str(shift.name);
    const start = str(shift.start);
    const end = str(shift.end);
    const outgoing = arr(shift.outgoing).join(", ");
    const incoming = arr(shift.incoming).join(", ");
    const parts = [
      name ? `Turno: ${name}` : undefined,
      start && end ? `${start}–${end}` : undefined,
      outgoing ? `Sale: ${outgoing}` : undefined,
      incoming ? `Entra: ${incoming}` : undefined,
    ].filter(Boolean);
    if (parts.length) lines.push(parts.join(" · "), "");
  }
  if (input.summary) lines.push(input.summary, "");
  lines.push("## Novedades del turno (con fuente)", "");
  if (input.bullets.length) {
    for (const b of input.bullets) lines.push(`- ${b.text} — fuente: ${b.source}`);
  } else {
    lines.push("- Sin novedades con fuente durante el turno.");
  }
  lines.push("");
  if (input.openWorkOrders.length) {
    lines.push("## Trabajo abierto que pasa al turno entrante", "");
    for (const w of input.openWorkOrders) lines.push(`- ${w}`);
    lines.push("");
  }
  lines.push(
    "---",
    `Preparado por SilentOps a partir del canal de operaciones y las ordenes abiertas, y aprobado por una persona. ` +
      `SilentOps no opera equipos ni evalua lecturas ni decide si un producto es seguro. ${input.now.toISOString()}`,
  );
  return lines.join("\n");
}

async function findDocumentByTitle(
  title: string,
  read: WriteCall,
): Promise<{ id: string } | undefined> {
  const found = unwrapRows(await read(READ_TOOLS.searchDocuments, { query: title, modules: ["docs"], limit: 20 }));
  const hit = found.find((r) => str(r.title)?.trim().toLowerCase() === title.trim().toLowerCase() && !r.trashed_at);
  const id = hit && str(hit.id);
  return id ? { id } : undefined;
}

// ───────────────────────────── ordenes de trabajo ─────────────────────────────

async function reassignWorkOrder(args: Record<string, unknown>, d: Deps): Promise<unknown> {
  const ref = str(args.id) ?? str(args.key) ?? str(args.workOrder);
  const assignee = str(args.assignee) ?? str(args.assignee_id) ?? str(args.to);
  if (!ref || !assignee) {
    throw new WriteNotAllowedError(`${WRITE_INTENTS.reassignWorkOrder}: faltan id y assignee`);
  }
  const task = await resolveTask(ref, d.read);
  const user = await resolveUser(assignee, d.read);
  const note = str(args.note);

  if (user) {
    await d.call(AMBIGUOUS_WRITE_TOOLS.updateTask, { id: task.id, assignee_id: user.id });
    d.log("work order reassigned", { taskId: task.id, ref, assignee: user.name, via: "assignee_id" });
    return { tool: AMBIGUOUS_WRITE_TOOLS.updateTask, taskId: task.id, ref, assignee: user.name, via: "assignee_id" };
  }

  // Fallback visible: la persona no es usuario del workspace (F-02). No se
  // inventa un id ni se cambia el status: queda en la descripcion.
  const stamp = d.now().toISOString();
  const line = `Responsable turno entrante: ${assignee} (reasignado por SilentOps con aprobacion humana, ${stamp})${note ? ` — ${note}` : ""}`;
  const description = [task.description?.trim(), line].filter(Boolean).join("\n\n");
  await d.call(AMBIGUOUS_WRITE_TOOLS.updateTask, { id: task.id, description });
  d.log("work order reassigned by note (assignee is not a workspace user)", { taskId: task.id, ref, assignee });
  return { tool: AMBIGUOUS_WRITE_TOOLS.updateTask, taskId: task.id, ref, assignee, via: "description-note" };
}

async function annotateWorkOrder(args: Record<string, unknown>, d: Deps): Promise<unknown> {
  const ref = str(args.id) ?? str(args.key);
  const note = str(args.note)?.trim();
  if (!ref || !note) throw new WriteNotAllowedError(`${WRITE_INTENTS.annotateWorkOrder}: faltan id y note`);
  const task = await resolveTask(ref, d.read);
  const description = [task.description?.trim(), `${note} (SilentOps, ${d.now().toISOString()})`].filter(Boolean).join("\n\n");
  await d.call(AMBIGUOUS_WRITE_TOOLS.updateTask, { id: task.id, description });
  return { tool: AMBIGUOUS_WRITE_TOOLS.updateTask, taskId: task.id, ref, via: "description-note" };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveTask(ref: string, read: WriteCall): Promise<{ id: string; description?: string }> {
  const tasks = unwrapRows(await read(READ_TOOLS.listTasks, { limit: 100 }));
  const needle = ref.trim().toLowerCase();
  const hit = tasks.find((t) => {
    const id = str(t.id)?.toLowerCase();
    const key = str(t.task_key)?.toLowerCase();
    const title = str(t.title)?.toLowerCase() ?? "";
    return id === needle || key === needle || title.startsWith(`${needle} `) || title.startsWith(`${needle} —`) || title.split(/\s|—|·/)[0] === needle;
  });
  if (hit && str(hit.id)) return { id: str(hit.id)!, description: str(hit.description) };
  if (UUID.test(ref)) return { id: ref };
  throw new WriteNotAllowedError(`orden de trabajo '${ref}' no existe en el workspace (se busco por id, task_key y prefijo del titulo)`);
}

async function resolveUser(who: string, read: WriteCall): Promise<{ id: string; name: string } | undefined> {
  if (UUID.test(who)) return { id: who, name: who };
  const users = unwrapRows(await read(READ_TOOLS.listUsers, { q: who, limit: 50 }));
  const needle = who.trim().toLowerCase();
  const hit = users.find((u) =>
    [u.display_name, u.username, u.email, u.workspace_email]
      .map((v) => str(v)?.toLowerCase())
      .some((v) => v === needle || v?.split("@")[0] === needle || v?.split(" ")[0] === needle),
  );
  const id = hit && str(hit.id);
  return id ? { id, name: str(hit.display_name) ?? who } : undefined;
}

// ───────────────────────────── pass-through validado ─────────────────────────────

async function passThrough(
  tool: string,
  args: Record<string, unknown>,
  d: { call: WriteCall; catalog: () => Promise<Map<string, unknown>>; log: Deps["log"] },
): Promise<unknown> {
  if (!PASS_THROUGH_ALLOWLIST.has(tool)) {
    throw new WriteNotAllowedError(
      `'${tool}' no es una intencion de SilentOps ni esta en la lista blanca de escritura del boundary ` +
        `(${[...PASS_THROUGH_ALLOWLIST].join(", ")}). Intenciones: ${Object.values(WRITE_INTENTS).join(", ")}.`,
    );
  }
  const schemas = await d.catalog();
  if (!schemas.has(tool)) {
    throw new WriteNotAllowedError(`'${tool}' no existe en el workspace de Ambiguous (catalogo vivo)`);
  }
  const schema = schemas.get(tool) as { required?: unknown } | undefined;
  const required = Array.isArray(schema?.required) ? (schema!.required as string[]) : [];
  const missing = required.filter((k) => args[k] === undefined || args[k] === null || args[k] === "");
  if (missing.length) {
    throw new WriteNotAllowedError(`'${tool}': faltan campos obligatorios ${missing.join(", ")}`);
  }
  d.log("pass-through write validated", { tool, required });
  return d.call(tool, args);
}

// ───────────────────────────── helpers ─────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length ? v : undefined;
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Desenvuelve un CallToolResult (structuredContent o JSON en content) o devuelve el objeto tal cual. */
function unwrap(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  if (value.isError) throw new Error("Ambiguous rechazo la escritura");
  if (isRecord(value.structuredContent)) return value.structuredContent;
  if (Array.isArray(value.content)) {
    const text = value.content
      .filter(isRecord)
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .join("\n");
    try {
      const parsed = JSON.parse(text);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return value;
}

function unwrapRows(value: unknown): Record<string, unknown>[] {
  const payload = unwrap(value) ?? value;
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data.filter(isRecord);
  if (isRecord(payload) && Array.isArray(payload.items)) return payload.items.filter(isRecord);
  if (isRecord(payload) && Array.isArray(payload.results)) return payload.results.filter(isRecord);
  return [];
}
