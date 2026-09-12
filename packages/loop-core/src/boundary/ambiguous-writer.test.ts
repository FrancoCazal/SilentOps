import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createAmbiguousWorkspaceWriter,
  renderHandover,
  WriteNotAllowedError,
  WRITE_INTENTS,
  absoluteUrl,
  type WriteCall,
} from "./ambiguous-writer";
import { executeApproved, registerWorkspaceExecutor } from "./write";
import { memoryStore, setIdempotencyStore } from "./idempotency";
import { registerOutbound } from "../channels/outbound";
import type { Proposal } from "../approval/types";

const NOW = () => new Date("2026-09-12T08:45:00.000Z");
const TASKS = [
  { id: "11111111-1111-4111-8111-111111111111", task_key: "TASK-003", title: "OT-243 — Revisar burlete · Muelle 3", status: "todo", description: "Origen: Ana 04:20" },
  { id: "22222222-2222-4222-8222-222222222222", task_key: "TASK-001", title: "OT-241 — Inspeccionar sello · Camara 02", status: "in_progress" },
];
const USERS = [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", display_name: "Franco Cazal", username: "franco.cazal" }];
const CATALOG = [
  { name: "create_document", inputSchema: { required: ["type"] } },
  { name: "update_task", inputSchema: { required: ["id"] } },
  { name: "send_message", inputSchema: { required: ["channel_id", "content"] } },
  { name: "documents_delete", inputSchema: { required: ["id"] } },
];

function harness(overrides: { docs?: Array<Record<string, unknown>>; users?: typeof USERS; call?: WriteCall } = {}) {
  const writes: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const logs: string[] = [];
  const writer = createAmbiguousWorkspaceWriter({
    now: NOW,
    log: (m) => { logs.push(m); },
    call: async (tool, args) => {
      writes.push({ tool, args });
      if (overrides.call) return overrides.call(tool, args);
      return { content: [{ type: "text", text: JSON.stringify({ id: "doc-new", title: args.title }) }] };
    },
    read: async (tool, args) => {
      if (tool === "list_documents") return { data: overrides.docs ?? [] };
      if (tool === "search_workspace") return { data: [{ id: "doc-new", title: args.query, url: "/docs/doc-new" }, { id: "doc-trashed", title: args.query }] };
      if (tool === "list_tasks") return { data: TASKS };
      if (tool === "list_users") return { data: overrides.users ?? USERS, q: args.q };
      throw new Error(`read inesperado ${tool}`);
    },
    catalog: async () => CATALOG,
  });
  return { writer, writes, logs };
}

describe("ambiguous-writer", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => { h = harness(); });

  it("create-handover: arma Markdown, descarta bullets sin fuente y recorta a cinco", async () => {
    const bullets = [
      { text: "Camara 3 puerta trabada", source: "m2" },
      { text: "sin fuente, no entra" },
      { text: "Generador con ruido", source: "m3" },
      { text: "b4", source: "m4" }, { text: "b5", source: "m5" }, { text: "b6", source: "m6" }, { text: "b7", source: "m7" },
    ];
    const out = (await h.writer(WRITE_INTENTS.createHandover, {
      title: "Handover Noche 2026-09-12",
      bullets,
      shift: { name: "Noche", start: "22:00", end: "06:00", outgoing: ["Ana"], incoming: ["Bruno"] },
      openWorkOrders: ["OT-243 · Revisar burlete"],
    })) as Record<string, unknown>;
    assert.equal(h.writes.length, 1);
    const w = h.writes[0]!;
    assert.equal(w.tool, "create_document");
    assert.equal(w.args.type, "doc");
    assert.equal(w.args.title, "Handover Noche 2026-09-12");
    const content = String(w.args.content);
    assert.match(content, /^# Handover Noche 2026-09-12/);
    assert.match(content, /Turno: Noche · 22:00–06:00 · Sale: Ana · Entra: Bruno/);
    assert.match(content, /- Camara 3 puerta trabada — fuente: m2/);
    assert.doesNotMatch(content, /sin fuente, no entra/);
    assert.doesNotMatch(content, /b7/);
    assert.match(content, /OT-243 · Revisar burlete/);
    assert.match(content, /no opera equipos/);
    assert.equal(out.documentId, "doc-new");
    assert.equal(out.url, "https://app.ambiguous.ai/docs/doc-new");
    assert.equal(out.bullets, 5);
    assert.equal(out.droppedWithoutSource, 1);
    assert.ok(h.logs.includes("bullets sin fuente descartados"));
  });

  it("create-handover: sin bullets con fuente escribe un handover corto y honesto", async () => {
    await h.writer(WRITE_INTENTS.createHandover, { title: "Handover Noche 2026-09-12", bullets: [{ text: "x" }] });
    assert.match(String(h.writes[0]!.args.content), /Sin novedades con fuente durante el turno/);
  });

  it("create-handover: si ya existe un documento VIVO con ese titulo no lo crea de nuevo; uno en papelera no cuenta", async () => {
    h = harness({ docs: [{ id: "doc-trashed", title: "handover noche 2026-09-12", trashed_at: "2026-09-12T00:00:00Z" }] });
    await h.writer(WRITE_INTENTS.createHandover, { title: "Handover Noche 2026-09-12", bullets: [] });
    assert.equal(h.writes.length, 1, "un doc en papelera no bloquea la creacion");
    h = harness({ docs: [{ id: "doc-old", title: "handover noche 2026-09-12", trashed_at: null }] });
    const out = (await h.writer(WRITE_INTENTS.createHandover, { title: "Handover Noche 2026-09-12", bullets: [] })) as Record<string, unknown>;
    assert.equal(h.writes.length, 0);
    assert.equal(out.skipped, true);
    assert.equal(out.documentId, "doc-old");
  });

  it("create-handover: sin title rechaza antes de escribir", async () => {
    await assert.rejects(() => h.writer(WRITE_INTENTS.createHandover, {}), WriteNotAllowedError);
    assert.equal(h.writes.length, 0);
  });

  for (const [label, response] of [
    ["sin id", { content: [{ type: "text", text: '{"title":"Handover"}' }] }],
    ["id vacio", { structuredContent: { id: "  " }, content: [] }],
    ["id no textual", { structuredContent: { id: 123 }, content: [] }],
    ["JSON ilegible", { content: [{ type: "text", text: "no es JSON" }] }],
  ] as const) {
    it(`create-handover: ${label} falla sin informar exito`, async () => {
      h = harness({ call: async () => response });
      await assert.rejects(() => h.writer(WRITE_INTENTS.createHandover, {
        title: "Handover Noche 2026-09-12", bullets: [],
      }), /create_document.*id/i);
      assert.equal(h.writes.length, 1);
      assert.ok(!h.logs.includes("handover document created"));
      assert.ok(h.logs.includes("handover creation unconfirmed"));
    });
  }

  for (const [label, tool, args] of [
    ["creacion", WRITE_INTENTS.createHandover, { title: "Handover Noche 2026-09-12", bullets: [] }],
    ["reasignacion por usuario", WRITE_INTENTS.reassignWorkOrder, { id: "TASK-003", assignee: "Franco" }],
    ["reasignacion por nota", WRITE_INTENTS.reassignWorkOrder, { id: "TASK-003", assignee: "Bruno" }],
    ["anotacion", WRITE_INTENTS.annotateWorkOrder, { id: "TASK-003", note: "Seguimiento aprobado" }],
    ["tool directa", "update_task", { id: TASKS[0]!.id, description: "Seguimiento aprobado" }],
  ] as const) {
    it(`${label}: propaga isError con el texto del proveedor`, async () => {
      h = harness({ call: async () => ({ isError: true, content: [{ type: "text", text: "permiso denegado de prueba" }] }) });
      await assert.rejects(() => h.writer(tool, args), /permiso denegado de prueba/);
      assert.equal(h.writes.length, 1);
      assert.ok(!h.logs.some((msg) => msg === "handover document created" || msg.startsWith("work order reassigned")));
    });
  }

  it("el error MCP sin texto sigue siendo un fallo explicito", async () => {
    h = harness({ call: async () => ({ isError: true, content: [] }) });
    await assert.rejects(() => h.writer("update_task", { id: TASKS[0]!.id }), /Ambiguous.*update_task/);
  });

  it("una tool directa exitosa conserva la respuesta MCP original", async () => {
    const response = { structuredContent: { updated: true }, content: [] };
    h = harness({ call: async () => response });
    assert.deepEqual(await h.writer("update_task", { id: TASKS[0]!.id }), response);
  });

  for (const invalid of ["missing-id", "isError"] as const) {
    it(`boundary: ${invalid} no marca completado ni envia Slack y permite reintento`, async (t) => {
      const environment = { AUTH0_DOMAIN: process.env.AUTH0_DOMAIN, ALLOW_UNVERIFIED_WRITES: process.env.ALLOW_UNVERIFIED_WRITES };
      t.after(() => {
        for (const [key, value] of Object.entries(environment)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        setIdempotencyStore(memoryStore());
      });
      delete process.env.AUTH0_DOMAIN;
      process.env.ALLOW_UNVERIFIED_WRITES = "1";
      setIdempotencyStore(memoryStore());
      let failed = true;
      let sends = 0;
      h = harness({ call: async () => failed
        ? { isError: invalid === "isError", content: [{ type: "text", text: "{}" }] }
        : { structuredContent: { id: "doc-confirmed" }, content: [] } });
      registerWorkspaceExecutor(h.writer);
      registerOutbound({ name: "writer-test", async send() { sends += 1; return { externalId: "sent-once" }; } });
      const proposal: Proposal = {
        id: `writer-${invalid}`, runId: "writer-test", sourceEventId: "event-test", status: "approved", risk: "medium",
        rationale: "Ensayo", createdAt: NOW().toISOString(), expiresAt: "2026-09-12T09:00:00.000Z",
        actions: [
          invalid === "isError"
            ? { kind: "workspace.write", tool: WRITE_INTENTS.reassignWorkOrder, args: { id: "TASK-003", assignee: "Bruno" }, summary: "Reasignar" }
            : { kind: "workspace.write", tool: WRITE_INTENTS.createHandover, args: { title: "Handover", bullets: [] }, summary: "Crear" },
          { kind: "channel.send", channel: "writer-test", to: "operations", body: "Listo", summary: "Avisar" },
        ],
      };
      const logs: string[] = [];
      const opts = { log: (msg: string) => { logs.push(msg); } };
      await assert.rejects(() => executeApproved(proposal, opts));
      assert.equal(sends, 0);
      assert.ok(!logs.includes("executed action"));
      failed = false;
      const retry = await executeApproved(proposal, opts);
      assert.deepEqual(retry.map((result) => result.skipped), [false, false]);
      assert.equal(sends, 1);
      const repeated = await executeApproved(proposal, opts);
      assert.ok(repeated.every((result) => result.skipped));
      assert.equal(sends, 1);
      assert.equal(h.writes.length, 2);
    });
  }

  it("reassign: resuelve la OT por prefijo del titulo y el usuario por nombre", async () => {
    const out = (await h.writer(WRITE_INTENTS.reassignWorkOrder, { id: "OT-243", assignee: "franco" })) as Record<string, unknown>;
    assert.deepEqual(h.writes, [{ tool: "update_task", args: { id: TASKS[0]!.id, assignee_id: USERS[0]!.id } }]);
    assert.equal(out.via, "assignee_id");
  });

  it("reassign: si la persona no es usuario, deja constancia en la descripcion y no toca el status", async () => {
    const out = (await h.writer(WRITE_INTENTS.reassignWorkOrder, { id: "TASK-003", assignee: "Bruno" })) as Record<string, unknown>;
    assert.equal(h.writes.length, 1);
    const args = h.writes[0]!.args;
    assert.equal(args.id, TASKS[0]!.id);
    assert.equal(args.status, undefined);
    assert.equal(args.assignee_id, undefined);
    assert.match(String(args.description), /^Origen: Ana 04:20\n\nResponsable turno entrante: Bruno \(reasignado por SilentOps con aprobacion humana, 2026-09-12T08:45:00.000Z\)$/);
    assert.equal(out.via, "description-note");
  });

  it("reassign: una OT inexistente rechaza antes de escribir", async () => {
    await assert.rejects(() => h.writer(WRITE_INTENTS.reassignWorkOrder, { id: "OT-999", assignee: "Bruno" }), /OT-999.*no existe/);
    assert.equal(h.writes.length, 0);
  });

  it("acepta los alias TODO_* de golden.json y lo avisa en el log", async () => {
    await h.writer("TODO_docs_create", { title: "Handover Noche 2026-09-12", bullets: [{ text: "a", source: "m1" }] });
    await h.writer("TODO_work_order_assign", { id: "OT-241", assignee: "Bruno" });
    assert.deepEqual(h.writes.map((w) => w.tool), ["create_document", "update_task"]);
    assert.equal(h.logs.filter((m) => m === "write intent alias").length, 2);
  });

  it("pass-through: rechaza tools fuera de la lista blanca, inexistentes o sin required; deja pasar las validas", async () => {
    await assert.rejects(() => h.writer("documents_permanent_delete", { id: "x" }), /lista blanca/);
    await assert.rejects(() => h.writer("send_message", { content: "hola" }), /faltan campos obligatorios channel_id/);
    await assert.rejects(() => h.writer("create_task", { title: "x" }), /no existe en el workspace/);
    assert.equal(h.writes.length, 0);
    await h.writer("send_message", { channel_id: "c1", content: "hola" });
    assert.deepEqual(h.writes, [{ tool: "send_message", args: { channel_id: "c1", content: "hola" } }]);
  });

  it("absoluteUrl vuelve absoluta la ruta relativa de search_workspace y respeta las absolutas", () => {
    assert.equal(absoluteUrl("/docs/abc", "https://app.ambiguous.ai/"), "https://app.ambiguous.ai/docs/abc");
    assert.equal(absoluteUrl("https://x.y/docs/abc", "https://app.ambiguous.ai"), "https://x.y/docs/abc");
    assert.equal(absoluteUrl(undefined), undefined);
  });

  it("renderHandover es determinista y cita cada fuente", () => {
    const md = renderHandover({
      title: "T", bullets: [{ text: "a", source: "m1" }], openWorkOrders: [], now: NOW(),
    });
    assert.equal(md.split("\n")[0], "# T");
    assert.match(md, /- a — fuente: m1/);
    assert.match(md, /2026-09-12T08:45:00.000Z/);
  });
});
