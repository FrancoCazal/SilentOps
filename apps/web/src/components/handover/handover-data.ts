/**
 * Shared demo data for the two read-only handover surfaces: the approval-card
 * preview on the landing page and the control tower at /console.
 *
 * This is the single source of truth for the product claims both surfaces
 * repeat, so they cannot drift apart. Presentation is deliberately NOT shared —
 * the two surfaces have different chrome and will keep diverging.
 *
 * Synthetic data only, per SILENTOPS.md: no real people, assets, phone numbers,
 * customer records, temperature thresholds, or safety statements. Nothing here
 * writes anything; the states below are local UI state.
 *
 * The Spanish strings are records from the demo workspace (channel name,
 * facility, the expected document name), not prose. They stay verbatim so the
 * search trace matches what the detector actually logs.
 */

export type View = "pending" | "approved" | "rejected" | "silent";

export const FACILITY = "Hub Frío Norte";
export const CHANNEL = "#operaciones-hub-frio";
export const EXPECTED_RECORD = "Handover Noche 2026-09-12";
export const SHIFT_DATE = "12 Sep 2026";

export const tabs: readonly { id: View; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "silent", label: "Silent" },
];

export type ViewCopy = {
  /** Wall clock shown for this state. */
  clock: string;
  /** Result count of the deterministic document search. */
  result: string;
  /** True when the expected handover was NOT found. */
  resultMissing: boolean;
  /** The `matches:` line under the search trace. */
  note: string;
  /** Card subline: what has and has not been written. */
  subline: string;
  /** Heading above the work-order list. */
  ordersLabel: string;
};

export const views: Record<View, ViewCopy> = {
  pending: {
    clock: "05:45",
    result: "0 results",
    resultMissing: true,
    note: "matches: [] · deterministic query, no match in the shift's document index.",
    subline: "pending approval · nothing written yet",
    ordersLabel: "Work orders to reassign to Bruno:",
  },
  approved: {
    clock: "05:47",
    result: "0 results",
    resultMissing: true,
    note: "matches: [] · document created just now, after Ana's approval.",
    subline: "proposal applied · write authorized by a human",
    ordersLabel: "Work orders reassigned to Bruno:",
  },
  rejected: {
    clock: "05:47",
    result: "0 results",
    resultMissing: true,
    note: "matches: [] · the proposal was discarded; nothing was written.",
    subline: "proposal discarded · nothing written",
    ordersLabel: "Work orders still unassigned:",
  },
  silent: {
    clock: "05:45",
    result: "1 result",
    resultMissing: false,
    note: "matches: [1] · a handover document already exists for this shift.",
    subline: "no proposal · the detector found nothing to do",
    ordersLabel: "",
  },
};

/** The proposal summary the agent drafts. */
export const SUMMARY =
  "Ana is closing her shift with 3 open work orders and no handover; I will prepare the document and reassign them to Bruno.";

/** Sourced evidence bullets. Every one cites a message or work order. */
export const evidence = [
  "Cold room 3: temperature alert already escalated by a technician at 02:10",
  "Backup generator: check still pending from the previous shift",
  "Loading dock sensor: follow-up open, not closed",
] as const;

/** The three open work orders from the demo workspace. */
export const workOrders = [
  { id: "#WO-1042", title: "Cold room inspection" },
  { id: "#WO-1043", title: "Backup generator check" },
  { id: "#WO-1051", title: "Loading dock sensor" },
] as const;

/** Shift ledger entries before the shift boundary. Identical in every state. */
export const ledger = [
  { time: "22:10", detail: "Shift opened · Sector B logged" },
  { time: "23:40", detail: "Sector round completed by a technician" },
  { time: "01:15", detail: "Work order #WO-1042 opened · Cold room 3" },
  { time: "02:10", detail: "Escalation to a technician logged · Cold room 3" },
  { time: "03:20", detail: "Follow-up opened · loading dock sensor" },
  { time: "05:30", detail: "Last channel message · 3 work orders still open" },
] as const;

/** The 06:00 ledger row. This is the row whose absence is the whole product. */
export type LedgerClose = {
  time: string;
  tone: "missing" | "done" | "refused" | "quiet";
  title: string;
  note?: string;
};

