import {
  agentInteractionRequestSchema,
  agentInteractionResponseSchema,
  buildRuntimeCoordinatorFailurePublicationCommandId,
  buildRuntimeCoordinatorFinalizationCommandId,
  daemonServiceLaneSchema,
  RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION,
  RUNTIME_COORDINATOR_FAILURE_PUBLICATION_COMMAND_MODEL_VERSION,
  runtimeCoordinatorExecutionTokenAuthorityRecordSchema,
  runtimeTransportDeliverDispatchRequestSchema,
  RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE as SHARED_RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE,
} from "@openmeld/schemas";
import type {
  AgentInteractionRequest,
  AgentInteractionResponse,
  DaemonServiceLane,
  OpenMeldDaemonAcceptedDispatchSnapshot,
  RuntimeCoordinatorExecutionEventType,
  RuntimeCoordinatorExecutionRecord,
  RuntimeCoordinatorExecutionStatus,
  RuntimeCoordinatorExecutionTokenAuthorityRecord,
  RuntimeCoordinatorFailurePublicationCommand,
  RuntimeCoordinatorFailurePublicationFinalMessageKind,
  RuntimeCoordinatorFailurePublicationOutcome,
  RuntimeCoordinatorFinalizationCommand,
  RuntimeCoordinatorFinalizationOutcome,
  RuntimeCoordinatorTerminalOutcome,
  RuntimeCoordinatorTokenAuthorityScope,
  RuntimeCoordinatorTokenExecutionScope,
  RuntimeCoordinatorTokenReasonCode,
  RuntimeCoordinatorTokenRunAuthority,
  RuntimeCoordinatorTokenStatus,
  RuntimeTransportDeliverDispatchRequest,
  RuntimeTransportDispatchLifecyclePhase,
  RuntimeTransportDispatchLifecycleRequest,
  RuntimeTransportPreExecutionHandoffReasonCode,
  RuntimeTransportPreExecutionHandoffRequest,
  RuntimeTransportRuntimeCoordinatorDecisionRequest,
  RuntimeTransportRuntimeCoordinatorDecisionResponse,
  RuntimeTransportRuntimeCoordinatorHeadAcceptRequest,
  RuntimeTransportRuntimeCoordinatorHeadNoExecutionPublicationCategory,
  RuntimeTransportRuntimeCoordinatorHeadNoExecutionReasonCode,
  RuntimeTransportRuntimeCoordinatorHeadNoExecutionRecoveryAction,
  RuntimeTransportRuntimeCoordinatorHeadNoExecutionRequest,
  RuntimeTransportRuntimeCoordinatorHeadPreAgentStopReasonCode,
  RuntimeTransportRuntimeCoordinatorHeadPreAgentStopRequest,
  RuntimeTransportRuntimeCoordinatorHeadWaitingRequest,
  RuntimeTransportSubmitTaskResultRequest,
  TargetWakeLifecycleIdentity,
} from "@openmeld/schemas/types";
import { RUNTIME_COORDINATOR_PROGRESS_EVIDENCE_WATCHDOG_INTERVAL_MS } from "../../strategy-constants";
import { retireRuntimeCoordinatorTokenRun } from "./runtime-coordinator-execution-token";
import { normalizeOptionalText } from "./runtime-transport-normalization";

export type RuntimeCoordinatorTokenValidationFrameKind =
  | "interaction_delivered"
  | "interaction_request"
  | "lifecycle"
  | "result"
  | "runtime_evidence"
  | "tool_activity";
export type RuntimeCoordinatorTokenValidationContext = {
  authorityScope: RuntimeCoordinatorTokenAuthorityScope;
  executionScope: RuntimeCoordinatorTokenExecutionScope;
  runtimeCoordinatorExecutionId: string;
};

export type ReplayRuntimeCoordinatorFinalizationCommandInput = {
  attemptId: string;
  dispatchId: string;
  executionTokenRunId: string;
  runtimeCoordinatorExecutionId: string;
  spaceId: string;
};
export type ReplayRuntimeCoordinatorFinalizationCommandResponse =
  | { ok: true; outcome: RuntimeCoordinatorFinalizationOutcome }
  | {
      ok: true;
      reasonCode: "runtime_coordinator.wake_stop_requested";
      status: "suppressed";
    }
  | {
      ok: false;
      reasonCode: "daemon.result.finalization_unavailable";
      status: "retry_later";
    };
export type RuntimeCoordinatorFinalizationReplayFailure = Extract<
  ReplayRuntimeCoordinatorFinalizationCommandResponse,
  { ok: false }
> & {
  blockerReasonCode?: "runtime_coordinator.finalization_command_missing";
  publicationUncertain?: boolean;
  retryable: boolean;
};
export type RuntimeCoordinatorFinalizationRetryEntry = {
  attemptCount: number;
  attemptId: string;
  dispatchId: string;
  executionTokenRunId: string;
  finalizationCommandId: string;
  firstFailureAtMs: number;
  nextReplayAtMs: number;
  runtimeCoordinatorExecutionId: string;
  spaceId: string;
  targetProfileId: string | null;
  updatedAtMs: number;
};
export type RuntimeCoordinatorPublicationBlockerRecord = {
  blockerId: string;
  blockerKind: "publication_unavailable" | "unreplayable";
  createdAtMs: number;
  dispatchId: string;
  modelVersion: typeof RUNTIME_COORDINATOR_PUBLICATION_BLOCKER_MODEL_VERSION;
  publicationKind: RuntimeCoordinatorPublicationKind;
  reasonCode: string;
  runtimeCoordinatorExecutionId: string | null;
  spaceId: string;
  status: "unresolved_publication_failure";
  targetProfileId: string | null;
  targetWakeLifecycleId: string | null;
  updatedAtMs: number;
};
export type RuntimeCoordinatorPublicationClosureDiagnosticEvidenceSource =
  | "diagnostic_report"
  | "result_inbox"
  | "runtime_coordinator_blocker"
  | "runtime_coordinator_command"
  | "trace";
export type RuntimeCoordinatorPublicationClosureDiagnosticInput = {
  dispatchId: string;
  evidenceSource?: RuntimeCoordinatorPublicationClosureDiagnosticEvidenceSource;
  executionTokenRunId?: string;
  failurePublicationCommandId?: string;
  finalizationCommandId?: string;
  publicationKind: RuntimeCoordinatorPublicationKind;
  runtimeCoordinatorExecutionId?: string;
  spaceId: string;
  targetProfileId: string;
  targetWakeLifecycleId?: string;
};
export type RuntimeCoordinatorPublicationKind =
  | "failure_notice"
  | "stopped_notice"
  | "success_reply";
export type RuntimeCoordinatorPublicationClosureDiagnostics =
  | {
      finalizationCommandId: string;
      publicationKind: "success_reply";
      reasonCode: "runtime_coordinator.publication_already_visible";
      status: "already_visible";
    }
  | {
      finalizationCommandId: string;
      publicationKind: "success_reply";
      reasonCode: "runtime_coordinator.publication_redrive_retryable";
      status: "retryable";
    }
  | {
      failurePublicationCommandId: string;
      publicationKind: "failure_notice";
      reasonCode: "runtime_coordinator.publication_already_visible";
      status: "already_visible";
      targetWakeLifecycleId: string;
    }
  | {
      failurePublicationCommandId: string;
      publicationKind: "failure_notice";
      reasonCode: "runtime_coordinator.publication_redrive_retryable";
      status: "retryable";
      targetWakeLifecycleId: string;
    }
  | {
      publicationId: string;
      publicationKind: "stopped_notice";
      reasonCode: "runtime_coordinator.publication_already_visible";
      status: "already_visible";
    }
  | {
      publicationId: string;
      publicationKind: "stopped_notice";
      reasonCode: "runtime_coordinator.publication_redrive_retryable";
      status: "retryable";
    }
  | {
      publicationKind: RuntimeCoordinatorPublicationKind;
      reasonCode: "runtime_coordinator.publication_redrive_historical_compensation_candidate";
      status: "historical_compensation_candidate";
    }
  | {
      publicationKind: RuntimeCoordinatorPublicationKind;
      reasonCode:
        | "runtime_coordinator.failure_publication_command_mismatch"
        | "runtime_coordinator.failure_publication_lifecycle_incomplete"
        | "runtime_coordinator.failure_publication_lifecycle_missing"
        | "runtime_coordinator.failure_publication_selector_missing"
        | "runtime_coordinator.finalization_command_mismatch"
        | "runtime_coordinator.finalization_command_missing"
        | "runtime_coordinator.finalization_command_selector_missing"
        | "runtime_coordinator.stopped_publication_execution_missing"
        | "runtime_coordinator.stopped_publication_execution_not_cancelled"
        | "runtime_coordinator.stopped_publication_execution_scope_mismatch"
        | "runtime_coordinator.stopped_publication_lifecycle_missing"
        | "runtime_coordinator.stopped_publication_lifecycle_not_stopped"
        | "runtime_coordinator.stopped_publication_lifecycle_scope_mismatch"
        | "runtime_coordinator.stopped_publication_selector_missing";
      status: "unreplayable";
    };
export type RuntimeCoordinatorWakeStoppedNoticePublicationRecord = {
  createdAtMs: number;
  dispatchId: string;
  modelVersion: typeof RUNTIME_COORDINATOR_WAKE_STOPPED_NOTICE_PUBLICATION_MODEL_VERSION;
  publicationId: string;
  publishedSignalId: string | null;
  reasonCode: string;
  runtimeCoordinatorExecutionId: string | null;
  spaceId: string;
  status: "publication_failed" | "published";
  taskOutcomeProjectedAtMs?: number | null;
  taskOutcomeSourceClientMessageId?: string | null;
  targetProfileId: string;
  targetWakeLifecycleId: string | null;
  updatedAtMs: number;
};
export const RUNTIME_COORDINATOR_TOKEN_AUTHORITY_STORAGE_KEY_PREFIX =
  "runtime-coordinator:execution-token-authority:";
export const RUNTIME_COORDINATOR_FINALIZATION_COMMAND_STORAGE_KEY_PREFIX =
  "runtime-coordinator:finalization-command:";
export const RUNTIME_COORDINATOR_FINALIZATION_OUTCOME_STORAGE_KEY_PREFIX =
  "runtime-coordinator:finalization-outcome:";
export const RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY =
  "runtime-coordinator:finalization-retry:index";
export const RUNTIME_COORDINATOR_PUBLICATION_BLOCKER_STORAGE_KEY_PREFIX =
  "runtime-coordinator:publication-blocker:";
export const RUNTIME_COORDINATOR_WAKE_STOPPED_NOTICE_PUBLICATION_STORAGE_KEY_PREFIX =
  "runtime-coordinator:wake-stopped-notice-publication:";
export const RUNTIME_COORDINATOR_DECISION_LOG_STORAGE_KEY_PREFIX =
  "runtime-coordinator:execution-decisions:";
export const RUNTIME_COORDINATOR_RUN_COMMAND_STATE_STORAGE_KEY_PREFIX =
  "runtime-coordinator:run-command-state:";
export const RUNTIME_COORDINATOR_RUN_COMMAND_STATE_INDEX_STORAGE_KEY =
  "runtime-coordinator:run-command-state:index";
export const RUNTIME_COORDINATOR_HEAD_LIFECYCLE_STORAGE_KEY_PREFIX =
  "runtime-coordinator:head-lifecycle:";
export const RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY =
  "runtime-coordinator:head-lifecycle:index";
export const RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_STORAGE_KEY_PREFIX =
  "runtime-coordinator:pre-execution-handoff:";
export const RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_INDEX_STORAGE_KEY =
  "runtime-coordinator:pre-execution-handoff:index";
export const RUNTIME_COORDINATOR_FINALIZATION_RETRY_DELAY_MS = 5000;
export const RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS = 10 * 60_000;
export const RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS =
  24 * 60 * 60_000;
export const RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUST_AFTER_MS =
  5 * 60_000;
export const RUNTIME_COORDINATOR_PUBLICATION_RETRY_MAX_ATTEMPTS = 60;
export const RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE =
  SHARED_RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE;
