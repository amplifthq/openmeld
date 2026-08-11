// biome-ignore-all lint/performance/noBarrelFile: Shared start package intentionally exposes a stable root entrypoint.
export { buildOnboardingPlan } from "./planner/onboarding-plan";
export { buildDaemonRouteObservationPresentation } from "./presentation/profile-readiness";
export {
  getSetupFlowCopy,
  PREPARE_SESSION_RECONNECT_GRACE_MS,
  resolveSetupComputerActiveSummary,
  type SetupComputerInternalStepId,
  type SetupFlowCopy,
  type SetupFlowMode,
} from "./presentation/setup-flow-copy";
export {
  type ComputerReplyReadiness,
  type ComputerReplyReadinessReasonCode,
  type ComputerReplyReadinessServiceVersion,
  type ComputerReplyReadinessStatus,
  type ResolveComputerReplyReadinessInput,
  resolveComputerReplyReadiness,
  shouldUseCompletedPrepareSessionForComputerReadiness,
} from "./recovery/computer-reply-readiness";
