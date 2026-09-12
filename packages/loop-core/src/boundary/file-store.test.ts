import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { Proposal } from "../approval/types";
import {
  applyEdit,
  enablePersistence,
  expireOverdue,
  get,
  list,
  reset,
  save,
  setStatus,
} from "../approval/store";
import { memoryStore, setIdempotencyStore } from "./idempotency";
import {
  defaultStatePaths,
  fileIdempotencyStore,
  fileProposalStore,
} from "./file-store";
import { executeApproved, registerWorkspaceExecutor, rejectProposal } from "./write";

const testRoot = mkdtempSync(join(tmpdir(), "loop-core-file-store-"));

after(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function pathFor(name: string): string {
  return join(testRoot, name);
}

function proposal(id: string, overrides: Partial<Proposal> = {}): Proposal {
  return {
    id,
    runId: `run-${id}`,
    sourceEventId: `event-${id}`,
    actions: [
      {
        kind: "workspace.write",
        tool: "fixture.write",
        args: { title: `Handover ${id}` },
        summary: "crear handover",
      },
    ],
    rationale: "El handover esperado no existe.",
    risk: "medium",
    status: "pending",
    createdAt: "2026-09-12T05:45:00.000Z",
    expiresAt: "2026-09-12T06:00:00.000Z",
    ...overrides,
  };
}

describe("fileIdempotencyStore", () => {
  it("recupera seen y recall desde una instancia nueva", async () => {
    const path = pathFor("idempotency-reload.json");
    const first = fileIdempotencyStore(path);

    await first.remember("action-1", { externalId: "doc-1" });

    const restarted = fileIdempotencyStore(path);
    assert.equal(await restarted.seen("action-1"), true);
    assert.deepEqual(await restarted.recall("action-1"), { externalId: "doc-1" });
    assert.equal(existsSync(`${path}.tmp`), false);
  });

  it("conserva todos los remembers concurrentes", async () => {
    const path = pathFor("idempotency-concurrent.json");
    const store = fileIdempotencyStore(path);

    await Promise.all(
      Array.from({ length: 12 }, (_, index) => store.remember(`key-${index}`, index)),
    );

    const restarted = fileIdempotencyStore(path);
    for (let index = 0; index < 12; index += 1) {
      assert.equal(await restarted.recall(`key-${index}`), index);
    }
  });

  it("reemplaza valores que JSON no puede serializar por un marcador", async () => {
    const path = pathFor("idempotency-unserializable.json");
    const store = fileIdempotencyStore(path);

    await store.remember("bigint", 1n);
    await store.remember("undefined", undefined);

    const restarted = fileIdempotencyStore(path);
    assert.deepEqual(await restarted.recall("bigint"), { unserializable: true });
    assert.deepEqual(await restarted.recall("undefined"), { unserializable: true });
  });

  it("trata ENOENT como vacio y propaga JSON corrupto", async () => {
    const missing = fileIdempotencyStore(pathFor("missing.json"));
    assert.equal(await missing.seen("unknown"), false);

    const corruptPath = pathFor("idempotency-corrupt.json");
    writeFileSync(corruptPath, "{not-json", "utf8");
    assert.throws(() => fileIdempotencyStore(corruptPath), SyntaxError);
  });

  it("no publica la key en memoria cuando falla el archivo", async () => {
    const store = fileIdempotencyStore(pathFor("missing-parent/idempotency.json"));

    await assert.rejects(() => store.remember("action-1", { ok: true }), /ENOENT/);
    assert.equal(await store.seen("action-1"), false);
  });
});

describe("fileProposalStore", () => {
  it("vuelca y recupera propuestas completas de forma atomica", async () => {
    const path = pathFor("proposal-file-store.json");
    const disk = fileProposalStore(path);
    const expected = proposal("p-file", { status: "approved", approvedBy: "supervisor" });

    assert.deepEqual([...disk.load()], []);
    await disk.flush(new Map([[expected.id, expected]]));

    assert.deepEqual([...fileProposalStore(path).load()], [["p-file", expected]]);
    assert.equal(existsSync(`${path}.tmp`), false);
  });

  it("propaga errores de lectura distintos de ENOENT", () => {
    const corruptPath = pathFor("proposal-corrupt.json");
    writeFileSync(corruptPath, "[] trailing", "utf8");

    assert.throws(() => fileProposalStore(corruptPath).load(), SyntaxError);
  });
});

describe("defaultStatePaths", () => {
  it("crea LOOP_STATE_DIR y devuelve ambos archivos de estado", () => {
    const previous = process.env.LOOP_STATE_DIR;
    const stateDir = pathFor("custom-state");
    process.env.LOOP_STATE_DIR = stateDir;
    try {
      assert.deepEqual(defaultStatePaths(), {
        idempotency: join(stateDir, "idempotency.json"),
        proposals: join(stateDir, "proposals.json"),
      });
      assert.equal(existsSync(stateDir), true);
    } finally {
      if (previous === undefined) delete process.env.LOOP_STATE_DIR;
      else process.env.LOOP_STATE_DIR = previous;
    }
  });
});

describe("approval store persistence", () => {
  beforeEach(() => {
    reset();
  });

  it("preserva propuestas en memoria al habilitar un archivo nuevo y recupera el status", async () => {
    const path = pathFor("approval-enable-new.json");
    const inMemory = save(proposal("p-before-enable"));

    await enablePersistence(path);
    setStatus(inMemory.id, "approved", "supervisor-1");
    inMemory.status = "rejected";
    inMemory.approvedBy = "mutacion-no-persistida";
    await enablePersistence(path);

    assert.equal(get(inMemory.id)?.status, "approved");
    assert.equal(get(inMemory.id)?.approvedBy, "supervisor-1");
  });

  it("considera autoritativo un archivo existente", async () => {
    const path = pathFor("approval-authoritative.json");
    const onDisk = proposal("p-disk", { status: "approved" });
    await fileProposalStore(path).flush(new Map([[onDisk.id, onDisk]]));

    await enablePersistence(path);

    assert.deepEqual(list().map(({ id }) => id), ["p-disk"]);
  });

  it("persiste save, setStatus, applyEdit, expireOverdue, rejectProposal y reset", async () => {
    const path = pathFor("approval-mutators.json");
    await enablePersistence(path);

    save(proposal("p-edit"));
    setStatus("p-edit", "approved", "supervisor-1");
    applyEdit(
      "p-edit",
      [
        {
          kind: "channel.send",
          channel: "slack",
          to: "#operaciones-hub-frio",
          body: "Handover listo",
          summary: "avisar",
        },
      ],
      "supervisor-2",
    );
    save(proposal("p-expire"));
    expireOverdue(new Date("2026-09-12T06:01:00.000Z"));
    save(proposal("p-reject"));
    const rejected = rejectProposal("p-reject", "supervisor-3");

    const reloaded = fileProposalStore(path).load();
    assert.equal(reloaded.get("p-edit")?.status, "edited");
    assert.equal(reloaded.get("p-edit")?.approvedBy, "supervisor-2");
    assert.equal(reloaded.get("p-expire")?.status, "expired");
    assert.equal(reloaded.get("p-reject")?.status, "rejected");
    assert.equal(rejected.status, "rejected");

    reset();
    assert.deepEqual([...fileProposalStore(path).load()], []);
  });
});

describe("write boundary with file idempotency", () => {
  it("una instancia nueva salta todas las acciones ya ejecutadas", async () => {
    const path = pathFor("execute-approved.json");
    let writes = 0;
    const p = proposal("p-execute", { status: "approved" });
    const previousBypass = process.env.ALLOW_UNVERIFIED_WRITES;
    const previousDomain = process.env.AUTH0_DOMAIN;
    process.env.ALLOW_UNVERIFIED_WRITES = "1";
    delete process.env.AUTH0_DOMAIN;
    registerWorkspaceExecutor(async () => {
      writes += 1;
      return { externalId: "doc-1" };
    });

    try {
      setIdempotencyStore(fileIdempotencyStore(path));
      const first = await executeApproved(p, { log: () => {} });
      setIdempotencyStore(fileIdempotencyStore(path));
      const restarted = await executeApproved(p, { log: () => {} });

      assert.equal(writes, 1);
      assert.equal(first[0]?.skipped, false);
      assert.equal(restarted[0]?.skipped, true);
      assert.deepEqual(restarted[0] && "previous" in restarted[0] ? restarted[0].previous : undefined, {
        externalId: "doc-1",
      });
    } finally {
      if (previousBypass === undefined) delete process.env.ALLOW_UNVERIFIED_WRITES;
      else process.env.ALLOW_UNVERIFIED_WRITES = previousBypass;
      if (previousDomain === undefined) delete process.env.AUTH0_DOMAIN;
      else process.env.AUTH0_DOMAIN = previousDomain;
      setIdempotencyStore(memoryStore());
    }
  });
});