export const RUNTIME_COORDINATOR_HEAD_WAITING_SOFT_WAIT_MS = 30_000;
export const RUNTIME_COORDINATOR_HEAD_WAITING_HARD_DEADLINE_MS = 5 * 60_000;
export const RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS = 30_000;
export const RUNTIME_COORDINATOR_HEAD_WAITING_RECOVERY_REDRIVE_REASON =
  "runtime_coordinator_head_waiting_recovery" as const;
export const RUNTIME_COORDINATOR_HEAD_WAITING_RECOVERY_REDRIVE_HEADER =
  "x-openmeld-internal-dispatch-redrive";
export const RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_DEADLINE_MS = 30_000;
export const RUNTIME_COORDINATOR_DECISION_MODEL_VERSION =
  "openmeld.runtime_coordinator.execution_decision.v1";
export const RUNTIME_COORDINATOR_RUN_COMMAND_STATE_MODEL_VERSION =
  "openmeld.runtime_coordinator.run_command_state.v1";
export const RUNTIME_COORDINATOR_HEAD_LIFECYCLE_MODEL_VERSION =
  "openmeld.runtime_coordinator.head_lifecycle.v1";
const ACCEPTED_DISPATCH_PAYLOAD_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/;
export const RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_MODEL_VERSION =
  "openmeld.runtime_coordinator.pre_execution_handoff.v1";
export const RUNTIME_COORDINATOR_PUBLICATION_BLOCKER_MODEL_VERSION =
  "openmeld.runtime_coordinator.publication_blocker.v1";
export const RUNTIME_COORDINATOR_WAKE_STOPPED_NOTICE_PUBLICATION_MODEL_VERSION =
  "openmeld.runtime_coordinator.wake_stopped_notice_publication.v1";
export const RUNTIME_COORDINATOR_MAX_DECISION_RECORDS = 32;
export const RUNTIME_COORDINATOR_MAX_HEAD_DUPLICATE_OBSERVATIONS = 16;
export const RUNTIME_COORDINATOR_MAX_PRE_ACCEPT_REDELIVERIES = 2;
export const RUNTIME_COORDINATOR_PRE_ACCEPT_REDELIVERY_WINDOW_MS = 30_000;
export const RUNTIME_COORDINATOR_PROGRESS_EVIDENCE_STALE_TERMINAL_AFTER_MS =
  5 * 60_000;
export const RUNTIME_COORDINATOR_DELIVERY_EXPIRED_REASON_CODE =
  "runtime_coordinator.delivery_expired" as const;
export const RUNTIME_COORDINATOR_PROGRESS_STALE_TERMINAL_REASON_CODE =
  "runtime.progress_stale" as const;
export const RUNTIME_COORDINATOR_LOCAL_RUNTIME_LOST_REASON_CODE =
  "runtime.local_runtime_lost" as const;
export const RUNTIME_COORDINATOR_WAKE_STOP_REQUESTED_REASON_CODE =
  "runtime_coordinator.wake_stop_requested" as const;
export const RUNTIME_COORDINATOR_WAKE_STOP_LOCAL_CONTROL_ACCEPTED_REASON_CODE =
  "runtime_coordinator.wake_stop_local_control_accepted" as const;
export const RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE =
  "runtime_coordinator.pre_agent_stop_requested" as const;

export const isRuntimeCoordinatorLateResultRecoverable = (input: {
  executionStatus: RuntimeCoordinatorExecutionStatus | null;
  taskResultStatus: RuntimeTransportSubmitTaskResultRequest["taskResult"]["payload"]["status"];
  terminalReasonCode: string | null;
  tokenRunMatched: boolean;
  tokenValidationReasonCode: string;
}): boolean =>
  input.tokenValidationReasonCode === "execution_token_terminal_late" &&
  input.tokenRunMatched &&
  input.executionStatus === "failed_terminal" &&
  (input.terminalReasonCode ===
    RUNTIME_COORDINATOR_PROGRESS_STALE_TERMINAL_REASON_CODE ||
    input.terminalReasonCode ===
      RUNTIME_COORDINATOR_LOCAL_RUNTIME_LOST_REASON_CODE) &&
  (input.taskResultStatus === "success" ||
    input.taskResultStatus === "partial_success");

export type RuntimeCoordinatorPreAcceptRedeliveryExpiryCause =
  | "redelivery_limit_exceeded"
  | "redelivery_window_exceeded";

export type RuntimeCoordinatorRunExpiryCause =
  | RuntimeCoordinatorPreAcceptRedeliveryExpiryCause
  | "local_runtime_lost"
  | "local_progress_stale";

export type RuntimeCoordinatorTerminalDecisionPlan = {
  action: Extract<
    RuntimeTransportRuntimeCoordinatorDecisionResponse,
    { ok: true }
  >["action"];
  eventType: RuntimeCoordinatorExecutionEventType;
  reasonCode: string;
  retiredReasonCode: RuntimeCoordinatorTokenReasonCode;
  terminalOutcomeKind: RuntimeCoordinatorTerminalOutcome["kind"];
  tokenStatus: Exclude<RuntimeCoordinatorTokenStatus, "active">;
};

export type RuntimeCoordinatorDeliveryProvenanceSnapshot = {
  connectionGeneration: number;
  daemonSessionId: string;
  /**
   * Optional only for command states written before durable route identity was
   * introduced. New delivery and redelivery writes always persist both fields.
   */
  deviceId?: string;
  lane?: DaemonServiceLane;
  leaseEpoch: number;
};

export type RuntimeCoordinatorRunProgressPhase =
  | "starting"
  | "accepted_local"
  | "running"
  | "completed_local"
  | "result_received";

export type RuntimeCoordinatorRunLocalProgressState = {
  acceptedLocalAtMs: number | null;
  completedLocalAtMs: number | null;
  lastLifecycleAtMs: number | null;
  phase: RuntimeCoordinatorRunProgressPhase;
  resultReceivedAtMs: number | null;
  runningAtMs: number | null;
};

export type RuntimeCoordinatorPendingAgentInteractionState = {
  request: AgentInteractionRequest;
  respondedAtMs: number | null;
  response: AgentInteractionResponse | null;
};

export type RuntimeCoordinatorRunCommandState = {
  activeRunId: string;
  attemptId: string;
  createdAtMs: number;
  dispatchId: string;
  lastCommandReasonCode: string | null;
  lastDeliveryProvenance: RuntimeCoordinatorDeliveryProvenanceSnapshot;
  lastWatchdogCheckAtMs?: number | null;
  localProgress: RuntimeCoordinatorRunLocalProgressState;
  modelVersion: typeof RUNTIME_COORDINATOR_RUN_COMMAND_STATE_MODEL_VERSION;
  ownerUserId: string;
  /**
   * Optional for command states written before local agent interactions were
   * supported. New command-state writes always set this explicitly.
   */
  pendingInteraction?: RuntimeCoordinatorPendingAgentInteractionState | null;
  profileId: string;
  redeliveryCount: number;
  runtimeCoordinatorExecutionId: string;
  sanitizedDeliveryRequest: RuntimeTransportDeliverDispatchRequest;
  sourceClientMessageId: string | null;
  /**
   * Optional for command states written before Wake Stop reasons were retained.
   * This is user-safe Stop context, not the technical terminal reason code.
   */
  stopReason?: string | null;
  targetProfileId: string;
  updatedAtMs: number;
};

export type RuntimeCoordinatorHeadLifecycleDuplicateObservation = {
  dispatchId: string;
  idempotencyKey: string;
  observedAtMs: number;
  reasonCode: string;
};

export type RuntimeCoordinatorHeadNoExecutionDecision = {
  decidedAtMs: number;
  publicationCategory: RuntimeTransportRuntimeCoordinatorHeadNoExecutionPublicationCategory;
  reasonCode: RuntimeTransportRuntimeCoordinatorHeadNoExecutionReasonCode;
  source:
    | "dispatch_preflight"
    | "dispatch_delivery_pre_execution"
    | "runtime_coordinator_head_waiting_deadline";
  userRecoveryAction: RuntimeTransportRuntimeCoordinatorHeadNoExecutionRecoveryAction;
};

export type RuntimeCoordinatorHeadPublicationIntent =
  | {
      intentId: string;
      kind: "no_execution_failure";
      publicationCategory: RuntimeTransportRuntimeCoordinatorHeadNoExecutionPublicationCategory;
      readyAtMs: number;
      reasonCode: RuntimeTransportRuntimeCoordinatorHeadNoExecutionReasonCode;
      status: "ready_for_phase_6";
      userRecoveryAction: RuntimeTransportRuntimeCoordinatorHeadNoExecutionRecoveryAction;
    }
  | {
      intentId: string;
      kind: "stopped_notice";
      readyAtMs: number;
      reasonCode: RuntimeTransportRuntimeCoordinatorHeadPreAgentStopReasonCode;
      status: "ready_for_phase_6";
    };

export type RuntimeCoordinatorHeadPublicationOutcome = {
  failurePublicationCommandId: string;
  finalMessageKind: RuntimeCoordinatorFailurePublicationFinalMessageKind | null;
  observedAtMs: number;
  publicationErrorCode: string | null;
  publishedSignalId: string | null;
  status: "already_final" | "failure_publication_failed" | "failure_published";
};

export type RuntimeCoordinatorHeadPublicationRetryState = {
  attemptCount: number;
  firstFailureAtMs: number;
  lastFailureAtMs: number;
  lastReasonCode: string;
  nextRetryAtMs: number;
  status: "retry_scheduled";
};

export type RuntimeCoordinatorHeadPublicationExhaustionState = {
  attemptCount: number;
  exhaustedAtMs: number;
  lastFailureAtMs: number;
  lastReasonCode: string;
  reasonCode: typeof RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE;
  status: "publication_exhausted";
};

export type RuntimeCoordinatorHeadTargetDisplay = {
  targetProfileMentionLabel: string | null;
  targetProfileName: string | null;
};

type RuntimeCoordinatorHeadWaitingBoundaryCommon = {
  deadlineAtMs: number;
  deadlineOutcome: "publication_intent_ready";
  observedAtMs: number;
  softDeadlineAtMs: number;
  triggerOwner: "runtime_coordinator";
  waitingSinceMs: number;
};

export type RuntimeCoordinatorHeadWaitingBoundary =
  | (RuntimeCoordinatorHeadWaitingBoundaryCommon & {
      reasonCode: "daemon.profile.offline";
      trigger: "openmeld_service_route_connected";
      userRecoveryAction: "start_or_restart_openmeld_service";
      userVisibleState: "waiting_for_openmeld_service";
      waitingCategory: "service_not_connected";
      waitingFor: "openmeld_service_route_connection";
    })
  | (RuntimeCoordinatorHeadWaitingBoundaryCommon & {
      reasonCode: "daemon.profile.pending_first_report";
      trigger: "wake_route_reported";
      userRecoveryAction: "wait_for_wake_route_report";
      userVisibleState: "waiting_for_wake_route_report";
      waitingCategory: "wake_route_registration_pending";
      waitingFor: "wake_route_report";
    });

export type RuntimeCoordinatorHeadWaitingPolicy =
  | {
      reasonCode: "daemon.profile.offline";
      trigger: "openmeld_service_route_connected";
      userRecoveryAction: "start_or_restart_openmeld_service";
      userVisibleState: "waiting_for_openmeld_service";
      waitingCategory: "service_not_connected";
      waitingFor: "openmeld_service_route_connection";
    }
  | {
      reasonCode: "daemon.profile.pending_first_report";
      trigger: "wake_route_reported";
      userRecoveryAction: "wait_for_wake_route_report";
      userVisibleState: "waiting_for_wake_route_report";
      waitingCategory: "wake_route_registration_pending";
      waitingFor: "wake_route_report";
    };

export type RuntimeCoordinatorHeadWaitingDecision =
  | Pick<
      Extract<
        RuntimeCoordinatorHeadWaitingPolicy,
        { reasonCode: "daemon.profile.offline" }
      >,
      "reasonCode" | "userRecoveryAction" | "waitingCategory"
    >
  | Pick<
      Extract<
        RuntimeCoordinatorHeadWaitingPolicy,
        { reasonCode: "daemon.profile.pending_first_report" }
      >,
      "reasonCode" | "userRecoveryAction" | "waitingCategory"
    >;

