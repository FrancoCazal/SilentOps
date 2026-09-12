/** Superficie del paquete. Los adaptadores de canal importan de aca. */
export * from "./contracts";
export { handleEvent, buildProposal, renderEvent, PROPOSE_ACTION } from "./agent";
export { registerOutbound, outbound, registeredOutboundNames } from "./channels/outbound";
export { systemPrompt, DOMAIN_BRIEF } from "./domain/prompts";
export { readOnlyTools, toolDefinitions, handlerFor } from "./domain/tools";
export type { AgentTool, DomainTool, ToolHandler } from "./domain/tools";
export {
  executeApproved,
  registerWorkspaceExecutor,
  registerJobScheduler,
  SCOPE,
} from "./boundary/write";
export type { ExecutionResult, WorkspaceExecutor, JobScheduler } from "./boundary/write";
export { verifyScope, getServiceToken, isAuth0Configured, AuthorizationError } from "./boundary/auth0";
export { idempotencyKey, memoryStore, setIdempotencyStore } from "./boundary/idempotency";
export { ambiguousExecutor, listWorkplaceTools } from "./boundary/workplace-mcp";
export * as proposals from "./approval/store";
export { withFallback, isRetryable, forcedFailure, resolveFor } from "./model/with-fallback";
export type { ModelRef, ProviderName, Attempt } from "./model/with-fallback";
export { log, newRunId, loggerFor } from "./observability/log";
export type { Logger } from "./observability/log";
export { inProcessScheduler, dueJobs, pendingJobs } from "./jobs/followup";
export { readTool, setWorkplaceClientForTests } from "./boundary/workplace-mcp";
export { fileIdempotencyStore, fileProposalStore, defaultStatePaths } from "./boundary/file-store";
export { approveAndExecute, rejectProposal, HighRiskError, NotApprovedError } from "./boundary/write";
