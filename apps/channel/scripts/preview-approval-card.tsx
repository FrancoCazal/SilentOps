/**
 * preview-approval-card.tsx — see the real card without Slack, keys or backend.
 *
 * WHY THIS EXISTS: the SilentOps card is a Channels component, so it normally
 * only becomes visible inside a live Slack thread — which needs CHANNEL_CODE, an
 * INTELLIGENCE_API_KEY and a provisioned Channel (see TODO.md). None of that is
 * needed to see what the card DRAWS: this renders the same JSX through the same
 * Slack renderer the adapter uses and prints Block Kit JSON.
 *
 * Paste any of the emitted JSON files into https://app.slack.com/block-kit-builder
 * to see the card exactly as Slack renders it. That is a screenshot source for
 * the video that does not depend on a single credential.
 *
 * Run:  npm run preview:card -w channel
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToIR } from "@copilotkit/channels";
import { renderSlackMessage } from "@copilotkit/channels/slack/render";
import type { Proposal } from "loop-core/contracts";
import {
  handoverApprovalCard,
  handoverPresentNotice,
  approvedNotice,
  rejectedNotice,
  type AbsenceEvidence,
  type HandoverHeader,
} from "../src/approval-card";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "preview");

// Synthetic demo data only — matches the seeded hub in SILENTOPS.md. No real
// people, no temperatures, no safety claims.
const header: HandoverHeader = {
  shiftName: "Noche",
  closesAt: "06:00",
  outgoing: ["Ana"],
  incoming: ["Bruno"],
  facility: "Hub Frío Norte",
  date: "12 sep 2026",
};

const absent: AbsenceEvidence = {
  expectedRecord: "Handover Noche 2026-09-12",
  searchedIn: "Documents",
  searchedAt: "05:45",
  matches: [],
};

const proposal: Proposal = {
  id: "prop-demo-1",
  runId: "run-demo-1",
  sourceEventId: "missing-handover:Noche:2026-09-12",
  actions: [
    {
      kind: "workspace.write",
      tool: "documents.create",
      args: { title: "Handover Noche 2026-09-12" },
      summary: "Crear el documento de handover",
    },
    {
      kind: "workspace.write",
      tool: "workorders.reassign",
      args: { id: "WO-1042", assignee: "Bruno" },
      summary: "Reasignar #WO-1042 a Bruno",
    },
    {
      kind: "channel.send",
      channel: "slack",
      to: "#operaciones-hub-frio",
      body: "Handover Noche listo · 3 órdenes reasignadas a Bruno",
      summary: "Avisar en el canal con el link",
    },
  ],
  rationale:
    "Ana cierra turno con 3 órdenes abiertas y sin handover; preparo el documento y las reasigno a Bruno.",
  risk: "medium",
  status: "pending",
  createdAt: "2026-09-12T05:45:00-03:00",
  expiresAt: "2026-09-12T06:30:00-03:00",
};

const evidence = [
  {
    text: "Cámara 3: alerta de temperatura ya escalada por técnico a las 02:10",
    source: { url: "https://demo.local/canal/msg/2010", label: "mensaje" },
  },
  {
    text: "Generador de respaldo: chequeo pendiente del turno anterior",
    source: { url: "https://demo.local/wo/1043", label: "orden" },
  },
  {
    text: "Sensor del muelle de carga: seguimiento abierto, sin cerrar",
    source: { url: "https://demo.local/wo/1051", label: "orden" },
  },
];

const reassignedOrders = [
  { id: "WO-1042", title: "Inspección cámara fría", source: { url: "https://demo.local/wo/1042" } },
  { id: "WO-1043", title: "Chequeo generador", source: { url: "https://demo.local/wo/1043" } },
  { id: "WO-1051", title: "Sensor muelle de carga", source: { url: "https://demo.local/wo/1051" } },
];

/** Lower a card to what the Slack adapter would actually send. */
async function toBlockKit(node: unknown) {
  return renderSlackMessage(renderToIR((await node) as never));
}

const states = [
  {
    file: "01-pending.json",
    title: "PENDIENTE — evidencia de ausencia + propuesta, esperando a Ana",
    node: handoverApprovalCard({
      proposal,
      absence: absent,
      header,
      evidence,
      reassignedOrders,
      onApprove: async () => {},
    }),
  },
  {
    file: "02-approved.json",
    title: "APROBADA — la card que REEMPLAZA a la anterior tras el click de Ana",
    node: approvedNotice({ ...proposal, status: "approved", approvedBy: "Ana" }, header),
  },
  {
    file: "03-rejected.json",
    title: "RECHAZADA — decisión registrada, nada se escribió",
    node: rejectedNotice({ ...proposal, status: "rejected", approvedBy: "Ana" }),
  },
  {
    file: "04-silent.json",
    title: "SILENCIOSO — el handover ya existe, el agente no propone nada",
    node: handoverPresentNotice({
      absence: { ...absent, matches: [{ id: "doc-existing" }] },
      header,
      sourceUrl: "https://demo.local/doc/handover-noche",
    }),
  },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const state of states) {
  const { blocks, accent } = await toBlockKit(state.node);
  // Block Kit Builder takes { blocks }. The accent is the attachment colour the
  // adapter wraps the message in, so it is reported but kept separate.
  const payload = { blocks };
  const path = join(OUT_DIR, state.file);
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`\n${"─".repeat(72)}`);
  console.log(state.title);
  console.log(`${"─".repeat(72)}`);
  console.log(`accent: ${accent ?? "(none)"} · ${blocks.length} bloque(s)`);
  console.log(`escrito en: ${path}`);
  // The plain-text shape, so the absence line is verifiable at a glance.
  for (const line of JSON.stringify(blocks).matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)) {
    const text = line[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    if (text.trim()) console.log(`  │ ${text.split("\n").join("\n  │ ")}`);
  }
}

console.log(`\n${"─".repeat(72)}`);
console.log("Para VERLO como lo ve Slack:");
console.log("  1. abrí https://app.slack.com/block-kit-builder");
console.log(`  2. pegá el contenido de ${join(OUT_DIR, "01-pending.json")}`);
console.log("  3. screenshot → sirve para el video, sin una sola credencial.");
console.log(`${"─".repeat(72)}\n`);