export const resolveRuntimeCoordinatorHeadWaitingDecision = (
  reasonCode: RuntimeCoordinatorHeadWaitingBoundary["reasonCode"]
): RuntimeCoordinatorHeadWaitingDecision =>
  reasonCode === "daemon.profile.pending_first_report"
    ? {
        reasonCode,
        userRecoveryAction: "wait_for_wake_route_report",
        waitingCategory: "wake_route_registration_pending",
      }
    : {
        reasonCode,
        userRecoveryAction: "start_or_restart_openmeld_service",
        waitingCategory: "service_not_connected",
      };

export const resolveRuntimeCoordinatorHeadWaitingPolicy = (
  reasonCode: RuntimeCoordinatorHeadWaitingBoundary["reasonCode"]
): RuntimeCoordinatorHeadWaitingPolicy =>
  reasonCode === "daemon.profile.pending_first_report"
    ? {
        reasonCode,
        trigger: "wake_route_reported",
        userRecoveryAction: "wait_for_wake_route_report",
        userVisibleState: "waiting_for_wake_route_report",
        waitingCategory: "wake_route_registration_pending",
        waitingFor: "wake_route_report",
      }
    : {
        reasonCode,
        trigger: "openmeld_service_route_connected",
        userRecoveryAction: "start_or_restart_openmeld_service",
        userVisibleState: "waiting_for_openmeld_service",
        waitingCategory: "service_not_connected",
        waitingFor: "openmeld_service_route_connection",
      };

export type RuntimeCoordinatorHeadLifecycleRecord = {
  /**
   * When this Wake most recently became the profile's active FIFO head.
   * Legacy records fall back to createdAtMs.
   */
  acceptedAtMs?: number;
  acceptedDispatchSnapshot?: OpenMeldDaemonAcceptedDispatchSnapshot;
  createdAtMs: number;
  duplicateDispatches: RuntimeCoordinatorHeadLifecycleDuplicateObservation[];
  executionLinkedAtMs: number | null;
  modelVersion: typeof RUNTIME_COORDINATOR_HEAD_LIFECYCLE_MODEL_VERSION;
  noExecutionDecision?: RuntimeCoordinatorHeadNoExecutionDecision;
  ownerUserId: string;
  primaryDispatchId: string;
  primaryIdempotencyKey: string;
  publicationExhaustion?: RuntimeCoordinatorHeadPublicationExhaustionState;
  publicationIntent?: RuntimeCoordinatorHeadPublicationIntent;
  publicationOutcome?: RuntimeCoordinatorHeadPublicationOutcome;
  publicationRetry?: RuntimeCoordinatorHeadPublicationRetryState;
  runtimeCoordinatorExecutionId: string | null;
  status:
    | "accepted"
    | "execution_linked"
    | "publication_intent_ready"
    | "queued"
    | "stopped_before_execution"
    | "waiting";
  /** User-safe Stop context retained separately from technical reason codes. */
  stopReason?: string | null;
  targetWakeLifecycleIdentity: TargetWakeLifecycleIdentity;
  targetWakeLifecycleId: string;
  targetDisplay?: RuntimeCoordinatorHeadTargetDisplay;
  updatedAtMs: number;
  waitingBoundary?: RuntimeCoordinatorHeadWaitingBoundary;
};

export type RuntimeCoordinatorPreExecutionHandoffPublicationStatus =
  | "legacy_evidence_only"
  | "waiting_for_recovery"
  | "publication_failed"
  | "published"
  | "recovered";

export type RuntimeCoordinatorPreExecutionHandoffRecord = {
  attemptId: string | null;
  autoRelayDepth: number | null;
  createdAtMs: number;
  deadlineAtMs: number;
  dispatchChainId: string | null;
  dispatchId: string;
  firstSeenAtMs: number;
  idempotencyKey: string;
  modelVersion: typeof RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_MODEL_VERSION;
  nextAlarmAtMs: number;
  nextPublicationRetryAtMs: number | null;
  observedAtMs: number;
  publicationErrorCode: string | null;
  publicationStatus: RuntimeCoordinatorPreExecutionHandoffPublicationStatus;
  publishedSignalId: string | null;
  reasonCode: RuntimeTransportPreExecutionHandoffReasonCode;
  resultRef: string;
  sourceClientMessageId: string | null;
  sourceEventId: string;
  spaceId: string;
  spacePassword: string | null;
  targetProfileId: string;
  targetProfileMentionLabel: string | null;
  targetProfileName: string | null;
  taskId: string;
  threadContext:
    | RuntimeTransportPreExecutionHandoffRequest["threadContext"]
    | null;
  updatedAtMs: number;
  visitedProfileIds: string[];
  visitedProfileIdsHash: string | null;
};

export type RuntimeCoordinatorDurableDecisionRecord = {
  action: Extract<
    RuntimeTransportRuntimeCoordinatorDecisionResponse,
    { ok: true }
  >["action"];
  createdAtMs: number;
  decisionId: string;
  eventKind: RuntimeTransportRuntimeCoordinatorDecisionRequest["eventKind"];
  idempotencyKey: string;
  modelVersion: typeof RUNTIME_COORDINATOR_DECISION_MODEL_VERSION;
  reasonCode: string;
  runId: string | null;
  statusAfter: RuntimeCoordinatorExecutionStatus | null;
  tokenStatus: RuntimeCoordinatorTokenStatus | null;
  trigger: RuntimeTransportRuntimeCoordinatorDecisionRequest["trigger"];
};

export type RuntimeCoordinatorDecisionAuthorityRead =
  | {
      authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
      status: "found";
    }
  | {
      authority: null;
      status: "missing";
    }
  | {
      authority: null;
      reasonCode: string;
      status: "unavailable";
    };

export const buildRuntimeCoordinatorTokenAuthorityStorageKey = (
  runtimeCoordinatorExecutionId: string
): string => {
  return `${RUNTIME_COORDINATOR_TOKEN_AUTHORITY_STORAGE_KEY_PREFIX}${runtimeCoordinatorExecutionId}`;
};

export const buildRuntimeCoordinatorDecisionLogStorageKey = (
  runtimeCoordinatorExecutionId: string
): string => {
  return `${RUNTIME_COORDINATOR_DECISION_LOG_STORAGE_KEY_PREFIX}${runtimeCoordinatorExecutionId}`;
};

export const buildRuntimeCoordinatorRunCommandStateStorageKey = (
  runtimeCoordinatorExecutionId: string
): string => {
  return `${RUNTIME_COORDINATOR_RUN_COMMAND_STATE_STORAGE_KEY_PREFIX}${runtimeCoordinatorExecutionId}`;
};

export const sanitizeRuntimeCoordinatorDeliveryRequestForCommandState = (
  request: RuntimeTransportDeliverDispatchRequest
): RuntimeTransportDeliverDispatchRequest => {
  const payload = { ...request.payload };
  payload.executionToken = undefined;
  return {
    ...request,
    payload,
  };
};

export const buildRuntimeCoordinatorDecisionId = (input: {
  idempotencyKey: string;
  runtimeCoordinatorExecutionId: string;
}): string => {
  return [
    "rce_decision_v1",
    encodeLengthPrefixedDecisionPart(input.runtimeCoordinatorExecutionId),
    encodeLengthPrefixedDecisionPart(input.idempotencyKey),
  ].join("|");
};

export const resolveRuntimeCoordinatorRedeliveryAction = (input: {
  ok: boolean;
  reasonCode: string;
}): Extract<
  RuntimeTransportRuntimeCoordinatorDecisionResponse,
  { ok: true }
>["action"] => {
  if (input.ok) {
    return "redeliver_current_run";
  }
  if (input.reasonCode === "runtime_coordinator.local_progress_active") {
    return "keep_waiting";
  }
  if (
    input.reasonCode === "runtime_coordinator.progress_stale_policy_pending"
  ) {
    return "keep_waiting";
  }
  return "redelivery_deferred";
};

export const resolveRuntimeCoordinatorPreAcceptRedeliveryExpiry = (input: {
  commandState: RuntimeCoordinatorRunCommandState;
  nowMs: number;
}): RuntimeCoordinatorPreAcceptRedeliveryExpiryCause | null => {
  if (
    input.commandState.redeliveryCount >=
    RUNTIME_COORDINATOR_MAX_PRE_ACCEPT_REDELIVERIES
  ) {
    return "redelivery_limit_exceeded";
  }
  if (
    input.nowMs - input.commandState.createdAtMs >
    RUNTIME_COORDINATOR_PRE_ACCEPT_REDELIVERY_WINDOW_MS
  ) {
    return "redelivery_window_exceeded";
  }
  return null;
};

export const minNullableTimestamp = (
  first: number | null,
  second: number | null
): number | null => {
  if (first === null) {
    return second;
  }
  if (second === null) {
    return first;
  }
  return Math.min(first, second);
};

export const resolveNextRuntimeCoordinatorHeadWaitingAlarmAtMsFromRecords =
  (input: {
    nowMs: number;
    records: RuntimeCoordinatorHeadLifecycleRecord[];
  }): number | null => {
    let nextAlarmAtMs: number | null = null;
    for (const record of input.records) {
      if (record.status !== "waiting" || !record.waitingBoundary) {
        continue;
      }
      nextAlarmAtMs = minNullableTimestamp(
        nextAlarmAtMs,
        record.waitingBoundary.deadlineAtMs
      );
    }
    return nextAlarmAtMs;
  };

export const resolveNextRuntimeCoordinatorHeadAcceptedHandoffAlarmAtMsFromRecords =
  (input: {
    nowMs: number;
    records: RuntimeCoordinatorHeadLifecycleRecord[];
  }): number | null => {
    let nextAlarmAtMs: number | null = null;
    for (const record of input.records) {
      if (!isAcceptedHeadAwaitingExecution(record)) {
        continue;
      }
      nextAlarmAtMs = minNullableTimestamp(
        nextAlarmAtMs,
        (record.acceptedAtMs ?? record.createdAtMs) +
          RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS
      );
    }
    return nextAlarmAtMs;
  };

export const resolveNextRuntimeCoordinatorHeadFailurePublicationRetryAlarmAtMsFromRecords =
  (input: {
    nowMs: number;
    records: RuntimeCoordinatorHeadLifecycleRecord[];
  }): number | null => {
    let nextAlarmAtMs: number | null = null;
    for (const record of input.records) {
      if (
        record.status !== "publication_intent_ready" ||
        record.publicationRetry?.status !== "retry_scheduled"
      ) {
        continue;
      }
      nextAlarmAtMs = minNullableTimestamp(
        nextAlarmAtMs,
        record.publicationRetry.nextRetryAtMs
      );
    }
    return nextAlarmAtMs;
  };

export const resolveNextRuntimeCoordinatorFinalizationRetryAlarmAtMsFromEntries =
  (input: {
    nowMs: number;
    retryEntries: RuntimeCoordinatorFinalizationRetryEntry[];
  }): number | null => {
    let nextAlarmAtMs: number | null = null;
    for (const retryEntry of input.retryEntries) {
      nextAlarmAtMs = minNullableTimestamp(
        nextAlarmAtMs,
        retryEntry.nextReplayAtMs
      );
    }
    return nextAlarmAtMs;
  };

export type RuntimeCoordinatorHeadWaitingAlarmWorkItem =
  RuntimeCoordinatorHeadLifecycleRecord & {
    status: "waiting";
    waitingBoundary: RuntimeCoordinatorHeadWaitingBoundary;
  };

export const planRuntimeCoordinatorHeadWaitingAlarmWork = (input: {
  nowMs: number;
  records: RuntimeCoordinatorHeadLifecycleRecord[];
}): RuntimeCoordinatorHeadWaitingAlarmWorkItem[] =>
  input.records.filter(
    (record): record is RuntimeCoordinatorHeadWaitingAlarmWorkItem =>
      record.status === "waiting" &&
      record.waitingBoundary != null &&
      record.waitingBoundary.deadlineAtMs <= input.nowMs
  );

export const planRuntimeCoordinatorHeadAcceptedHandoffAlarmWork = (input: {
  nowMs: number;
  records: RuntimeCoordinatorHeadLifecycleRecord[];
}): RuntimeCoordinatorHeadLifecycleRecord[] =>
  input.records.filter((record) =>
    shouldEscalateAcceptedHeadToWaitingBoundary({
      nowMs: input.nowMs,
      record,
    })
  );

