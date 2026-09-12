import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TOOLS } from "../domain/tools";
import { createAmbiguousWorkspaceReader, type WorkplaceReadCall } from "./ambiguous-reader";

const hit = { id: "doc-1", title: "Handover Noche 2026-09-12", url: "/docs/doc-1" };

function readerWithDocuments(documents: unknown, calls: string[] = []) {
  const call: WorkplaceReadCall = async (tool, args) => {
    calls.push(tool);
    if (tool === "search_workspace") {
      assert.deepEqual(args, { query: hit.title, modules: ["docs"], limit: 20 });
      return { data: [hit] };
    }
    if (tool === "list_documents") {
      assert.deepEqual(args, {});
      if (documents instanceof Error) throw documents;
      return documents;
    }
    throw new Error(`lectura inesperada: ${tool}`);
  };
  return createAmbiguousWorkspaceReader({ call });
}

describe("ambiguous reader: documentos vivos", () => {
  it("devuelve el hit vivo con sus campos originales", async () => {
    const calls: string[] = [];
    const reader = readerWithDocuments({ data: [{ id: hit.id, trashed_at: null }] }, calls);
    assert.deepEqual(await reader(TOOLS.searchDocuments, { query: hit.title }), { items: [hit] });
    assert.deepEqual(calls, ["search_workspace", "list_documents"]);
  });

  it("descarta un hit de papelera aunque search_workspace no lo indique", async () => {
    const reader = readerWithDocuments({ data: [{ id: hit.id, trashed_at: "2026-09-12T12:00:00Z" }] });
    assert.deepEqual(await reader(TOOLS.searchDocuments, { query: hit.title }), { items: [] });
  });

  it("descarta un hit que no aparece en list_documents", async () => {
    const reader = readerWithDocuments({ data: [{ id: "otro", trashed_at: null }] });
    assert.deepEqual(await reader(TOOLS.searchDocuments, { query: hit.title }), { items: [] });
  });

  it("propaga el error de list_documents sin inventar una ausencia", async () => {
    const failure = new Error("list_documents no disponible");
    const reader = readerWithDocuments(failure);
    await assert.rejects(() => reader(TOOLS.searchDocuments, { query: hit.title }), (error) => error === failure);
  });

  it("consulta el listado una vez en cada busqueda sin reutilizar datos viejos", async () => {
    const calls: string[] = [];
    const documents = { data: [{ id: hit.id, trashed_at: null as string | null }] };
    const reader = readerWithDocuments(documents, calls);
    assert.deepEqual(await reader(TOOLS.searchDocuments, { query: hit.title }), { items: [hit] });
    documents.data[0]!.trashed_at = "2026-09-12T12:00:00Z";
    assert.deepEqual(await reader(TOOLS.searchDocuments, { query: hit.title }), { items: [] });
    assert.deepEqual(calls, ["search_workspace", "list_documents", "search_workspace", "list_documents"]);
  });

  it("no interpreta un listado malformado como ausencia confirmada", async () => {
    const reader = readerWithDocuments({ error: "respuesta incompleta" });
    await assert.rejects(() => reader(TOOLS.searchDocuments, { query: hit.title }), /list_documents.*invalida/);
  });

  it("openWorkOrders conserva solo todo, in_progress y blocked", async () => {
    const tasks = ["todo", "in_progress", "blocked", "done", "cancelled"].map((status) => ({ id: status, status }));
    const reader = createAmbiguousWorkspaceReader({
      call: async (tool, args) => {
        assert.equal(tool, "list_tasks");
        assert.deepEqual(args, { limit: 100 });
        return { data: tasks };
      },
    });
    assert.deepEqual(await reader(TOOLS.openWorkOrders, {}), { items: tasks.slice(0, 3) });
  });
});
