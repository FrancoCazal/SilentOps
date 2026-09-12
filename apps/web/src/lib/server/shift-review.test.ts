import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { registerWorkspaceReader, resetWorkspaceReader } from "loop-core";
import { clearShiftReviewCache, loadShiftReview } from "./shift-review";

/**
 * The live control-tower read, exercised against a fake workspace reader.
 *
 * There is no Ambiguous key in CI, so the real MCP path cannot be hit here. What
 * these cover is the logic that decides what a supervisor sees: which status a
 * given workspace produces, that provider shapes are coerced rather than trusted,
 * and that a failure becomes a rendered message instead of a thrown page.
 */

const DEMO_AT = "2026-09-12T05:45:00-03:00";

const nightShift = {
  name: "Noche",
  start: "22:00",
  end: "06:00",
  startAt: "2026-09-11T22:00:00-03:00",
  outgoing: ["Ana"],
  incoming: ["Bruno"],
};

type Reader = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

/** Register a reader that answers the four domain intents from a script. */
function useReader(script: Record<string, unknown | (() => never)>): void {
  const reader: Reader = async (tool) => {
    const entry = script[tool];
    if (typeof entry === "function") return (entry as () => never)();
    return entry ?? [];
  };
  registerWorkspaceReader(reader as never);
}

beforeEach(() => {
  process.env.AMBIGUOUS_API_KEY = "test-key";
  process.env.SILENTOPS_DEMO_AT = DEMO_AT;
  clearShiftReviewCache();
});

afterEach(() => {
  delete process.env.AMBIGUOUS_API_KEY;
  delete process.env.SILENTOPS_DEMO_AT;
  clearShiftReviewCache();
  resetWorkspaceReader();
});

test("no workspace key means the tower reports unconfigured, not an error", async () => {
  delete process.env.AMBIGUOUS_API_KEY;
  const review = await loadShiftReview();
  assert.equal(review.status, "unconfigured");
});

test("a closing shift with no handover reports the absence and its evidence", async () => {
  useReader({
    "silentops.current-shift": { shift: nightShift },
    "silentops.search-documents": [],
    "silentops.open-work-orders": [
      { id: "#WO-1042", title: "Cold room inspection", assignee: "Ana" },
      { title: "Generator check" },
    ],
    "silentops.channel-history": [
      { at: "02:10", author: "Ana", text: "escalated cold room 3" },
    ],
  });

  const review = await loadShiftReview();
  assert.equal(review.status, "missing");
  if (review.status !== "missing") return;

  assert.equal(review.expectedRecord, "Handover Noche 2026-09-12");
  assert.equal(review.shift.outgoing.join(), "Ana");
  assert.equal(review.shift.incoming.join(), "Bruno");
  assert.equal(review.shift.minutesToClose, 15);
  assert.equal(review.eventId, "missing-handover:Noche:2026-09-12");
  assert.equal(review.detectorFired, true);

  // Provider shapes are coerced, including the entry missing an id.
  assert.deepEqual(review.workOrders, [
    {
      id: "#WO-1042",
      title: "Cold room inspection",
      assignee: "Ana",
      status: undefined,
    },
    {
      id: undefined,
      title: "Generator check",
      assignee: undefined,
      status: undefined,
    },
  ]);
  assert.equal(review.messages[0].text, "escalated cold room 3");
});