export type RuntimeCoordinatorHeadFailurePublicationRetryAlarmWorkItem =
  RuntimeCoordinatorHeadLifecycleRecord & {
    publicationRetry: RuntimeCoordinatorHeadPublicationRetryState;
    status: "publication_intent_ready";
  };

export const planRuntimeCoordinatorHeadFailurePublicationRetryAlarmWork =
  (input: {
    nowMs: number;
    records: RuntimeCoordinatorHeadLifecycleRecord[];
  }): RuntimeCoordinatorHeadFailurePublicationRetryAlarmWorkItem[] =>
    input.records.filter(
      (
        record
      ): record is RuntimeCoordinatorHeadFailurePublicationRetryAlarmWorkItem =>
        record.status === "publication_intent_ready" &&
        record.publicationRetry?.status === "retry_scheduled" &&
        record.publicationRetry.nextRetryAtMs <= input.nowMs
    );

export const planRuntimeCoordinatorFinalizationRetryAlarmWork = (input: {
  nowMs: number;
  retryEntries: RuntimeCoordinatorFinalizationRetryEntry[];
}): RuntimeCoordinatorFinalizationRetryEntry[] =>
  input.retryEntries.filter(
    (retryEntry) => retryEntry.nextReplayAtMs <= input.nowMs
  );

export const resolveNextRuntimeCoordinatorPreExecutionHandoffAlarmAtMsFromRecords =
  (input: {
    nowMs: number;
    records: RuntimeCoordinatorPreExecutionHandoffRecord[];
  }): number | null => {
    let nextAlarmAtMs: number | null = null;
    for (const record of input.records) {
      if (
        record.publicationStatus === "published" ||
        record.publicationStatus === "recovered" ||
        record.publicationStatus === "legacy_evidence_only"
      ) {
        continue;
      }
      nextAlarmAtMs = minNullableTimestamp(nextAlarmAtMs, record.nextAlarmAtMs);
    }
    return nextAlarmAtMs;
  };

export type RuntimeCoordinatorPreExecutionHandoffAlarmWorkItem =
  | {
      action: "delete_recovered";
      record: RuntimeCoordinatorPreExecutionHandoffRecord;
    }
  | {
      action: "mark_legacy_evidence_only";
      record: RuntimeCoordinatorPreExecutionHandoffRecord;
    };

export const planRuntimeCoordinatorPreExecutionHandoffAlarmWork = (input: {
  nowMs: number;
  records: RuntimeCoordinatorPreExecutionHandoffRecord[];
}): RuntimeCoordinatorPreExecutionHandoffAlarmWorkItem[] => {
  const workItems: RuntimeCoordinatorPreExecutionHandoffAlarmWorkItem[] = [];
  for (const record of input.records) {
    if (record.publicationStatus === "recovered") {
      workItems.push({ action: "delete_recovered", record });
      continue;
    }
    if (
      record.publicationStatus === "published" ||
      record.publicationStatus === "legacy_evidence_only"
    ) {
      continue;
    }
    if (record.deadlineAtMs > input.nowMs) {
      continue;
    }
    workItems.push({ action: "mark_legacy_evidence_only", record });
  }
  return workItems;
};

export const resolveRuntimeCoordinatorRunCommandStateWatchdogAtMs = (
  commandState: RuntimeCoordinatorRunCommandState
): number | null => {
  const pendingInteraction = commandState.pendingInteraction ?? null;
  if (pendingInteraction && !pendingInteraction.response) {
    return pendingInteraction.request.expiresAtMs;
  }
  if (!hasRuntimeCoordinatorDurableLocalProgress(commandState.localProgress)) {
    return (
      commandState.createdAtMs +
      RUNTIME_COORDINATOR_PRE_ACCEPT_REDELIVERY_WINDOW_MS +
      1
    );
  }
  if (commandState.localProgress.phase === "result_received") {
    return null;
  }
  const lastLocalProgressAtMs =
    resolveRuntimeCoordinatorWatchdogProgressBaselineAtMs(commandState);
  const lastWatchdogCheckAtMs = commandState.lastWatchdogCheckAtMs ?? null;
  if (
    lastWatchdogCheckAtMs !== null &&
    lastWatchdogCheckAtMs >= lastLocalProgressAtMs
  ) {
    return (
      lastWatchdogCheckAtMs +
      RUNTIME_COORDINATOR_PROGRESS_EVIDENCE_WATCHDOG_INTERVAL_MS
    );
  }
  return (
    lastLocalProgressAtMs +
    RUNTIME_COORDINATOR_PROGRESS_EVIDENCE_WATCHDOG_INTERVAL_MS
  );
};

export const hasRuntimeCoordinatorProgressAdvancedSinceLastWatchdogCheck = (
  commandState: RuntimeCoordinatorRunCommandState
): boolean => {
  if (
    commandState.pendingInteraction &&
    !commandState.pendingInteraction.response
  ) {
    return true;
  }
  const lastWatchdogCheckAtMs = commandState.lastWatchdogCheckAtMs ?? null;
  if (lastWatchdogCheckAtMs === null) {
    return true;
  }
  const lastLocalProgressAtMs =
    resolveRuntimeCoordinatorWatchdogProgressBaselineAtMs(commandState);
  return lastLocalProgressAtMs > lastWatchdogCheckAtMs;
};

export const hasRuntimeCoordinatorLocalProgressStaleTerminalExpired = (input: {
  commandState: RuntimeCoordinatorRunCommandState;
  nowMs: number;
}): boolean => {
  const pendingInteraction = input.commandState.pendingInteraction ?? null;
  if (pendingInteraction && !pendingInteraction.response) {
    return false;
  }
  const observedLocalProgressAtMs =
    resolveRuntimeCoordinatorLastLocalProgressAtMs(
      input.commandState.localProgress
    );
  const lastLocalProgressAtMs =
    pendingInteraction?.respondedAtMs === null ||
    pendingInteraction?.respondedAtMs === undefined
      ? observedLocalProgressAtMs
      : Math.max(
          observedLocalProgressAtMs ?? 0,
          pendingInteraction.respondedAtMs
        );
  if (lastLocalProgressAtMs === null) {
    return false;
  }
  return (
    input.nowMs - lastLocalProgressAtMs >=
    RUNTIME_COORDINATOR_PROGRESS_EVIDENCE_STALE_TERMINAL_AFTER_MS
  );
};

const resolveRuntimeCoordinatorWatchdogProgressBaselineAtMs = (
  commandState: RuntimeCoordinatorRunCommandState
): number => {
  const observedLocalProgressAtMs =
    resolveRuntimeCoordinatorLastLocalProgressAtMs(
      commandState.localProgress
    ) ?? commandState.updatedAtMs;
  const respondedAtMs =
    commandState.pendingInteraction?.response &&
    commandState.pendingInteraction.respondedAtMs !== null
      ? commandState.pendingInteraction.respondedAtMs
      : null;
  return respondedAtMs === null
    ? observedLocalProgressAtMs
    : Math.max(observedLocalProgressAtMs, respondedAtMs);
};

export const buildRuntimeCoordinatorRunExpiryEventPayload = (input: {
  commandState: RuntimeCoordinatorRunCommandState;
  expiryCause: RuntimeCoordinatorRunExpiryCause;
  publication:
    | {
        ok: true;
        publishedSignalId: string;
      }
    | {
        ok: false;
        reasonCode: "runtime_coordinator.failure_publication_unavailable";
      };
}): Record<string, unknown> => {
  const common = {
    expiryCause: input.expiryCause,
    failurePublicationReasonCode: input.publication.ok
      ? null
      : input.publication.reasonCode,
    publishedSignalId: input.publication.ok
      ? input.publication.publishedSignalId
      : null,
    publicationStatus: input.publication.ok ? "published" : "unavailable",
    redeliveryCount: input.commandState.redeliveryCount,
    redeliveryLimit: RUNTIME_COORDINATOR_MAX_PRE_ACCEPT_REDELIVERIES,
    redeliveryWindowExpiresAtMs:
      input.commandState.createdAtMs +
      RUNTIME_COORDINATOR_PRE_ACCEPT_REDELIVERY_WINDOW_MS,
    redeliveryWindowMs: RUNTIME_COORDINATOR_PRE_ACCEPT_REDELIVERY_WINDOW_MS,
    redeliveryWindowStartedAtMs: input.commandState.createdAtMs,
  };
  if (input.expiryCause === "local_progress_stale") {
    return {
      progressStale: {
        ...common,
        progressEvidenceStaleTerminalAfterMs:
          RUNTIME_COORDINATOR_PROGRESS_EVIDENCE_STALE_TERMINAL_AFTER_MS,
      },
    };
  }
  if (input.expiryCause === "local_runtime_lost") {
    return {
      localRuntimeLost: common,
    };
  }
  return {
    deliveryExpired: common,
  };
};

export const resolveRuntimeCoordinatorLocalProgressDecisionReason = (
  commandState: RuntimeCoordinatorRunCommandState
):
  | "runtime_coordinator.local_progress_active"
  | "runtime_coordinator.progress_stale_policy_pending" =>
  hasRuntimeCoordinatorProgressAdvancedSinceLastWatchdogCheck(commandState)
    ? "runtime_coordinator.local_progress_active"
    : "runtime_coordinator.progress_stale_policy_pending";

export const hasAcceptedResultRuntimeCoordinatorPointer = (result: {
  executionTokenFingerprint: string | null;
  executionTokenRunId: string | null;
  runtimeCoordinatorExecutionId: string | null;
}): boolean =>
  Boolean(
    normalizeOptionalText(result.runtimeCoordinatorExecutionId) &&
      normalizeOptionalText(result.executionTokenRunId) &&
      normalizeOptionalText(result.executionTokenFingerprint)
  );

export const resolveRuntimeCoordinatorLastLocalProgressAtMs = (
  progress: RuntimeCoordinatorRunLocalProgressState
): number | null => {
  const timestamps = [
    progress.acceptedLocalAtMs,
    progress.completedLocalAtMs,
    progress.lastLifecycleAtMs,
    progress.resultReceivedAtMs,
    progress.runningAtMs,
  ].filter(
    (timestamp): timestamp is number =>
      typeof timestamp === "number" && Number.isFinite(timestamp)
  );
  if (timestamps.length === 0) {
    return null;
  }
  return Math.max(...timestamps);
};

export const isRuntimeCoordinatorReevaluatableDecisionAction = (
  action: RuntimeCoordinatorDurableDecisionRecord["action"]
): boolean =>
  action === "keep_waiting" ||
  action === "redeliver_current_run" ||
  action === "redelivery_deferred" ||
  action === "retry_run_issued";

export const buildRuntimeCoordinatorDeliveryExpiredTerminalPlan =
  (): RuntimeCoordinatorTerminalDecisionPlan => ({
    action: "timeout_terminal",
    eventType: "runtime_coordinator_timeout_terminal",
    reasonCode: RUNTIME_COORDINATOR_DELIVERY_EXPIRED_REASON_CODE,
    retiredReasonCode: "execution_token_expired",
    terminalOutcomeKind: "timed_out",
    tokenStatus: "expired",
  });

export const buildRuntimeCoordinatorProgressStaleTerminalPlan =
  (): RuntimeCoordinatorTerminalDecisionPlan => ({
    action: "timeout_terminal",
    eventType: "runtime_coordinator_timeout_terminal",
    reasonCode: RUNTIME_COORDINATOR_PROGRESS_STALE_TERMINAL_REASON_CODE,
    retiredReasonCode: "execution_token_expired",
    terminalOutcomeKind: "timed_out",
    tokenStatus: "expired",
  });

export const buildRuntimeCoordinatorLocalRuntimeLostTerminalPlan =
  (): RuntimeCoordinatorTerminalDecisionPlan => ({
    action: "reclaim_blocked",
    eventType: "runtime_connection_lost",
    reasonCode: RUNTIME_COORDINATOR_LOCAL_RUNTIME_LOST_REASON_CODE,
    retiredReasonCode: "execution_token_revoked",
    terminalOutcomeKind: "failed_terminal",
    tokenStatus: "revoked",
  });

