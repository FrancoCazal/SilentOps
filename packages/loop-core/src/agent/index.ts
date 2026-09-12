/**
 * El loop: InboundEvent -> agente -> Proposal. Nada mas. La ejecucion vive
 * detras de la aprobacion humana, en boundary/write.ts.
 */
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { FreshRunAgent } from "./fresh-run-agent";
import type { InboundEvent } from "../channels/inbound";
import type { Proposal, ProposedAction, Risk } from "../approval/types";
import { systemPrompt } from "../domain/prompts";
import { handlerFor, toolDefinitions, type AgentTool } from "../domain/tools";
import { withFallback, type ModelRef } from "../model/with-fallback";
import { loggerFor, newRunId, type Logger } from "../observability/log";
import { PROPOSE_ACTION, WRITE_INTENTS } from "./propose-tool";
import { renderEvent } from "./render";

export type HandleOptions = {
  runId?: string;
  /** Los evals inyectan un modelo falso para no gastar creditos ni red. */
  model?: ModelRef;
  /** Minutos de vida de la propuesta antes de que Trigger.dev la venza. */
  ttlMinutes?: number;
  log?: Logger;
  prompt?: string;
};

type RawProposal = {
  kind: ProposedAction["kind"];
  summary: string;
  payload: Record<string, unknown>;
  risk: Risk;
  rationale: string;
};

const MAX_TURNS = 4;

export async function handleEvent(
  evt: InboundEvent,
  options: HandleOptions = {},
): Promise<Proposal> {
  const runId = options.runId ?? newRunId();
  const log = options.log ?? loggerFor(runId);
  const tools: AgentTool[] = [PROPOSE_ACTION, ...toolDefinitions()];

  log("event received", { channel: evt.channel, eventId: evt.id });

  const raw: RawProposal[] = [];

  const runWith = async (model: ModelRef) => {
    const prompt = options.prompt ?? systemPrompt();
    // Instancia interna nueva por run: ver fresh-run-agent.ts.
    const agent = new FreshRunAgent((threadId) => {
      const inner = new BuiltInAgent({ model, prompt, maxSteps: 10 });
      inner.threadId = threadId;
      return inner;
    }, runId);
    agent.addMessage({
      id: `${evt.id}-in`,
      role: "user",
      content: renderEvent(evt),
    });
    return runUntilSettled(agent, tools, raw, log);
  };

  // Un modelo inyectado (evals con EVAL_MOCK) no toca el entorno ni la red, asi
  // que tampoco pasa por el fallback de provider: no hay provider que caerse.
  const reply = options.model
    ? await runWith(options.model)
    : await withFallback(runWith, log);

  const proposal = buildProposal({ runId, evt, raw, ttlMinutes: options.ttlMinutes ?? 10 });

  // Una propuesta con 0 acciones despues de que el modelo SI llamo propose_action
  // significa que el payload no cumplia el contrato y se descarto en silencio.
  // Ese silencio cuesta horas de debug: dejar el payload crudo en el log.
  if (raw.length > 0 && proposal.actions.length < raw.length) {
    for (const candidate of raw) {
      if (toAction(candidate) === undefined) {
        log("propose_action descartada: payload incompleto para su kind", {
          kind: candidate.kind,
          summary: candidate.summary,
          payloadKeys: Object.keys(candidate.payload).join(", "),
          payload: JSON.stringify(candidate.payload).slice(0, 400),
        });
      }
    }
  }

  log("proposal built", {
    proposalId: proposal.id,
    actions: proposal.actions.length,
    risk: proposal.risk,
    reply: reply.slice(0, 120),
  });
  return proposal;
}

/**
 * propose_action y las tools de dominio son tools de AG-UI: el agente las
 * llama, se corta el run, el caller responde y se vuelve a correr. Cortamos a
 * MAX_TURNS para que un modelo en loop no se coma la demo.
 */
async function runUntilSettled(
  agent: FreshRunAgent,
  tools: AgentTool[],
  raw: RawProposal[],
  log: Logger,
): Promise<string> {
  const answered = new Set<string>();

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    await agent.runAgent({ tools: tools as never, context: [] });

    const pending = pendingToolCalls(agent, answered);
    if (pending.length === 0) return lastText(agent);

    for (const call of pending) {
      answered.add(call.id);
      const args = parseArgs(call.arguments);
      let result: unknown;

      if (call.name === PROPOSE_ACTION.name) {
        const parsed = coerceProposal(args);
        if (parsed) {
          raw.push(parsed);
          result = { queued: true, note: "Pendiente de aprobacion humana. No ejecutes nada." };
        } else {
          result = { queued: false, error: "payload incompleto para ese kind" };
        }
      } else {
        const handler = handlerFor(call.name);
        result = handler
          ? await handler(args).catch((e: unknown) => ({ error: String(e) }))
          : { error: `tool desconocida: ${call.name}` };
      }

      log("tool call", { tool: call.name, ok: !(result as { error?: string })?.error });
      agent.addMessage({
        id: `tool_${call.id}`,
        role: "tool",
        toolCallId: call.id,
        content: JSON.stringify(result),
      } as never);
    }
  }

  log("max turns reached");
  return lastText(agent);
}

type PendingCall = { id: string; name: string; arguments: string };

function pendingToolCalls(agent: FreshRunAgent, answered: Set<string>): PendingCall[] {
  const out: PendingCall[] = [];
  for (const message of agent.messages as unknown as Array<Record<string, unknown>>) {
    const calls = (message?.toolCalls ?? []) as Array<{
      id: string;
      function?: { name?: string; arguments?: string };
    }>;
    for (const call of calls) {
      if (!call?.id || answered.has(call.id)) continue;
      out.push({
        id: call.id,
        name: call.function?.name ?? "",
        arguments: call.function?.arguments ?? "{}",
      });
    }
  }
  return out;
}

