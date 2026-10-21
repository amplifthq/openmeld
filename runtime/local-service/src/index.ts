// biome-ignore-all lint/performance/noBarrelFile: This package intentionally exposes a stable local-service carrier entrypoint.
export { createLocalAdapterEntries } from "./adapters/adapter-factory.js";
export { installAntigravityAdapter } from "./adapters/installers/install-antigravity.js";
export { installClaudeCodeAdapter } from "./adapters/installers/install-claude-code.js";
export { installCodexAdapter } from "./adapters/installers/install-codex.js";
export { installOpenClawAdapter } from "./adapters/installers/install-openclaw.js";
export { listLocalAdapterInstallers } from "./adapters/installers/list-installers.js";
export type {
  LocalAdapterInstaller,
  LocalAdapterInstallerInput,
} from "./adapters/installers/types.js";
export {
  createLocalAdapterContainer,
  type LocalDaemonAdapterContainer,
  type LocalDaemonAdapterEntry,
} from "./adapters/local-adapter-container.js";
export { resolveCatalogSyncSkippedProfilesLogState } from "./catalog-sync-skipped-profiles.js";
export {
  type CompatibleAgentContextMatch,
  resolveCompatibleAgentContextMatch,
  resolveCompatibleConversationExecutionState,
  resolveLatestScopedConversationExecutionState,
  type ScopedConversationExecutionStateMatch,
} from "./compatible-agent-context.js";
export {
  type ControlSignalResult,
  type InflightTaskControlRecord,
  type LocalControlAcceptedResponse,
  type LocalControlCommandName,
  type LocalControlPlaneRequest,
  type LocalControlRequestHandler,
  type LocalControlResolution,
  type LocalControlTargetSelector,
  type LocalTaskInterruptErrorCode,
  type LocalTaskInterruptSender,
  resolveUnixSignalForInterruptMode,
} from "./control-plane-types.js";
export { buildDaemonBootstrapRecommendationResult } from "./daemon-recommendation.js";
export {
  type DispatchContinuityObservation,
  type DispatchContinuityStatus,
  resolveDispatchContinuityObservation,
} from "./dispatch-continuity.js";
export {
  buildDispatchControllerKey,
  buildDispatchLocalExecutionLaneKey,
  type DispatchQueueLogMeta,
  type LocalServiceDispatchQueueTask,
  resolveDispatchQueueLogMeta,
} from "./dispatch-queue-routing.js";
export {
  ADAPTIVE_HEARTBEAT_GROWTH_FACTOR,
  ADAPTIVE_HEARTBEAT_JITTER_RATIO,
  applyAcceptedLeases,
  applyIntervalJitterMs,
  CATALOG_SYNC_INTERVAL_MULTIPLIER,
  MAX_CATALOG_SYNC_INTERVAL_MS,
  MAX_HEARTBEAT_INTERVAL_MS,
  MIN_CATALOG_SYNC_INTERVAL_MS,
  MIN_HEARTBEAT_INTERVAL_MS,
  pruneStaleLeases,
  resolveAdaptiveHeartbeatIntervalMs,
  resolveCatalogSyncIntervalMs,
} from "./heartbeat-policy.js";
export {
  createInflightTaskControlRegistry,
  type InflightTaskControlRegistry,
} from "./inflight-task-control-registry.js";
export {
  createLocalExecutionSlots,
  describeLocalExecutionSlotWait,
  type LocalExecutionResourceClaim,
  type LocalExecutionSlotCompletionEvent,
  type LocalExecutionSlotDiagnostics,
  type LocalExecutionSlotDropEvent,
  type LocalExecutionSlotLifecycleEvent,
  type LocalExecutionSlotRequestResult,
  type LocalExecutionSlotSharedFolderSession,
  type LocalExecutionSlotSnapshot,
  type LocalExecutionSlots,
  type LocalExecutionSlotTask,
  type LocalExecutionSlotTaskResult,
  type LocalExecutionSlotWaitReason,
  type LocalServiceDispatchLimits,
} from "./local-execution-slots.js";
export {
  buildLocalServiceDiagnosticsPayload,
  type LocalServiceDiagnosticsPayload,
} from "./local-service-diagnostics.js";
export { createLocalTaskInterruptSender } from "./local-task-signal-sender.js";
export {
  mergeOpenClawGatewayVisibility,
  type OpenClawGatewayVisibility,
} from "./openclaw-gateway-visibility.js";
export {
  createPendingAgentInteractionRegistry,
  type PendingAgentInteractionExecutionAuthority,
  type PendingAgentInteractionRegistry,
} from "./pending-agent-interaction-registry.js";
export {
  type DispatchPostMessageInputKind,
  type DispatchSendTargetProjectionEntry,
  type DispatchSendTargetReferenceLoadResult,
  normalizeDispatchPostMessageAction,
} from "./post-message-envelope.js";
export {
  buildDispatchReplyContextSummary,
  type DispatchReplyContextSummary,
} from "./reply-context.js";
export { createSerialAgentInteractionCallback } from "./serial-agent-interaction-callback.js";
export {
  type ProjectionSyncResultForReconcile,
  type ReconcileAction,
  type ReconcileDecision,
  type ReconcileDriftClass,
  type ReconcileOwner,
  type ReconcileSkipReason,
  resolveProjectionReconcileDecision,
  resolveRouteRegistrationReconcileDecision,
} from "./service-reconcile-decision.js";
export {
  createDaemonReconcileInProgressError,
  DAEMON_RECONCILE_IN_PROGRESS_CODE,
  DaemonReconcileInProgressError,
  isDaemonReconcileInProgressError,
} from "./service-reconcile-in-progress.js";
export {
  SPACE_ACTION_CONTEXT_GUIDANCE_LINES,
  SPACE_ACTION_TARGET_GUIDANCE_LINES,
} from "./space-action-target-guidance.js";
export {
  shouldSkipDaemonStartupCheck,
  shouldSkipDevAutoStartGuard,
  shouldSkipStartupUpgradeCheck,
} from "./startup-check-policy.js";
export {
  resolveStartupCommandCapability,
  type StartupCommandCapability,
} from "./startup-command-capability.js";
export { syncRuntimeEventToInflightTaskControlRegistry } from "./sync-runtime-event.js";
export { normalizeDispatchThreadAction } from "./thread-action.js";