export const resolveRuntimeCoordinatorTerminalDecisionPlan = (
  input: RuntimeTransportRuntimeCoordinatorDecisionRequest
): RuntimeCoordinatorTerminalDecisionPlan => {
  switch (input.eventKind) {
    case "timeout":
      return {
        action: "timeout_terminal",
        eventType: "runtime_coordinator_timeout_terminal",
        reasonCode: "runtime_coordinator.timeout_terminal",
        retiredReasonCode: "execution_token_expired",
        terminalOutcomeKind: "timed_out",
        tokenStatus: "expired",
      };
    case "reclaim":
      return {
        action: "reclaim_blocked",
        eventType: "runtime_coordinator_reclaim_blocked",
        reasonCode: "runtime_coordinator.reclaim_delivery_blocked",
        retiredReasonCode: "execution_token_revoked",
        terminalOutcomeKind: "failed_terminal",
        tokenStatus: "revoked",
      };
    case "retry":
      return {
        action: "retry_blocked",
        eventType: "runtime_coordinator_retry_blocked",
        reasonCode: "runtime_coordinator.retry_delivery_blocked",
        retiredReasonCode: "execution_token_revoked",
        terminalOutcomeKind: "failed_terminal",
        tokenStatus: "revoked",
      };
    case "owner_conflict":
      return {
        action: "owner_conflict_terminal",
        eventType: "runtime_coordinator_owner_conflict_terminal",
        reasonCode: "runtime_coordinator.owner_conflict_current_terminal",
        retiredReasonCode: "execution_token_revoked",
        terminalOutcomeKind: "failed_terminal",
        tokenStatus: "revoked",
      };
    default:
      return {
        action: "terminal_failed",
        eventType: "runtime_coordinator_decision_recorded",
        reasonCode: "runtime_coordinator.terminal_decision",
        retiredReasonCode: "execution_token_revoked",
        terminalOutcomeKind: "failed_terminal",
        tokenStatus: "revoked",
      };
  }
};

export const settleRuntimeCoordinatorAuthorityForTerminalDecision = (input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
  nowMs: number;
  plan: RuntimeCoordinatorTerminalDecisionPlan;
  replySignalId?: string | null;
}): RuntimeCoordinatorExecutionTokenAuthorityRecord => {
  if (input.authority.terminalOutcome) {
    return input.authority;
  }
  const activeRunId = input.authority.currentRunId;
  let authority = input.authority;
  if (activeRunId) {
    const activeRun = input.authority.runsById[activeRunId] ?? null;
    if (activeRun?.tokenStatus === "active") {
      authority = retireRuntimeCoordinatorTokenRun({
        authority: input.authority,
        reasonCode: input.plan.retiredReasonCode,
        retiredAtMs: input.nowMs,
        retentionExpiresAtMs:
          input.nowMs + input.authority.retention.lateResultWindowMs,
        runId: activeRunId,
        tokenStatus: input.plan.tokenStatus,
      });
    }
  }
  const settledAuthority = {
    ...authority,
    terminalOutcome: {
      finalizedAtMs: input.nowMs,
      reasonCode: input.plan.reasonCode,
      replySignalId: input.replySignalId ?? null,
      status: "failed_terminal",
    },
  };
  const parsed =
    runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(
      settledAuthority
    );
  if (!parsed.success) {
    throw new Error("runtime_coordinator.terminal_authority_invalid");
  }
  return parsed.data;
};

export const settleRuntimeCoordinatorAuthorityForCancellationAccepted =
  (input: {
    authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
    nowMs: number;
    reasonCode?: string | null;
  }): RuntimeCoordinatorExecutionTokenAuthorityRecord => {
    if (input.authority.terminalOutcome) {
      return input.authority;
    }
    const activeRunId = input.authority.currentRunId;
    let authority = input.authority;
    if (activeRunId) {
      const activeRun = input.authority.runsById[activeRunId] ?? null;
      if (activeRun?.tokenStatus === "active") {
        authority = retireRuntimeCoordinatorTokenRun({
          authority: input.authority,
          reasonCode: "execution_token_revoked",
          retiredAtMs: input.nowMs,
          retentionExpiresAtMs:
            input.nowMs + input.authority.retention.lateResultWindowMs,
          runId: activeRunId,
          tokenStatus: "revoked",
        });
      }
    }
    const settledAuthority = {
      ...authority,
      terminalOutcome: {
        finalizedAtMs: input.nowMs,
        reasonCode:
          normalizeOptionalText(input.reasonCode) ??
          RUNTIME_COORDINATOR_WAKE_STOP_LOCAL_CONTROL_ACCEPTED_REASON_CODE,
        replySignalId: null,
        status: "cancelled" as const,
      },
    };
    const parsed =
      runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(
        settledAuthority
      );
    if (!parsed.success) {
      throw new Error("runtime_coordinator.cancellation_authority_invalid");
    }
    return parsed.data;
  };

export const buildRuntimeCoordinatorCancelledExecutionRecord = (input: {
  nowMs: number;
  reasonCode?: string | null;
  record: RuntimeCoordinatorExecutionRecord;
}): RuntimeCoordinatorExecutionRecord => ({
  ...input.record,
  status: "cancelled",
  terminalOutcome: {
    kind: "cancelled",
    observedAtMs: input.nowMs,
    reasonCode:
      normalizeOptionalText(input.reasonCode) ??
      RUNTIME_COORDINATOR_WAKE_STOP_LOCAL_CONTROL_ACCEPTED_REASON_CODE,
  },
  updatedAtMs: input.nowMs,
});

export const withRuntimeCoordinatorTerminalReplySignalId = (input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
  replySignalId: string;
}): RuntimeCoordinatorExecutionTokenAuthorityRecord => {
  if (!input.authority.terminalOutcome) {
    return input.authority;
  }
  const nextAuthority = {
    ...input.authority,
    terminalOutcome: {
      ...input.authority.terminalOutcome,
      replySignalId: input.replySignalId,
    },
  };
  const parsed =
    runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(
      nextAuthority
    );
  if (!parsed.success) {
    throw new Error("runtime_coordinator.terminal_authority_invalid");
  }
  return parsed.data;
};

export const buildRuntimeCoordinatorExecutionRecordFromAuthority = (input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
  fallback: RuntimeTransportRuntimeCoordinatorDecisionRequest;
  nowMs: number;
}): RuntimeCoordinatorExecutionRecord | null => {
  if (!input.authority) {
    return null;
  }
  return {
    bindingId: input.authority.authorityScope.bindingId,
    agentControllerRef: input.authority.authorityScope.agentControllerRef,
    createdAtMs: input.nowMs,
    dispatchId: input.authority.executionScope.dispatchId,
    legacyPointers: {
      attemptId: input.fallback.attemptId ?? null,
      claimLeaseId: null,
      connectionGeneration: null,
      daemonSessionId: null,
      leaseEpoch: null,
    },
    modelVersion: RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION,
    runtimeCoordinatorExecutionId:
      input.authority.runtimeCoordinatorExecutionId,
    openMeldServiceRuntimeId: {
      source: "runtime_registry_authority",
      value: input.authority.authorityScope.openMeldServiceRuntimeId,
    },
    sourceClientMessageId: input.authority.executionScope.sourceClientMessageId,
    spaceId: input.authority.executionScope.spaceId,
    status: "state_unknown",
    targetProfileId: input.authority.executionScope.targetProfileId,
    terminalOutcome: null,
    updatedAtMs: input.nowMs,
  };
};

export const isRuntimeCoordinatorDurableDecisionRecord = (
  value: unknown
): value is RuntimeCoordinatorDurableDecisionRecord => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<RuntimeCoordinatorDurableDecisionRecord>;
  return (
    typeof record.action === "string" &&
    typeof record.createdAtMs === "number" &&
    typeof record.decisionId === "string" &&
    typeof record.eventKind === "string" &&
    typeof record.idempotencyKey === "string" &&
    record.modelVersion === RUNTIME_COORDINATOR_DECISION_MODEL_VERSION &&
    typeof record.reasonCode === "string" &&
    typeof record.trigger === "string"
  );
};

export const isRuntimeCoordinatorRunCommandState = (
  value: unknown
): value is RuntimeCoordinatorRunCommandState => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<RuntimeCoordinatorRunCommandState>;
  if (
    record.modelVersion !==
      RUNTIME_COORDINATOR_RUN_COMMAND_STATE_MODEL_VERSION ||
    typeof record.activeRunId !== "string" ||
    typeof record.attemptId !== "string" ||
    typeof record.createdAtMs !== "number" ||
    typeof record.dispatchId !== "string" ||
    typeof record.ownerUserId !== "string" ||
    typeof record.profileId !== "string" ||
    typeof record.redeliveryCount !== "number" ||
    typeof record.runtimeCoordinatorExecutionId !== "string" ||
    typeof record.targetProfileId !== "string" ||
    typeof record.updatedAtMs !== "number" ||
    !isOptionalNullableNonNegativeNumber(record.lastWatchdogCheckAtMs) ||
    !isOptionalNullableString(record.stopReason) ||
    !isRuntimeCoordinatorRunLocalProgressState(record.localProgress) ||
    !record.lastDeliveryProvenance ||
    typeof record.lastDeliveryProvenance !== "object" ||
    typeof record.lastDeliveryProvenance.connectionGeneration !== "number" ||
    typeof record.lastDeliveryProvenance.daemonSessionId !== "string" ||
    (record.lastDeliveryProvenance.deviceId !== undefined &&
      typeof record.lastDeliveryProvenance.deviceId !== "string") ||
    (record.lastDeliveryProvenance.lane !== undefined &&
      !daemonServiceLaneSchema.safeParse(record.lastDeliveryProvenance.lane)
        .success) ||
    typeof record.lastDeliveryProvenance.leaseEpoch !== "number"
  ) {
    return false;
  }
  if (
    record.pendingInteraction !== undefined &&
    record.pendingInteraction !== null
  ) {
    const pendingInteraction = record.pendingInteraction;
    if (
      !(
        agentInteractionRequestSchema.safeParse(pendingInteraction.request)
          .success &&
        isOptionalNullableNonNegativeNumber(pendingInteraction.respondedAtMs)
      ) ||
      (pendingInteraction.response !== null &&
        !agentInteractionResponseSchema.safeParse(pendingInteraction.response)
          .success) ||
      (pendingInteraction.response === null) !==
        (pendingInteraction.respondedAtMs === null)
    ) {
      return false;
    }
  }
  return runtimeTransportDeliverDispatchRequestSchema.safeParse(
    record.sanitizedDeliveryRequest
  ).success;
};

export const normalizeRuntimeCoordinatorFinalizationRetryEntry = (
  value: unknown
): RuntimeCoordinatorFinalizationRetryEntry | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<RuntimeCoordinatorFinalizationRetryEntry>;
  if (
    typeof record.attemptId !== "string" ||
    record.attemptId.length === 0 ||
    typeof record.dispatchId !== "string" ||
    record.dispatchId.length === 0 ||
    typeof record.executionTokenRunId !== "string" ||
    record.executionTokenRunId.length === 0 ||
    typeof record.finalizationCommandId !== "string" ||
    record.finalizationCommandId.length === 0 ||
    typeof record.nextReplayAtMs !== "number" ||
    !Number.isFinite(record.nextReplayAtMs) ||
    typeof record.runtimeCoordinatorExecutionId !== "string" ||
    record.runtimeCoordinatorExecutionId.length === 0 ||
    typeof record.spaceId !== "string" ||
    record.spaceId.length === 0 ||
    typeof record.updatedAtMs !== "number" ||
    !Number.isFinite(record.updatedAtMs)
  ) {
    return null;
  }
  const attemptCount =
    typeof record.attemptCount === "number" &&
    Number.isInteger(record.attemptCount) &&
    record.attemptCount > 0
      ? record.attemptCount
      : 1;
  const firstFailureAtMs =
    typeof record.firstFailureAtMs === "number" &&
    Number.isFinite(record.firstFailureAtMs)
      ? record.firstFailureAtMs
      : record.updatedAtMs;
  return {
    attemptCount,
    attemptId: record.attemptId,
    dispatchId: record.dispatchId,
    executionTokenRunId: record.executionTokenRunId,
    finalizationCommandId: record.finalizationCommandId,
    firstFailureAtMs,
    nextReplayAtMs: record.nextReplayAtMs,
    runtimeCoordinatorExecutionId: record.runtimeCoordinatorExecutionId,
    spaceId: record.spaceId,
    targetProfileId: normalizeOptionalText(record.targetProfileId),
    updatedAtMs: record.updatedAtMs,
  };
};