function lastText(agent: FreshRunAgent): string {
  const messages = agent.messages as unknown as Array<Record<string, unknown>>;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "assistant" && typeof m.content === "string" && m.content.trim()) {
      return m.content;
    }
  }
  return "";
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function coerceProposal(args: Record<string, unknown>): RawProposal | undefined {
  const kind = args.kind as ProposedAction["kind"] | undefined;
  if (!kind || !["workspace.write", "channel.send", "job.schedule"].includes(kind)) return undefined;
  const payload = (args.payload ?? {}) as Record<string, unknown>;
  const risk = (["low", "medium", "high"] as const).includes(args.risk as Risk)
    ? (args.risk as Risk)
    : "medium";
  return {
    kind,
    summary: String(args.summary ?? "").trim() || "(sin resumen)",
    payload,
    risk,
    rationale: String(args.rationale ?? "").trim(),
  };
}

export function buildProposal(input: {
  runId: string;
  evt: InboundEvent;
  raw: RawProposal[];
  ttlMinutes: number;
}): Proposal {
  const { runId, evt, raw, ttlMinutes } = input;
  const now = new Date();
  const actions = raw.map(toAction).filter((a): a is ProposedAction => a !== undefined);

  return {
    id: crypto.randomUUID(),
    runId,
    sourceEventId: evt.id,
    actions,
    rationale: raw.map((r) => r.rationale).filter(Boolean).join(" ") || "(sin rationale)",
    risk: highestRisk(raw.map((r) => r.risk)),
    status: "pending",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
  };
}

function toAction(r: RawProposal): ProposedAction | undefined {
  const p = r.payload;
  switch (r.kind) {
    case "workspace.write": {
      const write = normalizeWrite(p);
      if (!write) return undefined;
      return {
        kind: "workspace.write",
        tool: write.tool,
        args: write.args,
        summary: r.summary,
      };
    }
    case "channel.send":
      if (typeof p.channel !== "string" || typeof p.to !== "string") return undefined;
      return {
        kind: "channel.send",
        channel: p.channel,
        to: p.to,
        body: String(p.body ?? ""),
        summary: r.summary,
      };
    case "job.schedule":
      if (typeof p.job !== "string" || typeof p.runAt !== "string") return undefined;
      return {
        kind: "job.schedule",
        job: p.job,
        runAt: p.runAt,
        payload: (p.payload ?? {}) as Record<string, unknown>,
        summary: r.summary,
      };
  }
}

/**
 * Normaliza el payload de un workspace.write a { tool, args }.
 *
 * Los modelos aplanan: en vez de `{ tool, args: { id, assignee } }` mandan
 * `{ order_id, assignee }`. Verificado con Gemini. Antes eso se descartaba en
 * silencio y la propuesta salia vacia, o sea el producto entero no funcionaba
 * con un LLM real.
 *
 * La tolerancia es acotada a proposito: se clasifica SOLO contra las tres
 * intenciones del dominio y por los campos que cada una exige. Lo que no
 * clasifica se descarta (y queda en el log). No se adivina ni se inventa una
 * tool del proveedor: los nombres de tools MCP siguen viviendo solo en el
 * boundary.
 */
function normalizeWrite(
  p: Record<string, unknown>,
): { tool: string; args: Record<string, unknown>; inferred?: string } | undefined {
  const nested = (p.args ?? {}) as Record<string, unknown>;
  // Campos sueltos ganan solo si args no los trae: el modelo puede mandar ambos.
  const flat: Record<string, unknown> = { ...p, ...nested };
  delete flat.tool;
  delete flat.args;

  const declared = typeof p.tool === "string" ? p.tool.trim() : "";
  const known = Object.values(WRITE_INTENTS) as string[];
  if (declared) {
    // Un nombre declarado se respeta tal cual, sea una intencion del dominio o
    // no. Decidir si una tool se puede ejecutar NO es trabajo de esta capa: lo
    // valida el boundary contra el catalogo vivo (invariante 2). Duplicar ese
    // juicio aca solo crea dos politicas que se contradicen.
    return {
      tool: declared,
      args: hasKeys(nested) ? nested : flat,
      inferred: known.includes(declared) ? undefined : "declared-passthrough",
    };
  }

  // Sin `tool`, el modelo aplano el payload. Clasificar contra las tres
  // intenciones del dominio por los campos que cada una exige.
  const id = firstString(flat, ["id", "key", "workOrder", "order_id", "task_id", "task_key"]);
  const assignee = firstString(flat, ["assignee", "assignee_id", "to"]);
  const note = firstString(flat, ["note", "comment"]);
  const title = firstString(flat, ["title", "document_name", "name"]);

  if (id && assignee) {
    return {
      tool: WRITE_INTENTS.reassignWorkOrder,
      args: { ...flat, id, assignee },
      inferred: "flattened",
    };
  }
  if (id && note) {
    return {
      tool: WRITE_INTENTS.annotateWorkOrder,
      args: { ...flat, id, note },
      inferred: "flattened",
    };
  }
  if (title && (Array.isArray(flat.bullets) || typeof flat.content === "string")) {
    return {
      tool: WRITE_INTENTS.createHandover,
      args: { ...flat, title },
      inferred: "flattened",
    };
  }

  return undefined;
}

function hasKeys(o: Record<string, unknown>): boolean {
  return Object.keys(o).length > 0;
}

function firstString(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = o[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function highestRisk(risks: Risk[]): Risk {  if (risks.includes("high")) return "high";
  if (risks.includes("medium")) return "medium";
  return risks.length ? "low" : "low";
}

export { renderEvent } from "./render";
export { PROPOSE_ACTION } from "./propose-tool";