test("the real provider's field names are handled, and UUIDs are never shown", async () => {
  // These shapes were read off the live Ambiguous workspace: tasks carry
  // `task_key` plus a UUID `id`, messages carry `content` and `created_at`, and
  // `author`/`assignee` arrive as objects.
  useReader({
    "silentops.current-shift": { shift: nightShift },
    "silentops.search-documents": [],
    "silentops.open-work-orders": [
      {
        id: "d7430b96-cad0-40bb-a3f4-979001231a2f",
        task_key: "TASK-001",
        title: "OT-241 — Inspeccionar sello de puerta · Camara 02",
        status: "in_progress",
        assignee: { name: "Ana" },
      },
    ],
    "silentops.channel-history": [
      {
        id: "63b2baad-28ba-411b-8f8f-62903d5f1c93",
        content: "Muelle 3: burlete desgastado detectado en recorrida.",
        created_at: "2026-09-12T15:44:17.936Z",
        author: { name: "Ana" },
      },
    ],
  });

  const review = await loadShiftReview();
  assert.equal(review.status, "missing");
  if (review.status !== "missing") return;

  const [order] = review.workOrders;
  assert.equal(order.id, "TASK-001", "the human reference must win over the UUID");
  assert.doesNotMatch(
    order.id ?? "",
    /^[0-9a-f]{8}-/i,
    "a provider UUID must never reach the page",
  );
  assert.equal(order.assignee, "Ana", "assignee objects must be flattened");
  assert.equal(order.status, "in_progress");

  const [message] = review.messages;
  assert.equal(
    message.text,
    "Muelle 3: burlete desgastado detectado en recorrida.",
    "`content` is the real message field; missing it renders (empty)",
  );
  assert.equal(message.author, "Ana", "author objects must be flattened");
  assert.match(message.at ?? "", /^\d{2}:\d{2}$/, "timestamps render as a clock");
});

test("an existing handover produces the silent state, never a proposal", async () => {
  useReader({
    "silentops.current-shift": { shift: nightShift },
    "silentops.search-documents": [{ id: "doc-1", title: "Handover Noche 2026-09-12" }],
  });

  const review = await loadShiftReview();
  assert.equal(review.status, "present");
  if (review.status !== "present") return;
  assert.equal(review.matchCount, 1);
  assert.equal(review.expectedRecord, "Handover Noche 2026-09-12");
});

test("outside the lead window the detector is idle even with no handover", async () => {
  process.env.SILENTOPS_DEMO_AT = "2026-09-12T01:00:00-03:00";
  useReader({
    "silentops.current-shift": { shift: nightShift },
    "silentops.search-documents": [],
  });

  const review = await loadShiftReview();
  assert.equal(review.status, "idle");
});

test("no shift on record is idle, not a failure", async () => {
  useReader({ "silentops.current-shift": undefined });
  const review = await loadShiftReview();
  assert.equal(review.status, "idle");
});

test("paginated provider envelopes are unwrapped", async () => {
  useReader({
    "silentops.current-shift": { shift: nightShift },
    "silentops.search-documents": { items: [], truncated: false, total: 0 },
    "silentops.open-work-orders": {
      items: [{ id: "#WO-1051", title: "Loading dock sensor" }],
      total: 1,
    },
    "silentops.channel-history": { results: [{ text: "shift opened" }] },
  });

  const review = await loadShiftReview();
  assert.equal(review.status, "missing");
  if (review.status !== "missing") return;
  assert.equal(review.workOrders.length, 1);
  assert.equal(review.workOrders[0].id, "#WO-1051");
  assert.equal(review.messages[0].text, "shift opened");
});

test("a reader failure becomes a renderable message that leaks no transport detail", async () => {
  useReader({
    "silentops.current-shift": () => {
      throw new Error("MCP 401 Bearer sk-secret-token rejected by ambiguous.ai");
    },
  });

  const review = await loadShiftReview();
  assert.equal(review.status, "error");
  if (review.status !== "error") return;
  assert.doesNotMatch(review.message, /sk-secret-token/);
  assert.doesNotMatch(review.message, /401/);
  assert.match(review.message, /AMBIGUOUS_API_KEY/);
});

test("the read is cached briefly, then re-read after the cache is cleared", async () => {
  let calls = 0;
  registerWorkspaceReader((async (tool: string) => {
    if (tool === "silentops.current-shift") {
      calls += 1;
      return { shift: nightShift };
    }
    return [];
  }) as never);

  await loadShiftReview();
  const afterFirst = calls;
  await loadShiftReview();
  assert.equal(calls, afterFirst, "a second render must reuse the cached read");

  clearShiftReviewCache();
  await loadShiftReview();
  assert.ok(calls > afterFirst, "clearing the cache must re-read the workspace");
});
