import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapBoundary } from "./bootstrap";
import { readTool, isWorkspaceReaderRegistered, resetWorkspaceReader, fixtureReader } from "../domain/workspace-reader";
import { executeApproved } from "./write";
import { registerOutbound } from "../channels/outbound";
import * as proposals from "../approval/store";
import type { Proposal } from "../approval/types";
import type { Logger } from "../observability/log";

function proposal(): Proposal {
  const now = new Date();
  return {
    id: "pb1",
    runId: "r1",
    sourceEventId: "evt-boot",
    actions: [{ kind: "workspace.write", tool: "fixture_tool", args: { a: 1 }, summary: "x" }],
    rationale: "test",
    risk: "low",
    status: "approved",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 600_000).toISOString(),
  };
}

describe("bootstrapBoundary", () => {
  let savedEnv: Record<string, string | undefined>;
  let dir: string;

  beforeEach(() => {
    savedEnv = {
      ALLOW_UNVERIFIED_WRITES: process.env.ALLOW_UNVERIFIED_WRITES,
      AUTH0_DOMAIN: process.env.AUTH0_DOMAIN,
      AUTH0_AUDIENCE: process.env.AUTH0_AUDIENCE,
      AMBIGUOUS_API_KEY: process.env.AMBIGUOUS_API_KEY,
      LOOP_STATE_DIR: process.env.LOOP_STATE_DIR,
    };
    delete process.env.AUTH0_DOMAIN;
    delete process.env.AUTH0_AUDIENCE;
    delete process.env.AMBIGUOUS_API_KEY;
    process.env.ALLOW_UNVERIFIED_WRITES = "1";
    dir = mkdtempSync(join(tmpdir(), "loop-boot-"));
    process.env.LOOP_STATE_DIR = dir;
    registerOutbound({ name: "slack", async send() { return { externalId: "s1" }; } });
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    proposals.reset();
    await bootstrapBoundary({ log: () => {}, persist: false, workspaceExecutor: async () => ({}) });
    rmSync(dir, { recursive: true, force: true });
  });

  it("registra el executor inyectado y reporta el estado de auth0 y workspace", async () => {
    const entries: string[] = [];
    const log: Logger = (msg) => { entries.push(msg); };
    const writes: string[] = [];
    const report = await bootstrapBoundary({
      log,
      persist: false,
      workspaceExecutor: async (tool) => { writes.push(tool); return { ok: true }; },
    });
    assert.equal(report.workspace, "custom");
    assert.equal(report.reader, "ambiguous");
    assert.equal(isWorkspaceReaderRegistered(), true);
    assert.equal(report.auth0, "bypass");
    assert.equal(report.statePaths, undefined);
    assert.ok(entries.some((m) => m.startsWith("AUTH0 BYPASS")));

    await executeApproved(proposal(), { log: () => {} });
    assert.deepEqual(writes, ["fixture_tool"]);
  });

  it("con persistencia crea los archivos de estado en LOOP_STATE_DIR", async () => {
    const report = await bootstrapBoundary({ log: () => {}, workspaceExecutor: async () => ({ ok: true }) });
    assert.ok(report.statePaths);
    assert.equal(report.statePaths.proposals, join(dir, "proposals.json"));
    proposals.save(proposal());
    assert.ok(existsSync(report.statePaths.proposals));
    await executeApproved(proposal(), { log: () => {} });
    assert.ok(existsSync(report.statePaths.idempotency));
  });

  it("sin AMBIGUOUS_API_KEY reporta unconfigured y la escritura falla visible", async () => {
    const entries: string[] = [];
    const report = await bootstrapBoundary({ log: (m) => { entries.push(m); }, persist: false });
    assert.equal(report.workspace, "unconfigured");
    assert.ok(entries.some((m) => m.includes("AMBIGUOUS_API_KEY ausente")));
    await assert.rejects(() => executeApproved(proposal(), { log: () => {} }), /AMBIGUOUS_API_KEY/);
  });

  it("acepta un lector inyectado y lo deja registrado para readTool", async () => {
    resetWorkspaceReader();
    const report = await bootstrapBoundary({
      log: () => {},
      persist: false,
      workspaceExecutor: async () => ({}),
      workspaceReader: fixtureReader({ "silentops.open-work-orders": { items: [{ id: "ot-1" }] } }),
    });
    assert.equal(report.reader, "custom");
    assert.deepEqual(await readTool("silentops.open-work-orders"), { items: [{ id: "ot-1" }] });
    await assert.rejects(() => readTool("silentops.current-shift"), /fixture faltante/);
  });

  it("sin Auth0 y sin bypass reporta blocked", async () => {
    delete process.env.ALLOW_UNVERIFIED_WRITES;
    const report = await bootstrapBoundary({ log: () => {}, persist: false, workspaceExecutor: async () => ({}) });
    assert.equal(report.auth0, "blocked");
  });
});