export const isRuntimeCoordinatorRunLocalProgressState = (
  value: unknown
): value is RuntimeCoordinatorRunLocalProgressState => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const progress = value as Partial<RuntimeCoordinatorRunLocalProgressState>;
  return (
    (progress.phase === "starting" ||
      progress.phase === "accepted_local" ||
      progress.phase === "running" ||
      progress.phase === "completed_local" ||
      progress.phase === "result_received") &&
    isNullableNonNegativeNumber(progress.acceptedLocalAtMs) &&
    isNullableNonNegativeNumber(progress.completedLocalAtMs) &&
    isNullableNonNegativeNumber(progress.lastLifecycleAtMs) &&
    isNullableNonNegativeNumber(progress.resultReceivedAtMs) &&
    isNullableNonNegativeNumber(progress.runningAtMs)
  );
};

export const isNullableNonNegativeNumber = (
  value: unknown
): value is number | null =>
  value === null ||
  (typeof value === "number" && Number.isFinite(value) && value >= 0);

export const isOptionalNullableNonNegativeNumber = (
  value: unknown
): value is number | null | undefined =>
  value === undefined || isNullableNonNegativeNumber(value);

const isOptionalNullableString = (
  value: unknown
): value is string | null | undefined =>
  value === undefined || value === null || typeof value === "string";

export const buildRuntimeCoordinatorRunCommandStateFromLifecycle = (input: {
  commandState: RuntimeCoordinatorRunCommandState;
  lifecycle: RuntimeTransportDispatchLifecycleRequest;
  nowMs: number;
}): RuntimeCoordinatorRunCommandState => {
  const lifecycleAtMs =
    input.lifecycle.lifecycleAtMs > 0
      ? input.lifecycle.lifecycleAtMs
      : input.nowMs;
  const nextPhase = resolveNextRuntimeCoordinatorRunProgressPhase({
    currentPhase: input.commandState.localProgress.phase,
    requestedPhase: input.lifecycle.phase,
  });
  return {
    ...input.commandState,
    lastWatchdogCheckAtMs: null,
    localProgress: {
      acceptedLocalAtMs:
        nextPhase === "accepted_local" ||
        nextPhase === "running" ||
        nextPhase === "completed_local"
          ? (input.commandState.localProgress.acceptedLocalAtMs ??
            lifecycleAtMs)
          : input.commandState.localProgress.acceptedLocalAtMs,
      completedLocalAtMs:
        nextPhase === "completed_local"
          ? (input.commandState.localProgress.completedLocalAtMs ??
            lifecycleAtMs)
          : input.commandState.localProgress.completedLocalAtMs,
      lastLifecycleAtMs: Math.max(
        input.commandState.localProgress.lastLifecycleAtMs ?? 0,
        lifecycleAtMs
      ),
      phase: nextPhase,
      resultReceivedAtMs: input.commandState.localProgress.resultReceivedAtMs,
      runningAtMs:
        nextPhase === "running" || nextPhase === "completed_local"
          ? (input.commandState.localProgress.runningAtMs ?? lifecycleAtMs)
          : input.commandState.localProgress.runningAtMs,
    },
    updatedAtMs: input.nowMs,
  };
};

export const resolveNextRuntimeCoordinatorRunProgressPhase = (input: {
  currentPhase: RuntimeCoordinatorRunProgressPhase;
  requestedPhase: RuntimeTransportDispatchLifecyclePhase;
}): RuntimeCoordinatorRunProgressPhase => {
  const order: Record<RuntimeCoordinatorRunProgressPhase, number> = {
    starting: 0,
    accepted_local: 1,
    running: 2,
    completed_local: 3,
    result_received: 4,
  };
  return order[input.requestedPhase] > order[input.currentPhase]
    ? input.requestedPhase
    : input.currentPhase;
};

export const hasRuntimeCoordinatorDurableLocalProgress = (
  progress: RuntimeCoordinatorRunLocalProgressState
): boolean =>
  progress.acceptedLocalAtMs !== null ||
  progress.runningAtMs !== null ||
  progress.completedLocalAtMs !== null ||
  progress.resultReceivedAtMs !== null ||
  progress.phase === "accepted_local" ||
  progress.phase === "running" ||
  progress.phase === "completed_local" ||
  progress.phase === "result_received";

export const resolveRuntimeCoordinatorDecisionRun = (input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
  observedRunId: string | null;
}): RuntimeCoordinatorTokenRunAuthority | null => {
  if (!input.authority) {
    return null;
  }
  if (input.observedRunId) {
    return input.authority.runsById[input.observedRunId] ?? null;
  }
  if (input.authority.currentRunId) {
    return input.authority.runsById[input.authority.currentRunId] ?? null;
  }
  return (
    Object.values(input.authority.runsById).sort(
      (first, second) =>
        (second.retiredAtMs ?? second.issuedAtMs) -
        (first.retiredAtMs ?? first.issuedAtMs)
    )[0] ?? null
  );
};

export const resolveRuntimeCoordinatorDecisionScopeMismatchReason = (input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
  input: RuntimeTransportRuntimeCoordinatorDecisionRequest;
}): string | null => {
  const executionScope = input.authority.executionScope;
  if (
    executionScope.spaceId !== input.input.spaceId ||
    executionScope.dispatchId !== input.input.dispatchId ||
    executionScope.targetProfileId !== input.input.targetProfileId
  ) {
    return "runtime_coordinator.decision_scope_mismatch";
  }
  return null;
};

export const encodeLengthPrefixedDecisionPart = (value: string): string => {
  return `${value.length}:${value}`;
};

export const buildRuntimeCoordinatorTokenValidationContextFromCommandState = (
  commandState: RuntimeCoordinatorRunCommandState
): RuntimeCoordinatorTokenValidationContext => ({
  authorityScope: {
    bindingId:
      commandState.sanitizedDeliveryRequest.payload.executionIdentity.core
        .bindingId,
    agentControllerRef:
      commandState.sanitizedDeliveryRequest.payload.executionIdentity.core
        .agentControllerRef,
    openMeldServiceRuntimeId:
      commandState.sanitizedDeliveryRequest.payload.executionIdentity.core
        .openMeldServiceRuntimeId.value,
  },
  executionScope: {
    dispatchId: commandState.dispatchId,
    runtimeCoordinatorExecutionId: commandState.runtimeCoordinatorExecutionId,
    sourceClientMessageId: commandState.sourceClientMessageId,
    spaceId: commandState.sanitizedDeliveryRequest.payload.spaceId,
    targetProfileId: commandState.targetProfileId,
  },
  runtimeCoordinatorExecutionId: commandState.runtimeCoordinatorExecutionId,
});

export const buildRuntimeCoordinatorTokenValidationContextFromAuthority = (
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord
): RuntimeCoordinatorTokenValidationContext => ({
  authorityScope: authority.authorityScope,
  executionScope: authority.executionScope,
  runtimeCoordinatorExecutionId: authority.runtimeCoordinatorExecutionId,
});

export const buildRuntimeCoordinatorTokenValidationContextFromProjection = (
  record: RuntimeCoordinatorExecutionRecord
): RuntimeCoordinatorTokenValidationContext => ({
  authorityScope: {
    bindingId: record.bindingId,
    agentControllerRef: record.agentControllerRef,
    openMeldServiceRuntimeId: record.openMeldServiceRuntimeId.value,
  },
  executionScope: {
    dispatchId: record.dispatchId,
    runtimeCoordinatorExecutionId: record.runtimeCoordinatorExecutionId,
    sourceClientMessageId: record.sourceClientMessageId,
    spaceId: record.spaceId,
    targetProfileId: record.targetProfileId,
  },
  runtimeCoordinatorExecutionId: record.runtimeCoordinatorExecutionId,
});

export const resolveRuntimeCoordinatorResultAuthorityMismatchReason = (input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
  request: RuntimeTransportSubmitTaskResultRequest;
}):
  | "daemon.result.identity_mismatch"
  | "runtime_coordinator.execution_id_mismatch"
  | null => {
  const authorityExecutionScope = input.authority.executionScope;
  const authorityScope = input.authority.authorityScope;
  const echoed = input.request.executionIdentityEcho.core;
  if (
    authorityExecutionScope.dispatchId !== input.request.dispatchId ||
    authorityExecutionScope.dispatchId !== echoed.dispatchId ||
    authorityExecutionScope.spaceId !== echoed.spaceId ||
    authorityExecutionScope.targetProfileId !== echoed.targetProfileId ||
    authorityExecutionScope.targetProfileId !==
      input.request.taskResult.payload.agentId
  ) {
    return "runtime_coordinator.execution_id_mismatch";
  }
  if (
    authorityScope.bindingId !== echoed.bindingId ||
    authorityScope.agentControllerRef !== echoed.agentControllerRef ||
    authorityScope.openMeldServiceRuntimeId !==
      echoed.openMeldServiceRuntimeId.value
  ) {
    return "daemon.result.identity_mismatch";
  }
  return null;
};

export const buildRuntimeCoordinatorExecutionRecordFromCommandState = (input: {
  commandState: RuntimeCoordinatorRunCommandState;
  nowMs: number;
  status: RuntimeCoordinatorExecutionStatus;
}): RuntimeCoordinatorExecutionRecord => {
  const executionIdentity =
    input.commandState.sanitizedDeliveryRequest.payload.executionIdentity;
  return {
    bindingId: executionIdentity.core.bindingId,
    agentControllerRef: executionIdentity.core.agentControllerRef,
    createdAtMs: input.commandState.createdAtMs,
    dispatchId: input.commandState.dispatchId,
    legacyPointers: {
      attemptId: input.commandState.attemptId,
      claimLeaseId: null,
      connectionGeneration:
        input.commandState.lastDeliveryProvenance.connectionGeneration,
      daemonSessionId:
        input.commandState.lastDeliveryProvenance.daemonSessionId,
      leaseEpoch: input.commandState.lastDeliveryProvenance.leaseEpoch,
    },
    modelVersion: RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION,
    runtimeCoordinatorExecutionId:
      input.commandState.runtimeCoordinatorExecutionId,
    openMeldServiceRuntimeId: executionIdentity.core.openMeldServiceRuntimeId,
    sourceClientMessageId: input.commandState.sourceClientMessageId,
    spaceId: input.commandState.sanitizedDeliveryRequest.payload.spaceId,
    status: input.status,
    targetProfileId: input.commandState.targetProfileId,
    terminalOutcome: null,
    updatedAtMs: input.nowMs,
  };
};

export const buildRuntimeCoordinatorExecutionRecordFromFinalizationCommand =
  (input: {
    authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
    command: RuntimeCoordinatorFinalizationCommand;
    nowMs: number;
  }): RuntimeCoordinatorExecutionRecord | null => {
    if (!input.authority) {
      return null;
    }
    return {
      bindingId: input.authority.authorityScope.bindingId,
      agentControllerRef: input.authority.authorityScope.agentControllerRef,
      createdAtMs: input.command.createdAtMs,
      dispatchId: input.command.dispatchId,
      legacyPointers: {
        attemptId: input.command.acceptedResult.attemptId,
        claimLeaseId: null,
        connectionGeneration:
          input.command.acceptedResult.submittedConnectionGeneration,
        daemonSessionId: input.command.acceptedResult.daemonSessionId,
        leaseEpoch: input.command.acceptedResult.leaseEpoch,
      },
      modelVersion: RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION,
      runtimeCoordinatorExecutionId:
        input.command.runtimeCoordinatorExecutionId,
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: input.authority.authorityScope.openMeldServiceRuntimeId,
      },
      sourceClientMessageId: input.command.dispatchFact.sourceClientMessageId,
      spaceId: input.command.spaceId,
      status: "state_unknown",
      targetProfileId: input.command.targetProfileId,
      terminalOutcome: null,
      updatedAtMs: input.nowMs,
    };
  };