export const ledgerClose: Record<View, LedgerClose> = {
  pending: {
    time: "06:00",
    tone: "missing",
    title: "Handover: missing",
    note: "required at shift close · not recorded",
  },
  approved: {
    time: "06:00",
    tone: "done",
    title: "Handover: Ana → Bruno ✓",
    note: "recorded at shift close · 3 work orders reassigned",
  },
  rejected: {
    time: "06:00",
    tone: "refused",
    title: "Handover: still not recorded ✕",
    note: "proposal rejected by Ana · nothing written",
  },
  silent: {
    time: "06:00",
    tone: "quiet",
    title: "Handover already present in Documents · no agent action",
  },
};

/* ------------------------------------------------------------- history ---- */

/**
 * What the detector did at each past shift boundary.
 *
 * `outcome` is the whole point of the history view: "silent" rows are shifts
 * where the handover already existed and the agent correctly did nothing. A
 * history that only listed detections would hide the agent's restraint.
 */
export type HistoryOutcome = "approved" | "rejected" | "silent";

export type HistoryEntry = {
  id: string;
  date: string;
  shift: "Night" | "Morning";
  outgoing: string;
  incoming: string;
  /** Result count the deterministic document search returned. */
  searchResults: number;
  outcome: HistoryOutcome;
  /** What was written, or explicitly what was not. */
  result: string;
  decidedAt?: string;
  decidedBy?: string;
};

export const history: readonly HistoryEntry[] = [
  {
    id: "2026-09-12-night",
    date: "12 Sep 2026",
    shift: "Night",
    outgoing: "Ana",
    incoming: "Bruno",
    searchResults: 0,
    outcome: "approved",
    result: "Handover created · 3 work orders reassigned",
    decidedAt: "05:47",
    decidedBy: "Ana",
  },
  {
    id: "2026-09-11-morning",
    date: "11 Sep 2026",
    shift: "Morning",
    outgoing: "Bruno",
    incoming: "Ana",
    searchResults: 1,
    outcome: "silent",
    result: "Handover already present · no proposal",
  },
  {
    id: "2026-09-11-night",
    date: "11 Sep 2026",
    shift: "Night",
    outgoing: "Ana",
    incoming: "Bruno",
    searchResults: 0,
    outcome: "rejected",
    result: "Proposal rejected · nothing written",
    decidedAt: "05:52",
    decidedBy: "Ana",
  },
  {
    id: "2026-09-10-morning",
    date: "10 Sep 2026",
    shift: "Morning",
    outgoing: "Bruno",
    incoming: "Ana",
    searchResults: 1,
    outcome: "silent",
    result: "Handover already present · no proposal",
  },
  {
    id: "2026-09-10-night",
    date: "10 Sep 2026",
    shift: "Night",
    outgoing: "Ana",
    incoming: "Bruno",
    searchResults: 0,
    outcome: "approved",
    result: "Handover created · 1 work order reassigned",
    decidedAt: "05:49",
    decidedBy: "Ana",
  },
  {
    id: "2026-09-09-morning",
    date: "9 Sep 2026",
    shift: "Morning",
    outgoing: "Bruno",
    incoming: "Ana",
    searchResults: 1,
    outcome: "silent",
    result: "Handover already present · no proposal",
  },
] as const;

/* ------------------------------------------------------------ settings ---- */

/** Shift schedule the detector reads its boundaries from. */
export const shifts = [
  { name: "Night", window: "22:00 → 06:00", roster: "Ana → Bruno" },
  { name: "Morning", window: "06:00 → 14:00", roster: "Bruno → Ana" },
] as const;

/** Detector parameters. Deterministic on purpose — no model involved. */
export const detector = [
  { label: "Runs at", value: "15 minutes before shift close (05:45 for 06:00)" },
  { label: "Searches", value: "Documents" },
  { label: "Expected record", value: "Handover <Shift> <YYYY-MM-DD>" },
  { label: "On no match", value: "Emit InboundEvent carrying the absence evidence" },
  { label: "On match", value: "Stay silent — no proposal, no message" },
] as const;

/**
 * Guardrails, stated as the product states them. Read-only: these are not
 * toggles. Anything switchable here would be a way to turn a safety property
 * off from a browser.
 */
export const guardrails = [
  "The model can only emit propose_action; it cannot write or send directly.",
  "Every write passes the boundary, which checks an Auth0 scope and applies an idempotency key.",
  "A request such as “close every work order” is marked high risk and never performed automatically.",
  "An instruction embedded in a channel message or work-order description is data, never authority.",
  "No clinical data, safety determination, machine control or physical-world command is in scope.",
] as const;
