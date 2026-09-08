// biome-ignore-all lint/performance/noBarrelFile: Package entrypoint intentionally re-exports local execution contracts.

export { DEFAULT_TASK_LIFECYCLE_HEARTBEAT_INTERVAL_MS } from "@openmeld/agent-runtime";

export {
  ADAPTER_ROUTE_ERROR_CODES,
  type AdapterRouteErrorCode,
  type AdapterRouteFailure,
  type AdapterRouteInput,
  type AdapterRouteResult,
  type AdapterRouteSuccess,
  type AdapterRouteTarget,
  resolveAdapterRoute,
  toDispatchFailureFromRouteFailure,
} from "./adapter-routing.js";
export {
  type AgentContextLifecycleReason,
  type AgentContextLookupKeyInput,
  type AgentContextResolutionResult,
  type AgentContextScopeInput,
  buildAgentContextLookupKey,
  isAgentContextCompatibleWithLookupKeyInput,
  isAgentContextCompatibleWithScopeInput,
  listCompatibleAgentContextLookupKeys,
  resolveAgentContextConversationProfileConflict,
  resolveAgentContextForDispatch,
} from "./agent-context-policy.js";
export {
  buildControlPlaneResponse,
  type OpenMeldDaemonControlPlaneContext,
  parseControlPlaneRequest,
} from "./control-plane.js";
export {
  buildAuthenticatedControlPlaneResponse,
  verifyControlPlaneToken,
} from "./control-plane-auth.js";
export {
  assertSameBindingFifo,
  type BindingDispatchRecord,
  buildIdempotencyKey,
  DATA_PLANE_DEFAULTS,
  hasRequiredObservabilityFields,
  shouldBypassDedupeForDeliveryRecoveryReason,
  shouldDedupeWithinWindow,
} from "./data-plane-contract.js";
export {
  type ExternalHealthState,
  HEALTH_REASON_CODE_BY_RUNTIME_STATE,
  HEARTBEAT_POLICY_DEFAULTS,
  heartbeatSentCountPerMinute,
  isHealthReasonCodeConsistent,
  mapRuntimeHealthToExternalHealth,
  type RuntimeHealthState,
  reconnectSuccessRate,
  resolveHealthReasonCode,
  suspectTransitionRatePerMinute,
} from "./heartbeat-policy.js";
export {
  appendLedgerHistoryEntry,
  bumpAgentContextLifecycleCounters,
  commitResolvedAgentContext,
  createEmptyLedgerState,
  LEDGER_STATE_BACKUP_ERROR,
  LEDGER_STATE_INVALID_JSON_ERROR,
  LEDGER_STATE_SCHEMA_ERROR,
  LEDGER_STATE_VERSION,
  type LedgerFileIo,
  type LedgerPaths,
  listAgentContexts,
  loadLedgerState,
  type OpenMeldDaemonAgentContextLifecycleCounters,
  type OpenMeldDaemonAgentContextState,
  type OpenMeldDaemonHistoryEntry,
  type OpenMeldDaemonInflightTaskState,
  type OpenMeldDaemonLedgerStateV1,
  parseLedgerState,
  persistLedgerState,
  recordDedupeFirstSeenAt,
  removeAgentContext,
  removeConversationExecutionState,
  resolveAgentContextByLookupKey,
  resolveConversationExecutionStateByLookupKey,
  resolveDedupeFirstSeenAt,
  seedLegacyAgentContext,
  settleInflightTask,
  upsertAgentContext,
  upsertConversationExecutionState,
  upsertInflightTask,
  withLedgerStateTransaction,
} from "./ledger-store.js";
export {
  buildMentionDispatchResultEnvelope,
  MENTION_DISPATCH_ERROR_CODES,
  type MentionDispatchDecision,
  type MentionTargetBindingState,
  type MentionTargetResolution,
} from "./mention-decision-chain.js";
export {
  dispatchMentionOnlyTask,
  dispatchMentionOnlyTaskWithRouting,
  type MentionOnlyDispatchInput,
  type MentionOnlyDispatchResult,
  type MentionOnlyDispatchWithRoutingInput,
  type MentionOnlyDispatchWithRoutingResult,
} from "./mention-dispatch-integration.js";
export {
  buildCompensationExecutionPlan,
  buildTaskResultPayloadFromOutcome,
  COMPENSATION_DELAYS_MS,
  type CompensationStep,
  getCompensationDelayMs,
  isCompensationAttemptAllowed,
  markRecoveryReplayCommitted,
  planRecoveryReplay,
  type RecoveryReplayCandidate,
  type RecoveryRuntimeState,
  resolveCompensationProgress,
  settleRecoveredTask,
  type TaskResultErrorType,
} from "./recovery-policy.js";
export { buildTaskResultEnvelope } from "./result-envelope.js";
export {
  type RuntimeAgentContextLifecycle,
  type RuntimeDispatchResult,
  type RuntimeTask,
  type RuntimeTaskInput,
  type RuntimeTaskResult,
  runRuntimeTask,
} from "./runtime-task-orchestrator.js";
export { buildRuntimeWorkspaceFingerprint } from "./runtime-workspace-fingerprint.js";
export {
  INITIAL_SCHEDULER_STATE,
  SCHEDULER_POLICY_DEFAULTS,
  type ScheduledDispatch,
  type SchedulerPriority,
  type SchedulerState,
  type SchedulerTask,
  selectNextTask,
  simulateSchedulerDispatch,
} from "./scheduler-policy.js";
export {
  runSchedulerRuntimeSimulation,
  type SchedulerRuntimeResult,
  type SchedulerRuntimeSimulationInput,
  type SchedulerRuntimeTask,
} from "./scheduler-runtime-simulator.js";
export {
  shouldDispatchForMentionOnly,
  type TriggerMode,
} from "./trigger-policy.js";