export const isRuntimeCoordinatorPublicationProjectionSettled = (
  record: RuntimeCoordinatorExecutionRecord | null
): boolean => {
  return (
    record?.terminalOutcome !== null &&
    (record?.status === "reply_published" ||
      record?.status === "cancelled" ||
      record?.status === "failed_retryable" ||
      record?.status === "failed_terminal")
  );
};

export const rejectRuntimeCoordinatorFinalizationReplay = (input?: {
  blockerReasonCode?: RuntimeCoordinatorFinalizationReplayFailure["blockerReasonCode"];
  publicationUncertain?: boolean;
  retryable?: boolean;
}): RuntimeCoordinatorFinalizationReplayFailure => ({
  ...(input?.blockerReasonCode
    ? { blockerReasonCode: input.blockerReasonCode }
    : {}),
  ok: false,
  ...(input?.publicationUncertain ? { publicationUncertain: true } : {}),
  reasonCode: "daemon.result.finalization_unavailable",
  retryable: input?.retryable ?? true,
  status: "retry_later",
});

export const resolveRuntimeCoordinatorPublicationStatus = (
  publishState: RuntimeCoordinatorFinalizationOutcome["publishState"]
): Extract<
  RuntimeCoordinatorExecutionStatus,
  "reply_published" | "failed_terminal" | "failed_retryable"
> => {
  if (publishState === "reply_published") {
    return "reply_published";
  }
  if (publishState === "invalid_space_action") {
    return "failed_terminal";
  }
  return "failed_retryable";
};

export const resolveRuntimeCoordinatorPublicationTerminalOutcomeKind = (
  status: Extract<
    RuntimeCoordinatorExecutionStatus,
    "reply_published" | "failed_terminal" | "failed_retryable"
  >
): RuntimeCoordinatorTerminalOutcome["kind"] => {
  if (status === "reply_published") {
    return "reply_published";
  }
  if (status === "failed_terminal") {
    return "failed_terminal";
  }
  return "failed_retryable";
};

export const buildRuntimeCoordinatorFinalizationCommandStorageKey = (
  commandId: string
): string =>
  `${RUNTIME_COORDINATOR_FINALIZATION_COMMAND_STORAGE_KEY_PREFIX}${commandId}`;

export const buildRuntimeCoordinatorFinalizationOutcomeStorageKey = (
  commandId: string
): string =>
  `${RUNTIME_COORDINATOR_FINALIZATION_OUTCOME_STORAGE_KEY_PREFIX}${commandId}`;

export const buildRuntimeCoordinatorPreExecutionHandoffStorageKey = (
  dispatchId: string
): string =>
  `${RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_STORAGE_KEY_PREFIX}${dispatchId}`;

export const buildRuntimeCoordinatorHeadLifecycleStorageKey = (
  targetWakeLifecycleId: string
): string =>
  `${RUNTIME_COORDINATOR_HEAD_LIFECYCLE_STORAGE_KEY_PREFIX}${targetWakeLifecycleId}`;

export const buildRuntimeCoordinatorPublicationBlockerStorageKey = (
  blockerId: string
): string =>
  `${RUNTIME_COORDINATOR_PUBLICATION_BLOCKER_STORAGE_KEY_PREFIX}${blockerId}`;

export const buildRuntimeCoordinatorWakeStoppedNoticePublicationId = (
  runtimeCoordinatorExecutionId: string
): string => `wake-stopped:${runtimeCoordinatorExecutionId}`;

export const buildRuntimeCoordinatorHeadWakeStoppedNoticePublicationId = (
  targetWakeLifecycleId: string
): string => `wake-stopped:head:${targetWakeLifecycleId}`;

export const buildRuntimeCoordinatorWakeStoppedNoticePublicationStorageKey = (
  publicationId: string
): string =>
  `${RUNTIME_COORDINATOR_WAKE_STOPPED_NOTICE_PUBLICATION_STORAGE_KEY_PREFIX}${publicationId}`;

export const buildRuntimeCoordinatorHeadPublicationIntentId = (
  targetWakeLifecycleId: string
): string => `rcpi:no_execution:${targetWakeLifecycleId}`;

export const buildRuntimeCoordinatorHeadStoppedPublicationIntentId = (
  targetWakeLifecycleId: string
): string => `rcpi:stopped:${targetWakeLifecycleId}`;

export const buildRuntimeCoordinatorHeadPublicationIntentReadyRecord = (input: {
  decisionSource: RuntimeCoordinatorHeadNoExecutionDecision["source"];
  existing: RuntimeCoordinatorHeadLifecycleRecord;
  nowMs: number;
  publicationCategory: RuntimeCoordinatorHeadNoExecutionDecision["publicationCategory"];
  reasonCode: RuntimeTransportRuntimeCoordinatorHeadNoExecutionReasonCode;
  userRecoveryAction: RuntimeCoordinatorHeadNoExecutionDecision["userRecoveryAction"];
}): RuntimeCoordinatorHeadLifecycleRecord => {
  const publicationIntentId = buildRuntimeCoordinatorHeadPublicationIntentId(
    input.existing.targetWakeLifecycleId
  );
  return {
    ...input.existing,
    noExecutionDecision: {
      decidedAtMs: input.nowMs,
      publicationCategory: input.publicationCategory,
      reasonCode: input.reasonCode,
      source: input.decisionSource,
      userRecoveryAction: input.userRecoveryAction,
    },
    publicationIntent: {
      intentId: publicationIntentId,
      kind: "no_execution_failure",
      publicationCategory: input.publicationCategory,
      readyAtMs: input.nowMs,
      reasonCode: input.reasonCode,
      status: "ready_for_phase_6",
      userRecoveryAction: input.userRecoveryAction,
    },
    runtimeCoordinatorExecutionId: null,
    status: "publication_intent_ready",
    updatedAtMs: input.nowMs,
    waitingBoundary: undefined,
  };
};

export const buildRuntimeCoordinatorHeadFailurePublicationCommand = (input: {
  nowMs: number;
  record: RuntimeCoordinatorHeadLifecycleRecord;
}): RuntimeCoordinatorFailurePublicationCommand => {
  if (!(input.record.publicationIntent && input.record.noExecutionDecision)) {
    throw new Error("runtime_coordinator.failure_publication_intent_missing");
  }
  const identity = input.record.targetWakeLifecycleIdentity;
  const publicationIntent = input.record.publicationIntent;
  if (publicationIntent.kind !== "no_execution_failure") {
    throw new Error("runtime_coordinator.failure_publication_intent_missing");
  }
  return {
    createdAtMs: input.nowMs,
    dispatchId: input.record.primaryDispatchId,
    failurePublicationCommandId:
      buildRuntimeCoordinatorFailurePublicationCommandId({
        publicationIntentId: publicationIntent.intentId,
      }),
    modelVersion: RUNTIME_COORDINATOR_FAILURE_PUBLICATION_COMMAND_MODEL_VERSION,
    ownerUserId: input.record.ownerUserId,
    publicationCategory: publicationIntent.publicationCategory,
    publicationIntentId: publicationIntent.intentId,
    reasonCode: publicationIntent.reasonCode,
    spaceId: identity.spaceId,
    targetProfileMentionLabel:
      input.record.targetDisplay?.targetProfileMentionLabel ?? null,
    targetProfileId: identity.targetProfileId,
    targetProfileName: input.record.targetDisplay?.targetProfileName ?? null,
    targetWakeLifecycleIdentity: identity,
    targetWakeLifecycleId: input.record.targetWakeLifecycleId,
    userRecoveryAction: publicationIntent.userRecoveryAction,
  };
};

export const resolveRuntimeCoordinatorHeadTargetDisplay = (
  request:
    | RuntimeTransportRuntimeCoordinatorHeadAcceptRequest
    | RuntimeTransportRuntimeCoordinatorHeadPreAgentStopRequest
): RuntimeCoordinatorHeadTargetDisplay => ({
  targetProfileMentionLabel:
    normalizeOptionalText(request.targetProfileMentionLabel) ?? null,
  targetProfileName: normalizeOptionalText(request.targetProfileName) ?? null,
});

export const buildRuntimeCoordinatorFailurePublicationFailureOutcome = (input: {
  command: RuntimeCoordinatorFailurePublicationCommand;
  reasonCode: string;
}): RuntimeCoordinatorFailurePublicationOutcome => ({
  failurePublicationCommandId: input.command.failurePublicationCommandId,
  finalMessageKind: null,
  ok: false,
  publicationErrorCode: input.reasonCode,
  publishedSignalId: null,
  status: "failure_publication_failed",
});

export const resolveRuntimeCoordinatorFinalizationCommandIdFromClosureDiagnosticInput =
  (
    input: RuntimeCoordinatorPublicationClosureDiagnosticInput
  ): string | null => {
    const finalizationCommandId = normalizeOptionalText(
      input.finalizationCommandId
    );
    if (finalizationCommandId) {
      return finalizationCommandId;
    }
    const executionTokenRunId = normalizeOptionalText(
      input.executionTokenRunId
    );
    const runtimeCoordinatorExecutionId = normalizeOptionalText(
      input.runtimeCoordinatorExecutionId
    );
    return executionTokenRunId && runtimeCoordinatorExecutionId
      ? buildRuntimeCoordinatorFinalizationCommandId({
          executionTokenRunId,
          runtimeCoordinatorExecutionId,
        })
      : null;
  };

export const isHistoricalPublicationClosureEvidence = (
  evidenceSource:
    | RuntimeCoordinatorPublicationClosureDiagnosticEvidenceSource
    | undefined
): boolean =>
  evidenceSource === "diagnostic_report" ||
  evidenceSource === "result_inbox" ||
  evidenceSource === "trace";

export const buildHistoricalEvidenceOnlyClosureDiagnostics = (
  publicationKind: RuntimeCoordinatorPublicationKind
): RuntimeCoordinatorPublicationClosureDiagnostics => ({
  publicationKind,
  reasonCode:
    "runtime_coordinator.publication_redrive_historical_compensation_candidate",
  status: "historical_compensation_candidate",
});

export const buildMissingPublicationFactsClosureDiagnostics = (input: {
  publicationKind: RuntimeCoordinatorPublicationKind;
  reasonCode: Extract<
    RuntimeCoordinatorPublicationClosureDiagnostics,
    { status: "unreplayable" }
  >["reasonCode"];
}): RuntimeCoordinatorPublicationClosureDiagnostics => ({
  publicationKind: input.publicationKind,
  reasonCode: input.reasonCode,
  status: "unreplayable",
});

export const toRuntimeCoordinatorHeadPublicationOutcomeFromFailurePublication =
  (input: {
    nowMs: number;
    outcome: RuntimeCoordinatorFailurePublicationOutcome;
  }): RuntimeCoordinatorHeadPublicationOutcome => ({
    failurePublicationCommandId: input.outcome.failurePublicationCommandId,
    finalMessageKind: input.outcome.finalMessageKind,
    observedAtMs: input.nowMs,
    publicationErrorCode: input.outcome.publicationErrorCode,
    publishedSignalId: input.outcome.publishedSignalId,
    status: input.outcome.status,
  });

export const buildRuntimeCoordinatorHeadPublicationRetry = (input: {
  nowMs: number;
  outcome: Extract<
    RuntimeCoordinatorFailurePublicationOutcome,
    { status: "failure_publication_failed" }
  >;
  previousRetry?: RuntimeCoordinatorHeadPublicationRetryState;
}): RuntimeCoordinatorHeadPublicationRetryState => ({
  attemptCount: (input.previousRetry?.attemptCount ?? 0) + 1,
  firstFailureAtMs: input.previousRetry?.firstFailureAtMs ?? input.nowMs,
  lastFailureAtMs: input.nowMs,
  lastReasonCode:
    input.outcome.publicationErrorCode ??
    "runtime_coordinator.failure_publication_unavailable",
  nextRetryAtMs: input.nowMs + RUNTIME_COORDINATOR_FINALIZATION_RETRY_DELAY_MS,
  status: "retry_scheduled",
});

