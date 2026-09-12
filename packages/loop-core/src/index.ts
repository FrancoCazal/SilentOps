/** Superficie del paquete. Los adaptadores de canal importan de aca. */
export * from "./contracts";
export { handleEvent, buildProposal, renderEvent, PROPOSE_ACTION } from "./agent";
export { registerOutbound, outbound, registeredOutboundNames } from "./channels/outbound";
export { systemPrompt, DOMAIN_BRIEF } from "./domain/prompts";
export { readOnlyTools, toolDefinitions, handlerFor, TOOLS } from "./domain/tools";
export type { AgentTool, DomainTool, ToolHandler } from "./domain/tools";
export {
  readTool,
  registerWorkspaceReader,
  isWorkspaceReaderRegistered,
  resetWorkspaceReader,
  fixtureReader,
} from "./domain/workspace-reader";
export type { WorkspaceReader } from "./domain/workspace-reader";
export { detectMissingHandover, minutesUntil, localDateKey } from "./jobs/missing-handover";
export type { Shift, DetectOptions } from "./jobs/missing-handover";
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
export { callReadTool, setWorkplaceClientForTests } from "./boundary/workplace-mcp";
export { fileIdempotencyStore, fileProposalStore, defaultStatePaths } from "./boundary/file-store";
export { approveAndExecute, rejectProposal, HighRiskError, NotApprovedError } from "./boundary/write";
export { bootstrapBoundary } from "./boundary/bootstrap";
export type { BootstrapOptions, BootstrapReport } from "./boundary/bootstrap";
export { createAmbiguousWorkspaceWriter, renderHandover, WriteNotAllowedError, WRITE_INTENTS, WRITE_ALIASES, PASS_THROUGH_ALLOWLIST } from "./boundary/ambiguous-writer";
export type { WriterOptions, HandoverBullet } from "./boundary/ambiguous-writer";
export { WRITE_VOCABULARY_PROMPT, withWriteVocabulary } from "./boundary/write-vocabulary";
