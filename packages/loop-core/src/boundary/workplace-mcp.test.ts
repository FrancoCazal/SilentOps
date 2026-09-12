import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  ambiguousExecutor,
  listWorkplaceTools,
  callReadTool,
  setWorkplaceClientForTests,
  type WorkplaceClient,
} from "./workplace-mcp";

const API_KEY = "test-api-key";
const ORIGINAL_API_KEY = process.env.AMBIGUOUS_API_KEY;

function fakeClient(overrides: Partial<WorkplaceClient> = {}): WorkplaceClient {
  return {
    async callTool() {
      return { content: [] };
    },
    async listTools() {
      return { tools: [] };
    },
    ...overrides,
  };
}

function transportError(code: string): Error & { code: string } {
  return Object.assign(new Error(`transport failed: ${code}`), { code });
}

describe("workplace MCP", () => {
  beforeEach(() => {
    setWorkplaceClientForTests(undefined);
    delete process.env.AMBIGUOUS_API_KEY;
  });

  afterEach(() => {
    setWorkplaceClientForTests(undefined);
    if (ORIGINAL_API_KEY === undefined) delete process.env.AMBIGUOUS_API_KEY;
    else process.env.AMBIGUOUS_API_KEY = ORIGINAL_API_KEY;
  });

  it("calls the exact read tool with its arguments and a 30 second timeout", async () => {
    process.env.AMBIGUOUS_API_KEY = API_KEY;
    let received: unknown[] | undefined;
    setWorkplaceClientForTests(
      fakeClient({
        async callTool(...args) {
          received = args;
          return { content: [{ type: "text", text: '{"matches":[]}' }] };
        },
      }),
    );

    const result = await callReadTool("fixture.search", { query: "handover" });

    assert.deepEqual(result, { matches: [] });
    assert.deepEqual(received, [
      { name: "fixture.search", arguments: { query: "handover" } },
      undefined,
      { timeout: 30_000 },
    ]);
  });

  it("rejects a missing API key before invoking a cached fake client", async () => {
    let calls = 0;
    setWorkplaceClientForTests(
      fakeClient({
        async callTool() {
          calls += 1;
          return { content: [] };
        },
      }),
    );

    await assert.rejects(() => callReadTool("fixture.read", {}), /AMBIGUOUS_API_KEY no configurado/);
    assert.equal(calls, 0);
  });

  it("treats a blank API key as missing before invoking a cached fake client", async () => {
    process.env.AMBIGUOUS_API_KEY = "   ";
    let calls = 0;
    setWorkplaceClientForTests(
      fakeClient({
        async callTool() {
          calls += 1;
          return { content: [] };
        },
      }),
    );

    await assert.rejects(() => callReadTool("fixture.read", {}), /AMBIGUOUS_API_KEY no configurado/);
    assert.equal(calls, 0);
  });

  it("prefers structured content over text content", async () => {
    process.env.AMBIGUOUS_API_KEY = API_KEY;
    setWorkplaceClientForTests(
      fakeClient({
        async callTool() {
          return {
            structuredContent: { records: [{ id: "record-1" }] },
            content: [{ type: "text", text: '{"ignored":true}' }],
          };
        },
      }),
    );

    assert.deepEqual(await callReadTool("fixture.read", {}), { records: [{ id: "record-1" }] });
  });

  it("returns content when a single text block is not JSON", async () => {
    process.env.AMBIGUOUS_API_KEY = API_KEY;
    const content = [{ type: "text" as const, text: "plain text" }];
    setWorkplaceClientForTests(fakeClient({ async callTool() { return { content }; } }));

    assert.deepEqual(await callReadTool("fixture.read", {}), content);
  });

  it("returns all content blocks when the result has more than one", async () => {
    process.env.AMBIGUOUS_API_KEY = API_KEY;
    const content = [
      { type: "text" as const, text: '{"first":true}' },
      { type: "text" as const, text: "second" },
    ];
    setWorkplaceClientForTests(fakeClient({ async callTool() { return { content }; } }));

    assert.deepEqual(await callReadTool("fixture.read", {}), content);
  });

  it("throws the MCP error text when the tool reports isError", async () => {
    process.env.AMBIGUOUS_API_KEY = API_KEY;
    setWorkplaceClientForTests(
      fakeClient({
        async callTool() {
          return { isError: true, content: [{ type: "text", text: "document query failed" }] };
        },
      }),
    );

    await assert.rejects(() => callReadTool("fixture.read", {}), /document query failed/);
  });

  it("gives isError priority over an extra toolResult field", async () => {
    process.env.AMBIGUOUS_API_KEY = API_KEY;
    setWorkplaceClientForTests(
      fakeClient({
        async callTool() {
          return {
            isError: true,
            toolResult: { misleading: "success" },
            content: [{ type: "text", text: "authoritative failure" }],
          };
        },
      }),
    );

    await assert.rejects(() => callReadTool("fixture.read", {}), /authoritative failure/);
  });

  it("rejects a legacy toolResult-only response instead of returning an ambiguous value", async () => {
    process.env.AMBIGUOUS_API_KEY = API_KEY;
    setWorkplaceClientForTests(
      fakeClient({
        async callTool() {
          return { toolResult: { legacy: true } };
        },
      }),
    );

    await assert.rejects(() => callReadTool("fixture.read", {}), /respuesta sin content/);
  });

  it("discards the cached client after transient read failures", async (t) => {
    process.env.AMBIGUOUS_API_KEY = API_KEY;
    let connects = 0;
    t.mock.method(Client.prototype, "connect", async () => {
      connects += 1;
    });
    t.mock.method(Client.prototype, "callTool", async () => ({
      content: [{ type: "text", text: '{"fresh":true}' }],
    }));

    const failures = [
      new Error("wrapped reset", { cause: transportError("ECONNRESET") }),
      transportError("ETIMEDOUT"),
      Object.assign(new Error("aborted"), { name: "AbortError" }),
      Object.assign(new Error("timed out"), { name: "TimeoutError" }),
    ];

    for (const failure of failures) {
      setWorkplaceClientForTests(
        fakeClient({
          async callTool() {
            throw failure;
          },
        }),
      );
      await assert.rejects(() => callReadTool("fixture.read", {}));
      assert.deepEqual(await callReadTool("fixture.read", {}), { fresh: true });
    }
    assert.equal(connects, failures.length);
  });

  it("discards the cached client after an SDK timeout from listTools", async (t) => {
    process.env.AMBIGUOUS_API_KEY = API_KEY;
    setWorkplaceClientForTests(
      fakeClient({
        async listTools() {
          throw Object.assign(new Error("request timed out"), { code: -32_001 });
        },
      }),
    );
    let connects = 0;
    t.mock.method(Client.prototype, "connect", async () => {
      connects += 1;
    });
    t.mock.method(Client.prototype, "listTools", async () => ({ tools: [] }));

    await assert.rejects(() => listWorkplaceTools(), /request timed out/);
    assert.deepEqual(await listWorkplaceTools(), []);
    assert.equal(connects, 1);
  });

  it("discards the cached client after a transient executor failure", async (t) => {
    process.env.AMBIGUOUS_API_KEY = API_KEY;
    setWorkplaceClientForTests(
      fakeClient({
        async callTool() {
          throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
        },
      }),
    );
    let connects = 0;
    t.mock.method(Client.prototype, "connect", async () => {
      connects += 1;
    });
    t.mock.method(Client.prototype, "callTool", async () => ({ content: [] }));

    await assert.rejects(() => ambiguousExecutor("fixture.write", {}), /connection refused/);
    await ambiguousExecutor("fixture.write", {});
    assert.equal(connects, 1);
  });
});
