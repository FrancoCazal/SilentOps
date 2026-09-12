/**
 * CONTRATO CONGELADO (gate de las 10:00).
 *
 * El agente no ejecuta: propone. Una Proposal es serializable y viaja entera
 * hasta la card de Slack.
 */

export type ProposedAction =
  | {
      kind: "workspace.write";
      /** nombre EXACTO de la tool del MCP de Ambiguous. No inventar. */
      tool: string;
      args: Record<string, unknown>;
      summary: string;
    }
  | {
      kind: "channel.send";
      channel: string;
      to: string;
      body: string;
      summary: string;
    }
  | {
      kind: "job.schedule";
      job: string;
      /** ISO 8601 */
      runAt: string;
      payload: Record<string, unknown>;
      summary: string;
    };

export type ProposalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "edited"
  | "expired";

export type Risk = "low" | "medium" | "high";

export type Proposal = {
  id: string;
  /** run del agente que la genero; atraviesa logs, card y ejecucion */
  runId: string;
  /** InboundEvent.id que la origino */
  sourceEventId: string;
  actions: ProposedAction[];
  /** una frase, va en la card */
  rationale: string;
  risk: Risk;
  status: ProposalStatus;
  approvedBy?: string;
  editedActions?: ProposedAction[];
  createdAt: string;
  expiresAt: string;
};

/** Las acciones que realmente se ejecutan: las editadas ganan a las originales. */
export function effectiveActions(p: Proposal): ProposedAction[] {
  return p.editedActions ?? p.actions;
}