export const buildRuntimeCoordinatorHeadPublicationExhaustion = (
  retry: RuntimeCoordinatorHeadPublicationRetryState
): RuntimeCoordinatorHeadPublicationExhaustionState => ({
  attemptCount: retry.attemptCount,
  exhaustedAtMs: retry.lastFailureAtMs,
  lastFailureAtMs: retry.lastFailureAtMs,
  lastReasonCode: retry.lastReasonCode,
  reasonCode: RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE,
  status: "publication_exhausted",
});

export const incrementRuntimeCoordinatorFinalizationRetryEntry = (input: {
  nowMs: number;
  retryEntry: RuntimeCoordinatorFinalizationRetryEntry;
}): RuntimeCoordinatorFinalizationRetryEntry => ({
  ...input.retryEntry,
  attemptCount: input.retryEntry.attemptCount + 1,
  nextReplayAtMs: input.nowMs + RUNTIME_COORDINATOR_FINALIZATION_RETRY_DELAY_MS,
  updatedAtMs: input.nowMs,
});

export const parkRuntimeCoordinatorFinalizationRetryEntry = (input: {
  nowMs: number;
  retryEntry: RuntimeCoordinatorFinalizationRetryEntry;
}): RuntimeCoordinatorFinalizationRetryEntry => ({
  ...input.retryEntry,
  nextReplayAtMs:
    input.nowMs + RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
  updatedAtMs: input.nowMs,
});

export const isRuntimeCoordinatorPublicationRetryExhausted = (input: {
  attemptCount: number;
  firstFailureAtMs: number;
  lastFailureAtMs?: number;
  updatedAtMs?: number;
}): boolean => {
  const observedAtMs = input.updatedAtMs ?? input.lastFailureAtMs;
  return (
    input.attemptCount >= RUNTIME_COORDINATOR_PUBLICATION_RETRY_MAX_ATTEMPTS ||
    (typeof observedAtMs === "number" &&
      Number.isFinite(observedAtMs) &&
      observedAtMs - input.firstFailureAtMs >=
        RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUST_AFTER_MS)
  );
};

export const isRuntimeCoordinatorFinalizationRetryParkLimitReached = (input: {
  firstFailureAtMs: number;
  nowMs: number;
}): boolean =>
  Number.isFinite(input.firstFailureAtMs) &&
  Number.isFinite(input.nowMs) &&
  input.nowMs - input.firstFailureAtMs >=
    RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS;

export const omitRuntimeCoordinatorHeadPublicationRetry = (
  record: RuntimeCoordinatorHeadLifecycleRecord
): RuntimeCoordinatorHeadLifecycleRecord => {
  const { publicationRetry: _publicationRetry, ...recordWithoutRetry } = record;
  return recordWithoutRetry;
};

export const isAcceptedHeadAwaitingExecution = (
  record: RuntimeCoordinatorHeadLifecycleRecord
): boolean =>
  record.status === "accepted" &&
  !record.runtimeCoordinatorExecutionId &&
  !record.executionLinkedAtMs &&
  !record.noExecutionDecision &&
  !record.publicationIntent &&
  !record.waitingBoundary;

export const shouldEscalateAcceptedHeadToWaitingBoundary = (input: {
  nowMs: number;
  record: RuntimeCoordinatorHeadLifecycleRecord;
}): boolean =>
  isAcceptedHeadAwaitingExecution(input.record) &&
  (input.record.acceptedAtMs ?? input.record.createdAtMs) +
    RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS <=
    input.nowMs;

export const resolveRuntimeCoordinatorHeadDuplicateReasonCode = (
  status: RuntimeCoordinatorHeadLifecycleRecord["status"]
): string => {
  if (status === "publication_intent_ready") {
    return "runtime_coordinator.head_duplicate_after_publication_intent";
  }
  if (status === "execution_linked") {
    return "runtime_coordinator.head_duplicate_after_execution_link";
  }
  if (status === "stopped_before_execution") {
    return "runtime_coordinator.pre_agent_stop_already_recorded";
  }
  if (status === "queued") {
    return "agent_profile_work_coordinator.duplicate_while_queued";
  }
  if (status === "waiting") {
    return "runtime_coordinator.head_duplicate_while_waiting";
  }
  return "runtime_coordinator.head_duplicate_dispatch_ignored";
};

export const resolveRuntimeCoordinatorHeadDuplicateAcceptStatus = (
  status: RuntimeCoordinatorHeadLifecycleRecord["status"]
):
  | "already_accepted"
  | "execution_linked"
  | "publication_intent_ready"
  | "stopped_before_execution" => {
  if (status === "publication_intent_ready") {
    return "publication_intent_ready";
  }
  if (status === "execution_linked") {
    return "execution_linked";
  }
  if (status === "stopped_before_execution") {
    return "stopped_before_execution";
  }
  return "already_accepted";
};

export const isSameRuntimeCoordinatorHeadAuthority = (
  record: RuntimeCoordinatorHeadLifecycleRecord,
  request:
    | RuntimeTransportRuntimeCoordinatorHeadAcceptRequest
    | RuntimeTransportRuntimeCoordinatorHeadNoExecutionRequest
    | RuntimeTransportRuntimeCoordinatorHeadPreAgentStopRequest
    | RuntimeTransportRuntimeCoordinatorHeadWaitingRequest
): boolean => {
  const identity = request.targetWakeLifecycleIdentity;
  return (
    record.ownerUserId === request.ownerUserId &&
    record.targetWakeLifecycleId === identity.targetWakeLifecycleId &&
    record.targetWakeLifecycleIdentity.spaceId === identity.spaceId &&
    record.targetWakeLifecycleIdentity.sourceSignalId ===
      identity.sourceSignalId &&
    record.targetWakeLifecycleIdentity.targetProfileId ===
      identity.targetProfileId
  );
};

export const isRuntimeCoordinatorHeadWaitingRecoveryCandidate = (input: {
  nowMs: number;
  ownerUserId: string;
  profileIdSet: ReadonlySet<string> | null;
  record: RuntimeCoordinatorHeadLifecycleRecord;
}): boolean => {
  if (input.record.status !== "waiting" || !input.record.waitingBoundary) {
    return false;
  }
  if (input.record.ownerUserId !== input.ownerUserId) {
    return false;
  }
  if (input.record.waitingBoundary.deadlineAtMs <= input.nowMs) {
    return false;
  }
  const targetProfileId =
    input.record.targetWakeLifecycleIdentity.targetProfileId;
  return input.profileIdSet === null || input.profileIdSet.has(targetProfileId);
};

export const normalizeRuntimeCoordinatorHeadWaitingBoundary = (
  record: RuntimeCoordinatorHeadLifecycleRecord
): RuntimeCoordinatorHeadWaitingBoundary | null => {
  if (!record.waitingBoundary) {
    return null;
  }
  const boundary =
    record.waitingBoundary as RuntimeCoordinatorHeadWaitingBoundary & {
      softDeadlineAtMs?: unknown;
    };
  return {
    ...record.waitingBoundary,
    softDeadlineAtMs:
      typeof boundary.softDeadlineAtMs === "number" &&
      Number.isFinite(boundary.softDeadlineAtMs)
        ? boundary.softDeadlineAtMs
        : record.waitingBoundary.waitingSinceMs +
          RUNTIME_COORDINATOR_HEAD_WAITING_SOFT_WAIT_MS,
  };
};

export const appendRuntimeCoordinatorHeadDuplicateObservation = (input: {
  nowMs: number;
  reasonCode: string;
  record: RuntimeCoordinatorHeadLifecycleRecord;
  request: RuntimeTransportRuntimeCoordinatorHeadAcceptRequest;
}): RuntimeCoordinatorHeadLifecycleRecord => {
  const duplicate = {
    dispatchId: input.request.dispatchId,
    idempotencyKey: input.request.idempotencyKey,
    observedAtMs: input.nowMs,
    reasonCode: input.reasonCode,
  };
  const existingWithoutSameObservation =
    input.record.duplicateDispatches.filter(
      (entry) =>
        entry.dispatchId !== duplicate.dispatchId ||
        entry.idempotencyKey !== duplicate.idempotencyKey
    );
  return {
    ...input.record,
    duplicateDispatches: [...existingWithoutSameObservation, duplicate].slice(
      -RUNTIME_COORDINATOR_MAX_HEAD_DUPLICATE_OBSERVATIONS
    ),
    updatedAtMs: input.nowMs,
  };
};

export const isRuntimeCoordinatorHeadLifecycleRecord = (
  value: unknown
): value is RuntimeCoordinatorHeadLifecycleRecord => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as RuntimeCoordinatorHeadLifecycleRecord;
  return (
    record.modelVersion === RUNTIME_COORDINATOR_HEAD_LIFECYCLE_MODEL_VERSION &&
    (record.acceptedAtMs === undefined ||
      (Number.isInteger(record.acceptedAtMs) && record.acceptedAtMs >= 0)) &&
    typeof record.targetWakeLifecycleId === "string" &&
    typeof record.ownerUserId === "string" &&
    typeof record.primaryDispatchId === "string" &&
    typeof record.primaryIdempotencyKey === "string" &&
    (record.status === "accepted" ||
      record.status === "execution_linked" ||
      record.status === "publication_intent_ready" ||
      record.status === "queued" ||
      record.status === "stopped_before_execution" ||
      record.status === "waiting") &&
    (record.runtimeCoordinatorExecutionId === null ||
      typeof record.runtimeCoordinatorExecutionId === "string") &&
    (record.acceptedDispatchSnapshot === undefined ||
      isAcceptedDispatchSnapshot(record.acceptedDispatchSnapshot)) &&
    isOptionalNullableString(record.stopReason) &&
    targetWakeLifecycleIdentityMatchesRecord(record.targetWakeLifecycleIdentity)
  );
};

const isAcceptedDispatchSnapshot = (
  value: unknown
): value is OpenMeldDaemonAcceptedDispatchSnapshot => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const snapshot = value as OpenMeldDaemonAcceptedDispatchSnapshot;
  const controller = snapshot.controllerSnapshot;
  return (
    typeof snapshot.payloadFingerprint === "string" &&
    ACCEPTED_DISPATCH_PAYLOAD_FINGERPRINT_PATTERN.test(
      snapshot.payloadFingerprint
    ) &&
    !!controller &&
    typeof controller.bindingId === "string" &&
    typeof controller.configurationRevision === "number" &&
    Number.isInteger(controller.configurationRevision) &&
    controller.configurationRevision > 0 &&
    typeof snapshot.openMeldServiceRuntimeId === "string" &&
    snapshot.runtimeKind === "openmeld_service" &&
    controller.targetBindingState === "bound" &&
    controller.targetBindingEnabled === true &&
    typeof controller.agentControllerRef === "string"
  );
};

export const targetWakeLifecycleIdentityMatchesRecord = (
  identity: unknown
): identity is TargetWakeLifecycleIdentity => {
  return (
    !!identity &&
    typeof identity === "object" &&
    (identity as TargetWakeLifecycleIdentity).modelVersion ===
      "openmeld.target_wake.lifecycle_identity.v1" &&
    typeof (identity as TargetWakeLifecycleIdentity).targetWakeLifecycleId ===
      "string" &&
    typeof (identity as TargetWakeLifecycleIdentity).spaceId === "string" &&
    typeof (identity as TargetWakeLifecycleIdentity).sourceSignalId ===
      "string" &&
    typeof (identity as TargetWakeLifecycleIdentity).targetProfileId ===
      "string"
  );
};

export const buildPreExecutionHandoffFailureResultRef = (
  dispatchId: string
): string => `pre-execution-handoff-failure:${dispatchId}`;

export const isRuntimeCoordinatorPreExecutionHandoffRecord = (
  value: unknown
): value is RuntimeCoordinatorPreExecutionHandoffRecord => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as RuntimeCoordinatorPreExecutionHandoffRecord;
  return (
    record.modelVersion ===
      RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_MODEL_VERSION &&
    typeof record.dispatchId === "string" &&
    typeof record.spaceId === "string" &&
    typeof record.targetProfileId === "string" &&
    typeof record.firstSeenAtMs === "number" &&
    typeof record.deadlineAtMs === "number" &&
    typeof record.nextAlarmAtMs === "number" &&
    typeof record.reasonCode === "string" &&
    typeof record.resultRef === "string"
  );
};
