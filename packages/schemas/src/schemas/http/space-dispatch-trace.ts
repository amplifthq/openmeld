import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";
import { dispatchExecutionSchema } from "../daemon/conversation-lifecycle";
import { spaceTraceExecutionIdentityProjectionSchema } from "../daemon/execution-identity";
import {
  runtimeCoordinatorExecutionCreationDiagnosticSchema,
  runtimeCoordinatorExecutionEventSchema,
  runtimeCoordinatorExecutionRecordSchema,
} from "../daemon/runtime-coordinator-execution";
import { serviceConnectionTraceDiagnosticsSchema } from "../daemon/service-connection-evidence";
import { openMeldDaemonTaskResultProjectFailureContextSchema } from "../daemon/task-result";
import {
  MAX_PROFILE_NAME_LENGTH,
  MAX_TEXT_LENGTH,
} from "../protocol/constants";
import { executionContextDiagnosticsSchema } from "../protocol/execution-context";
import { targetWakeLifecycleIdentitySchema } from "../protocol/target-wake-lifecycle";
import { remoteAgentWorkerRuntimeDiagnosticsResponseSchema } from "../runtime/remote-agent-worker";
import { centerAgentTurnDiagnosticSchema } from "./center-agent-turn-diagnostics";
import { observabilityWakeCorrelationSchema } from "./observability-correlation";
import { spaceMentionLabelSchema } from "./space-mention-label";

const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const SPACE_DISPATCH_TRACE_TIMEOUT_POLICY_MAX_MS = 604_800_000;
const SPACE_DISPATCH_TRACE_PROMPT_LENGTH_MAX = 1_000_000 as const;
export const SPACE_DISPATCH_TRACE_PROMPT_PREVIEW_MAX_CHARS = 1200 as const;
export const SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION = 8 as const;
export const SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION_PREVIOUS =
  7 as const;
// Frozen feature boundaries; these must not advance with CURRENT/PREVIOUS.
export const SPACE_DISPATCH_TRACE_EXECUTION_CONTEXT_CONTRACT_VERSION =
  7 as const;
export const SPACE_DISPATCH_TRACE_SDK_SCHEDULES_CONTRACT_VERSION = 8 as const;
export const SPACE_DISPATCH_TRACE_NATIVE_DELIVERY_CONTRACT_VERSION = 6 as const;
export const SPACE_DISPATCH_TRACE_WAITING_EVIDENCE_CONTRACT_VERSION =
  5 as const;
export const SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION_HEADER =
  "x-openmeld-space-dispatch-trace-response-version";
const SPACE_DISPATCH_TRACE_INVALID_OUTPUT_PREVIEW_MAX_CHARS = 180 as const;

export const spaceDispatchTraceResponseContractVersionSchema = z.union([
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION_PREVIOUS),
  z.literal(SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION),
]);
export const spaceDispatchTraceResponseContractVersionHeaderSchema = z
  .enum([
    "2",
    "3",
    "4",
    "5",
    "6",
    String(SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION_PREVIOUS),
    String(SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION),
  ])
  .transform(Number)
  .pipe(spaceDispatchTraceResponseContractVersionSchema);

const boundedNullableTrimmedStringSchema = (maxLength: number) =>
  z.union([trimmedNonEmptyStringSchema.max(maxLength), z.null()]);
const nullableTrimmedStringSchema = boundedNullableTrimmedStringSchema(4096);
const nullableSignalTextSchema =
  boundedNullableTrimmedStringSchema(MAX_TEXT_LENGTH);
const nullableIsoDateTimeSchema = z.union([ISO_DATE_TIME_SCHEMA, z.null()]);
const nullableIntegerSchema = z.union([z.int(), z.null()]);
const boundedNullableNonNegativeIntegerSchema = (maxValue: number) =>
  z.union([z.int().min(0).max(maxValue), z.null()]);
const nullableProfileKindSchema = z.union([
  z.enum(["human", "agent", "system"]),
  z.null(),
]);

const dispatchTraceOwnerSchema = z.strictObject({
  id: trimmedNonEmptyStringSchema,
  kind: trimmedNonEmptyStringSchema,
});

export const spaceDispatchTraceDispatchStatusSchema = z.enum([
  "queued",
  "dispatching",
  "succeeded",
  "failed_retryable",
  "failed_terminal",
  "deduped",
  "blocked",
  "cancelled",
]);

export const spaceDispatchTraceAttemptStatusSchema = z.enum([
  "blocked",
  "dispatching",
  "failed_retryable",
  "failed_terminal",
  "profile_queue_waiting",
  "succeeded",
  "superseded",
  "timed_out",
  "waiting_result",
]);

export const spaceDispatchTraceQuerySchema = z.strictObject({
  spaceId: trimmedNonEmptyStringSchema,
  dispatchId: trimmedNonEmptyStringSchema,
});

export const spaceDispatchTraceDispatchSchema = z.strictObject({
  factSource: z.literal("dispatch_ledger"),
  dispatchId: trimmedNonEmptyStringSchema,
  idempotencyKey: trimmedNonEmptyStringSchema,
  sourceEventId: trimmedNonEmptyStringSchema,
  sourceClientMessageId: nullableTrimmedStringSchema,
  owner: z.union([dispatchTraceOwnerSchema, z.null()]),
  targetProfileId: trimmedNonEmptyStringSchema,
  status: spaceDispatchTraceDispatchStatusSchema,
  firstSeenAt: ISO_DATE_TIME_SCHEMA,
  lastAttemptAt: ISO_DATE_TIME_SCHEMA,
  attemptCount: z.int().min(0),
  latestAttemptId: nullableTrimmedStringSchema,
});

export const spaceDispatchTraceLatestAttemptSchema = z.strictObject({
  factSource: z.literal("dispatch_attempt"),
  attemptId: trimmedNonEmptyStringSchema,
  dispatchId: trimmedNonEmptyStringSchema,
  idempotencyKey: trimmedNonEmptyStringSchema,
  attemptNo: z.int().min(1),
  status: spaceDispatchTraceAttemptStatusSchema,
  daemonSessionId: nullableTrimmedStringSchema,
  connectionGeneration: nullableIntegerSchema,
  leaseEpoch: nullableIntegerSchema,
  createdAt: ISO_DATE_TIME_SCHEMA,
  startedAt: nullableIsoDateTimeSchema,
  finishedAt: nullableIsoDateTimeSchema,
  errorCode: nullableTrimmedStringSchema,
  errorMessage: nullableTrimmedStringSchema,
});

export const spaceDispatchTraceNativeDeliverySchema = z.strictObject({
  factSource: z.literal("remote_agent_native_delivery_ledger"),
  deliveryId: trimmedNonEmptyStringSchema,
  dispatchId: trimmedNonEmptyStringSchema,
  idempotencyKey: trimmedNonEmptyStringSchema,
  bindingId: trimmedNonEmptyStringSchema,
  runtimeFamily: z.literal("hosted_center_agent"),
  status: z.enum([
    "guardrail_rejected",
    "flag_rejected",
    "worker_unavailable",
    "submitted",
    "accepted",
    "retry_observed",
    "completed",
    "callback_rejected",
    "failed",
  ]),
  submissionId: nullableTrimmedStringSchema,
  destination: z.strictObject({
    conversationKind: z.enum(["message_channel", "slack", "space"]),
    organizationId: trimmedNonEmptyStringSchema,
    spaceId: trimmedNonEmptyStringSchema,
    targetProfileId: trimmedNonEmptyStringSchema,
  }),
  controllerNormalization: z.strictObject({
    factSource: z.literal("remote_agent_native_delivery_ledger"),
    canonicalAgentControllerRef: z.literal("hosted:center-agent"),
    reasonCode: z.literal("hosted_runtime_family_controller_canonicalized"),
    storedAgentControllerRef: nullableTrimmedStringSchema,
    storedAgentControllerRefStatus: z.enum([
      "canonical",
      "stale",
      "malformed",
      "missing",
    ]),
    bindingUpdatedAt: nullableIsoDateTimeSchema,
  }),
  createdAt: ISO_DATE_TIME_SCHEMA,
  updatedAt: ISO_DATE_TIME_SCHEMA,
});

export const spaceDispatchTraceOpsDecisionSchema = z.strictObject({
  factSource: z.literal("ops_decision"),
  id: trimmedNonEmptyStringSchema,
  decisionCode: trimmedNonEmptyStringSchema,
  decidedBy: trimmedNonEmptyStringSchema,
  source: trimmedNonEmptyStringSchema,
  decidedAt: ISO_DATE_TIME_SCHEMA,
  correlationId: nullableTrimmedStringSchema,
  expectedRecoveryCriteria: nullableTrimmedStringSchema,
});

export const spaceDispatchTraceReplySignalSchema = z.strictObject({
  factSource: z.enum([
    "space_signal_by_published_signal_id",
    "space_signal_recent_window",
  ]),
  signalId: trimmedNonEmptyStringSchema,
  profileId: trimmedNonEmptyStringSchema,
  profileKind: nullableProfileKindSchema,
  profileName: nullableTrimmedStringSchema,
  text: trimmedNonEmptyStringSchema,
  createdAt: ISO_DATE_TIME_SCHEMA,
});

export const spaceDispatchTraceFinalVisibleMessageFactSourceSchema = z.enum([
  "space_signal_by_published_signal_id",
  "space_final_reply_claim",
]);

export const spaceDispatchTraceFinalVisibleMessageSchema = z.strictObject({
  factSource: spaceDispatchTraceFinalVisibleMessageFactSourceSchema,
  signalId: trimmedNonEmptyStringSchema,
  signalType: z.enum(["signal.text", "signal.status", "signal.system_notice"]),
  dispatchId: trimmedNonEmptyStringSchema,
  targetProfileId: trimmedNonEmptyStringSchema,
  profileId: nullableTrimmedStringSchema,
  profileKind: nullableProfileKindSchema,
  profileName: nullableTrimmedStringSchema,
  text: nullableSignalTextSchema,
  reasonCode: nullableTrimmedStringSchema,
  noticeType: z.union([
    z.enum([
      "policy_blocked",
      "stay_silent",
      "terminal_failure",
      "wake_stopped",
    ]),
    z.null(),
  ]),
  statusType: nullableTrimmedStringSchema,
  createdAt: ISO_DATE_TIME_SCHEMA,
});

export const spaceDispatchTraceFinalVisibleMessageLinkageStatusSchema = z.enum([
  "matched_published_signal",
  "matched_final_reply_claim",
  "projection_pending",
  "linkage_missing",
  "storage_inconsistent",
]);

export const spaceDispatchTraceFinalVisibleMessageLinkageSourceFactSchema =
  z.enum(["published_signal_candidate", "space_final_reply_claim", "none"]);

export const spaceDispatchTraceFinalVisibleMessageLinkageSchema =
  z.strictObject({
    status: spaceDispatchTraceFinalVisibleMessageLinkageStatusSchema,
    reasonCode: nullableTrimmedStringSchema,
    sourceFact: spaceDispatchTraceFinalVisibleMessageLinkageSourceFactSchema,
    candidateSignalIds: z.array(trimmedNonEmptyStringSchema).max(16),
    claimSignalId: nullableTrimmedStringSchema,
    selectedSignalId: nullableTrimmedStringSchema,
  });

export const spaceDispatchTraceFinalVisibleOutcomeStatusSchema = z.enum([
  "visible_reply",
  "visible_failure",
  "visible_stopped",
  "publication_pending",
  "publication_retrying",
  "publication_unresolved",
  "not_applicable",
]);

export const spaceDispatchTraceFinalVisibleOutcomePublicationKindSchema =
  z.enum(["success_reply", "failure_notice", "stopped_notice"]);

export const spaceDispatchTraceFinalVisibleOutcomeSourceFactSchema = z.enum([
  "final_visible_message",
  "result_inbox",
  "runtime_coordinator_execution",
  "runtime_coordinator_event",
  "runtime_coordinator_head_lifecycle",
  "dispatch_result",
  "none",
]);

export const spaceDispatchTraceFinalVisibleOutcomeSchema = z.strictObject({
  delivered: z.boolean(),
  publicationErrorCode: nullableTrimmedStringSchema,
  publicationKind: z.union([
    spaceDispatchTraceFinalVisibleOutcomePublicationKindSchema,
    z.null(),
  ]),
  reasonCode: nullableTrimmedStringSchema,
  signalId: nullableTrimmedStringSchema,
  sourceFact: spaceDispatchTraceFinalVisibleOutcomeSourceFactSchema,
  sourceReasonCode: nullableTrimmedStringSchema,
  sourceStatus: nullableTrimmedStringSchema,
  status: spaceDispatchTraceFinalVisibleOutcomeStatusSchema,
});

// Legacy diagnostic fact kept only so old dispatch trace payloads can still parse.
export const spaceDispatchTraceClaimLeaseSchema = z.strictObject({
  factSource: z.literal("dispatch_claim_lease"),
  claimLeaseId: trimmedNonEmptyStringSchema,
  dispatchId: trimmedNonEmptyStringSchema,
  sourceEventId: trimmedNonEmptyStringSchema,
  sourceClientMessageId: nullableTrimmedStringSchema,
  targetProfileId: trimmedNonEmptyStringSchema,
  bindingId: trimmedNonEmptyStringSchema,
  openMeldServiceRuntimeId: trimmedNonEmptyStringSchema,
  agentControllerRef: trimmedNonEmptyStringSchema,
  leaseState: z.enum([
    "active",
    "cancelled",
    "expired",
    "released",
    "superseded",
  ]),
  claimTraceReason: nullableTrimmedStringSchema,
  createdAt: ISO_DATE_TIME_SCHEMA,
  updatedAt: ISO_DATE_TIME_SCHEMA,
  expiresAt: ISO_DATE_TIME_SCHEMA,
});

export const spaceDispatchTraceResultSchema = z.strictObject({
  factSource: z.literal("dispatch_result"),
  resultRef: trimmedNonEmptyStringSchema,
  dispatchId: trimmedNonEmptyStringSchema,
  resultKind: trimmedNonEmptyStringSchema,
  publicOutcome: trimmedNonEmptyStringSchema,
  publishedSignalId: nullableTrimmedStringSchema,
  statusType: nullableTrimmedStringSchema,
  createdAt: ISO_DATE_TIME_SCHEMA,
});

export const spaceDispatchTraceResultInboxPublishStateSchema = z.enum([
  "result_accepted",
  "late_result_available",
  "reply_published",
  "reply_suppressed_stopped",
  "reply_publication_failed",
  "invalid_space_action",
  "legacy_result_quarantined",
]);

export const spaceDispatchTraceResultInboxSchema = z.strictObject({
  factSource: z.literal("dispatch_result_inbox"),
  resultKey: trimmedNonEmptyStringSchema,
  dispatchId: trimmedNonEmptyStringSchema,
  attemptId: trimmedNonEmptyStringSchema,
  taskId: trimmedNonEmptyStringSchema,
  targetProfileId: trimmedNonEmptyStringSchema,
  daemonSessionId: trimmedNonEmptyStringSchema,
  leaseEpoch: z.int(),
  submittedConnectionGeneration: z.int(),
  projectFailureContext:
    openMeldDaemonTaskResultProjectFailureContextSchema.optional(),
  publishState: spaceDispatchTraceResultInboxPublishStateSchema,
  publishedSignalId: nullableTrimmedStringSchema,
  publicationErrorCode: nullableTrimmedStringSchema,
  acceptedAt: ISO_DATE_TIME_SCHEMA,
  updatedAt: ISO_DATE_TIME_SCHEMA,
});

export const spaceDispatchTraceStreamingSchema = z.strictObject({
  streamingMode: z.enum(["final", "stream"]),
  previewEmitted: z.boolean(),
  firstStdoutAt: nullableIsoDateTimeSchema,
  firstOutputAt: nullableIsoDateTimeSchema,
});

export const spaceDispatchTraceRuntimeSchema = z.strictObject({
  processId: nullableIntegerSchema,
  processSpawnedAt: nullableIsoDateTimeSchema,
  stdinClosedAt: nullableIsoDateTimeSchema,
  firstStderrAt: nullableIsoDateTimeSchema,
  exitObservedAt: nullableIsoDateTimeSchema,
  exitCode: nullableIntegerSchema,
  exitSignal: nullableTrimmedStringSchema,
  timeoutTriggeredAt: nullableIsoDateTimeSchema,
});

export const spaceDispatchTraceExecutionSchema = z.strictObject({
  phase: z.enum([
    "starting",
    "accepted_local",
    "running",
    "completed_local",
    "result_received",
  ]),
  phaseEnteredAt: nullableIsoDateTimeSchema,
  lastLifecycleAt: nullableIsoDateTimeSchema,
  progressEvidenceState: z.enum(["active", "stalled", "unknown"]),
  timeoutPolicy: z.strictObject({
    finalizationTimeoutMs: boundedNullableNonNegativeIntegerSchema(
      SPACE_DISPATCH_TRACE_TIMEOUT_POLICY_MAX_MS
    ),
    startTimeoutMs: boundedNullableNonNegativeIntegerSchema(
      SPACE_DISPATCH_TRACE_TIMEOUT_POLICY_MAX_MS
    ),
    taskProgressEvidenceStaleAfterMs: boundedNullableNonNegativeIntegerSchema(
      SPACE_DISPATCH_TRACE_TIMEOUT_POLICY_MAX_MS
    ),
    waitWindowMs: boundedNullableNonNegativeIntegerSchema(
      SPACE_DISPATCH_TRACE_TIMEOUT_POLICY_MAX_MS
    ),
  }),
});

export const spaceDispatchTraceOriginSchema = z.strictObject({
  agentControllerConversationId: nullableTrimmedStringSchema,
  agentControllerRef: nullableTrimmedStringSchema,
  agentControllerConversationKind: nullableTrimmedStringSchema,
  resolvedAgentControllerConversationId: nullableTrimmedStringSchema,
  effectiveRuntimeWorkingDirectory: nullableTrimmedStringSchema,
  runtimeWorkspaceFingerprint: nullableTrimmedStringSchema,
});

export const spaceDispatchTracePromptSchema = z.strictObject({
  fingerprint: nullableTrimmedStringSchema,
  length: boundedNullableNonNegativeIntegerSchema(
    SPACE_DISPATCH_TRACE_PROMPT_LENGTH_MAX
  ),
  preview: boundedNullableTrimmedStringSchema(
    SPACE_DISPATCH_TRACE_PROMPT_PREVIEW_MAX_CHARS
  ),
});

export const spaceDispatchTraceDispatchExecutionSchema =
  dispatchExecutionSchema;

export const spaceDispatchTraceExecutionIdentitySchema =
  spaceTraceExecutionIdentityProjectionSchema;

export const spaceDispatchTraceRuntimeCoordinatorExecutionSchema =
  runtimeCoordinatorExecutionRecordSchema.extend({
    factSource: z.literal("runtime_coordinator_projection"),
  });

export const spaceDispatchTraceRuntimeCoordinatorCreationDiagnosticSchema =
  runtimeCoordinatorExecutionCreationDiagnosticSchema.extend({
    factSource: z.literal("runtime_coordinator_projection"),
  });

export const spaceDispatchTraceRuntimeCoordinatorEventSchema =
  runtimeCoordinatorExecutionEventSchema.extend({
    factSource: z.literal("runtime_coordinator_projection"),
  });

// Space dispatch trace is consumed by already-published strict CLI schemas.
// Keep this public projection independent from the wider internal transport
// lifecycle so new internal states cannot become a breaking response by import.
const publishedRuntimeCoordinatorHeadLifecycleStatusSchema = z.enum([
  "accepted",
  "execution_linked",
  "publication_intent_ready",
  "queued",
  "stopped_before_execution",
  "waiting",
]);
const publishedRuntimeCoordinatorHeadDecisionSourceSchema = z.enum([
  "dispatch_preflight",
  "dispatch_delivery_pre_execution",
  "runtime_coordinator_head_waiting_deadline",
]);
const legacyPublishedRuntimeCoordinatorHeadPublicationCategorySchema = z.enum([
  "binding_required",
  "local_connection_mismatch",
  "service_not_connected",
  "update_required",
]);
const legacyPublishedRuntimeCoordinatorHeadReasonCodeSchema = z.enum([
  "agent_profile_binding.missing",
  "agent_profile_binding.disabled",
  "agent_profile_binding.owner_mismatch",
  "organization_binding_authorization.required",
  "local_service.identity_mismatch",
  "daemon.profile.offline",
  "service.update_required",
]);
const legacyPublishedRuntimeCoordinatorHeadRecoveryActionSchema = z.enum([
  "set_up_agent_binding",
  "enable_agent_binding",
  "repair_agent_binding",
  "authorize_agent_binding_for_organization",
  "reconnect_agent_binding",
  "start_or_restart_openmeld_service",
  "update_openmeld_service",
]);

const publishedRuntimeCoordinatorHeadPublicationCategoryV2Schema = z.enum([
  "binding_required",
  "local_connection_mismatch",
  "service_not_connected",
  "update_required",
  "wake_route_registration_pending",
]);
const publishedRuntimeCoordinatorHeadReasonCodeV2Schema = z.enum([
  "agent_profile_binding.missing",
  "agent_profile_binding.disabled",
  "agent_profile_binding.owner_mismatch",
  "organization_binding_authorization.required",
  "local_service.identity_mismatch",
  "daemon.profile.offline",
  "daemon.profile.pending_first_report",
  "service.update_required",
]);
const publishedRuntimeCoordinatorHeadRecoveryActionV2Schema = z.enum([
  "set_up_agent_binding",
  "enable_agent_binding",
  "repair_agent_binding",
  "authorize_agent_binding_for_organization",
  "reconnect_agent_binding",
  "start_or_restart_openmeld_service",
  "update_openmeld_service",
  "wait_for_wake_route_report",
]);

const currentPublishedRuntimeCoordinatorHeadPublicationCategorySchema = z.enum([
  "space_access_unavailable",
  "binding_required",
  "agent_profile_unavailable",
  "local_agent_unavailable",
  "local_connection_mismatch",
  "provider_access_unavailable",
  "provider_usage_unavailable",
  "service_not_connected",
  "update_required",
  "wake_route_registration_pending",
  "workspace_unavailable",
]);
const currentPublishedRuntimeCoordinatorHeadReasonCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(160);
const currentPublishedRuntimeCoordinatorHeadRecoveryActionSchema = z.enum([
  "send_new_wake",
  "set_up_agent_binding",
  "enable_agent_binding",
  "repair_agent_binding",
  "authorize_agent_binding_for_organization",
  "check_status",
  "connect_local_agent",
  "enable_local_agent",
  "reconnect_agent_binding",
  "review_agent_settings",
  "start_or_restart_openmeld_service",
  "update_openmeld_service",
  "wait_for_usage_report",
  "wait_for_usage_reset",
  "wait_for_wake_route_report",
]);

const spaceDispatchTraceRuntimeCoordinatorHeadNoExecutionDecisionV1Schema =
  z.strictObject({
    decidedAt: ISO_DATE_TIME_SCHEMA,
    publicationCategory:
      legacyPublishedRuntimeCoordinatorHeadPublicationCategorySchema,
    reasonCode: legacyPublishedRuntimeCoordinatorHeadReasonCodeSchema,
    source: publishedRuntimeCoordinatorHeadDecisionSourceSchema,
    userRecoveryAction:
      legacyPublishedRuntimeCoordinatorHeadRecoveryActionSchema,
  });

export const spaceDispatchTraceRuntimeCoordinatorHeadNoExecutionDecisionV2Schema =
  z.strictObject({
    decidedAt: ISO_DATE_TIME_SCHEMA,
    publicationCategory:
      publishedRuntimeCoordinatorHeadPublicationCategoryV2Schema,
    reasonCode: publishedRuntimeCoordinatorHeadReasonCodeV2Schema,
    source: publishedRuntimeCoordinatorHeadDecisionSourceSchema,
    userRecoveryAction: publishedRuntimeCoordinatorHeadRecoveryActionV2Schema,
  });

const spaceDispatchTraceRuntimeCoordinatorHeadNoExecutionDecisionSchema =
  z.strictObject({
    decidedAt: ISO_DATE_TIME_SCHEMA,
    publicationCategory:
      currentPublishedRuntimeCoordinatorHeadPublicationCategorySchema,
    reasonCode: currentPublishedRuntimeCoordinatorHeadReasonCodeSchema,
    source: publishedRuntimeCoordinatorHeadDecisionSourceSchema,
    userRecoveryAction:
      currentPublishedRuntimeCoordinatorHeadRecoveryActionSchema,
  });

const spaceDispatchTraceRuntimeCoordinatorHeadPublicationIntentV1Schema =
  z.union([
    z.strictObject({
      intentId: trimmedNonEmptyStringSchema.max(4096),
      kind: z.literal("no_execution_failure"),
      publicationCategory:
        legacyPublishedRuntimeCoordinatorHeadPublicationCategorySchema,
      readyAt: ISO_DATE_TIME_SCHEMA,
      reasonCode: legacyPublishedRuntimeCoordinatorHeadReasonCodeSchema,
      status: z.literal("ready_for_phase_6"),
      userRecoveryAction:
        legacyPublishedRuntimeCoordinatorHeadRecoveryActionSchema,
    }),
    z.strictObject({
      intentId: trimmedNonEmptyStringSchema.max(4096),
      kind: z.literal("stopped_notice"),
      readyAt: ISO_DATE_TIME_SCHEMA,
      reasonCode: z.literal("runtime_coordinator.pre_agent_stop_requested"),
      status: z.literal("ready_for_phase_6"),
    }),
  ]);

export const spaceDispatchTraceRuntimeCoordinatorHeadPublicationIntentV2Schema =
  z.union([
    z.strictObject({
      intentId: trimmedNonEmptyStringSchema.max(4096),
      kind: z.literal("no_execution_failure"),
      publicationCategory:
        publishedRuntimeCoordinatorHeadPublicationCategoryV2Schema,
      readyAt: ISO_DATE_TIME_SCHEMA,
      reasonCode: publishedRuntimeCoordinatorHeadReasonCodeV2Schema,
      status: z.literal("ready_for_phase_6"),
      userRecoveryAction: publishedRuntimeCoordinatorHeadRecoveryActionV2Schema,
    }),
    z.strictObject({
      intentId: trimmedNonEmptyStringSchema.max(4096),
      kind: z.literal("stopped_notice"),
      readyAt: ISO_DATE_TIME_SCHEMA,
      reasonCode: z.literal("runtime_coordinator.pre_agent_stop_requested"),
      status: z.literal("ready_for_phase_6"),
    }),
  ]);

const spaceDispatchTraceRuntimeCoordinatorHeadPublicationIntentSchema = z.union(
  [
    z.strictObject({
      intentId: trimmedNonEmptyStringSchema.max(4096),
      kind: z.literal("no_execution_failure"),
      publicationCategory:
        currentPublishedRuntimeCoordinatorHeadPublicationCategorySchema,
      readyAt: ISO_DATE_TIME_SCHEMA,
      reasonCode: currentPublishedRuntimeCoordinatorHeadReasonCodeSchema,
      status: z.literal("ready_for_phase_6"),
      userRecoveryAction:
        currentPublishedRuntimeCoordinatorHeadRecoveryActionSchema,
    }),
    z.strictObject({
      intentId: trimmedNonEmptyStringSchema.max(4096),
      kind: z.literal("stopped_notice"),
      readyAt: ISO_DATE_TIME_SCHEMA,
      reasonCode: z.literal("runtime_coordinator.pre_agent_stop_requested"),
      status: z.literal("ready_for_phase_6"),
    }),
  ]
);

const spaceDispatchTraceRuntimeCoordinatorHeadPublicationOutcomeSchema =
  z.strictObject({
    failurePublicationCommandId: trimmedNonEmptyStringSchema.max(4096),
    finalMessageKind: z
      .enum(["failure_notice", "status", "success_reply", "unknown"])
      .nullable(),
    observedAt: ISO_DATE_TIME_SCHEMA,
    publicationErrorCode: z.string().trim().min(1).max(160).nullable(),
    publishedSignalId: trimmedNonEmptyStringSchema.nullable(),
    status: z.enum([
      "failure_published",
      "already_final",
      "failure_publication_failed",
    ]),
  });

const spaceDispatchTraceRuntimeCoordinatorHeadPublicationExhaustionSchema =
  z.strictObject({
    attemptCount: z.int().positive(),
    exhaustedAt: ISO_DATE_TIME_SCHEMA,
    lastFailureAt: ISO_DATE_TIME_SCHEMA,
    lastReasonCode: z.string().trim().min(1).max(160),
    reasonCode: z.literal("runtime_coordinator.publication_retry_exhausted"),
    status: z.literal("publication_exhausted"),
  });

const spaceDispatchTraceRuntimeCoordinatorHeadTargetDisplaySchema =
  z.strictObject({
    targetProfileMentionLabel: spaceMentionLabelSchema.nullable(),
    targetProfileName: z
      .string()
      .min(1)
      .max(MAX_PROFILE_NAME_LENGTH)
      .nullable(),
  });

const spaceDispatchTraceRuntimeCoordinatorHeadOfflineWaitingBoundarySchema =
  z.strictObject({
    deadlineAt: ISO_DATE_TIME_SCHEMA,
    deadlineOutcome: z.literal("publication_intent_ready"),
    observedAt: ISO_DATE_TIME_SCHEMA,
    reasonCode: z.literal("daemon.profile.offline"),
    softDeadlineAt: ISO_DATE_TIME_SCHEMA,
    trigger: z.literal("openmeld_service_route_connected"),
    triggerOwner: z.literal("runtime_coordinator"),
    userRecoveryAction: z.literal("start_or_restart_openmeld_service"),
    userVisibleState: z.literal("waiting_for_openmeld_service"),
    waitingCategory: z.literal("service_not_connected"),
    waitingFor: z.literal("openmeld_service_route_connection"),
    waitingSince: ISO_DATE_TIME_SCHEMA,
  });

const spaceDispatchTraceRuntimeCoordinatorHeadPendingRouteWaitingBoundarySchema =
  z.strictObject({
    deadlineAt: ISO_DATE_TIME_SCHEMA,
    deadlineOutcome: z.literal("publication_intent_ready"),
    observedAt: ISO_DATE_TIME_SCHEMA,
    reasonCode: z.literal("daemon.profile.pending_first_report"),
    softDeadlineAt: ISO_DATE_TIME_SCHEMA,
    trigger: z.literal("wake_route_reported"),
    triggerOwner: z.literal("runtime_coordinator"),
    userRecoveryAction: z.literal("wait_for_wake_route_report"),
    userVisibleState: z.literal("waiting_for_wake_route_report"),
    waitingCategory: z.literal("wake_route_registration_pending"),
    waitingFor: z.literal("wake_route_report"),
    waitingSince: ISO_DATE_TIME_SCHEMA,
  });

const spaceDispatchTraceRuntimeCoordinatorHeadWaitingBoundarySchema =
  z.discriminatedUnion("reasonCode", [
    z.strictObject({
      deadlineAt: ISO_DATE_TIME_SCHEMA,
      deadlineOutcome: z.literal("publication_intent_ready"),
      observedAt: ISO_DATE_TIME_SCHEMA,
      reasonCode: z.literal("wake.device_wait.access_check_unavailable"),
      softDeadlineAt: ISO_DATE_TIME_SCHEMA,
      trigger: z.literal("space_access_rechecked"),
      triggerOwner: z.literal("runtime_coordinator"),
      userRecoveryAction: z.literal("check_status"),
      userVisibleState: z.literal("waiting_for_space_access"),
      waitingCategory: z.literal("space_access_unavailable"),
      waitingFor: z.literal("space_access_check"),
      waitingSince: ISO_DATE_TIME_SCHEMA,
    }),
    z.strictObject({
      deadlineAt: ISO_DATE_TIME_SCHEMA,
      deadlineOutcome: z.literal("publication_intent_ready"),
      observedAt: ISO_DATE_TIME_SCHEMA,
      reasonCode: z.enum([
        "wake.device_wait.readiness_checking",
        "daemon.service.draining",
      ]),
      softDeadlineAt: ISO_DATE_TIME_SCHEMA,
      trigger: z.literal("agent_readiness_reported"),
      triggerOwner: z.literal("runtime_coordinator"),
      userRecoveryAction: z.literal("check_status"),
      userVisibleState: z.literal("waiting_for_agent_readiness"),
      waitingCategory: z.literal("local_agent_unavailable"),
      waitingFor: z.literal("agent_readiness_report"),
      waitingSince: ISO_DATE_TIME_SCHEMA,
    }),
    spaceDispatchTraceRuntimeCoordinatorHeadOfflineWaitingBoundarySchema,
    spaceDispatchTraceRuntimeCoordinatorHeadPendingRouteWaitingBoundarySchema,
  ]);

const spaceDispatchTraceRuntimeCoordinatorHeadFoundCommonShape = {
  executionContext: executionContextDiagnosticsSchema.optional(),
  createdAt: ISO_DATE_TIME_SCHEMA,
  duplicateDispatchCount: z.int().min(0),
  executionLinkedAt: nullableIsoDateTimeSchema,
  factSource: z.literal("runtime_coordinator_head_lifecycle"),
  modelVersion: z.literal("openmeld.runtime_coordinator.head_lifecycle.v1"),
  ownerUserId: trimmedNonEmptyStringSchema,
  primaryDispatchId: trimmedNonEmptyStringSchema,
  publicationExhaustion:
    spaceDispatchTraceRuntimeCoordinatorHeadPublicationExhaustionSchema.optional(),
  publicationOutcome:
    spaceDispatchTraceRuntimeCoordinatorHeadPublicationOutcomeSchema.optional(),
  readStatus: z.literal("found"),
  runtimeCoordinatorExecutionId:
    runtimeCoordinatorExecutionRecordSchema.shape.runtimeCoordinatorExecutionId.nullable(),
  status: publishedRuntimeCoordinatorHeadLifecycleStatusSchema,
  targetWakeLifecycleIdentity: targetWakeLifecycleIdentitySchema,
  targetWakeLifecycleId: trimmedNonEmptyStringSchema.max(2048),
  targetDisplay:
    spaceDispatchTraceRuntimeCoordinatorHeadTargetDisplaySchema.optional(),
  updatedAt: ISO_DATE_TIME_SCHEMA,
} as const;

const spaceDispatchTraceRuntimeCoordinatorHeadMissingSchema = z.strictObject({
  executionContext: executionContextDiagnosticsSchema.optional(),
  factSource: z.literal("runtime_coordinator_head_lifecycle"),
  readStatus: z.literal("missing"),
  reasonCode: z.literal("runtime_coordinator.head_lifecycle_not_found"),
  targetWakeLifecycleId: trimmedNonEmptyStringSchema.max(2048),
});

const spaceDispatchTraceRuntimeCoordinatorHeadAuthorityUnavailableSchema =
  z.strictObject({
    executionContext: executionContextDiagnosticsSchema.optional(),
    factSource: z.literal("runtime_coordinator_head_lifecycle"),
    readStatus: z.literal("authority_unavailable"),
    reasonCode: trimmedNonEmptyStringSchema.max(160),
    targetWakeLifecycleId: trimmedNonEmptyStringSchema.max(2048),
  });

export const spaceDispatchTraceRuntimeCoordinatorHeadLifecycleV1Schema =
  z.discriminatedUnion("readStatus", [
    z.strictObject({
      ...spaceDispatchTraceRuntimeCoordinatorHeadFoundCommonShape,
      noExecutionDecision: z.union([
        spaceDispatchTraceRuntimeCoordinatorHeadNoExecutionDecisionV1Schema,
        z.null(),
      ]),
      publicationIntent: z.union([
        spaceDispatchTraceRuntimeCoordinatorHeadPublicationIntentV1Schema,
        z.null(),
      ]),
      waitingBoundary: z.union([
        spaceDispatchTraceRuntimeCoordinatorHeadOfflineWaitingBoundarySchema,
        z.null(),
      ]),
    }),
    spaceDispatchTraceRuntimeCoordinatorHeadMissingSchema,
    spaceDispatchTraceRuntimeCoordinatorHeadAuthorityUnavailableSchema,
  ]);

export const spaceDispatchTraceRuntimeCoordinatorHeadLifecycleV2Schema =
  z.discriminatedUnion("readStatus", [
    z.strictObject({
      ...spaceDispatchTraceRuntimeCoordinatorHeadFoundCommonShape,
      noExecutionDecision: z.union([
        spaceDispatchTraceRuntimeCoordinatorHeadNoExecutionDecisionV2Schema,
        z.null(),
      ]),
      publicationIntent: z.union([
        spaceDispatchTraceRuntimeCoordinatorHeadPublicationIntentV2Schema,
        z.null(),
      ]),
      waitingBoundary: z.union([
        spaceDispatchTraceRuntimeCoordinatorHeadWaitingBoundarySchema,
        z.null(),
      ]),
    }),
    spaceDispatchTraceRuntimeCoordinatorHeadMissingSchema,
    spaceDispatchTraceRuntimeCoordinatorHeadAuthorityUnavailableSchema,
  ]);

export const spaceDispatchTraceRuntimeCoordinatorHeadLifecycleSchema =
  z.discriminatedUnion("readStatus", [
    z.strictObject({
      ...spaceDispatchTraceRuntimeCoordinatorHeadFoundCommonShape,
      noExecutionDecision: z.union([
        spaceDispatchTraceRuntimeCoordinatorHeadNoExecutionDecisionSchema,
        z.null(),
      ]),
      publicationIntent: z.union([
        spaceDispatchTraceRuntimeCoordinatorHeadPublicationIntentSchema,
        z.null(),
      ]),
      waitingBoundary: z.union([
        spaceDispatchTraceRuntimeCoordinatorHeadWaitingBoundarySchema,
        z.null(),
      ]),
    }),
    spaceDispatchTraceRuntimeCoordinatorHeadMissingSchema,
    spaceDispatchTraceRuntimeCoordinatorHeadAuthorityUnavailableSchema,
  ]);

export const spaceDispatchTraceStructuredActionFailureSchema = z.strictObject({
  carrierKind: z.enum([
    "fenced_block",
    "invalid_json",
    "none",
    "trailing_json",
  ]),
  invalidOutputPreview: boundedNullableTrimmedStringSchema(
    SPACE_DISPATCH_TRACE_INVALID_OUTPUT_PREVIEW_MAX_CHARS
  ),
  publicFailureReason: nullableTrimmedStringSchema,
  repairMode: z.enum([
    "required_check",
    "local_synthetic",
    "controller_roundtrip",
  ]),
  spaceActionCandidatePresent: z.boolean(),
  spaceActionParseError: nullableTrimmedStringSchema,
});

export const spaceDispatchTraceOpenClawGatewayVisibilitySchema = z.strictObject(
  {
    agentId: trimmedNonEmptyStringSchema,
    gatewayRestartAttempted: z.boolean(),
    gatewayVisibility: z.enum([
      "missing_after_restart",
      "missing_before_restart",
      "visible",
      "visible_after_restart",
    ]),
  }
);

export const spaceDispatchTraceOpenClawBindingSchema = z.strictObject({
  classification: z.enum(["missing", "canonical_owned", "legacy", "foreign"]),
  bindingSource: z.union([z.enum(["daemon-launch", "imported"]), z.null()]),
  upgradeApplied: z.boolean(),
});

export const spaceDispatchTraceSnapshotSchema = z.strictObject({
  dispatch: spaceDispatchTraceDispatchSchema,
  nativeDelivery: z
    .union([spaceDispatchTraceNativeDeliverySchema, z.null()])
    .optional(),
  runtimeCoordinatorExecution: z.union([
    spaceDispatchTraceRuntimeCoordinatorExecutionSchema,
    z.null(),
  ]),
  runtimeCoordinatorCreationDiagnostics: z.array(
    spaceDispatchTraceRuntimeCoordinatorCreationDiagnosticSchema
  ),
  runtimeCoordinatorEvents: z.array(
    spaceDispatchTraceRuntimeCoordinatorEventSchema
  ),
  runtimeCoordinatorHeadLifecycle: z.union([
    spaceDispatchTraceRuntimeCoordinatorHeadLifecycleSchema,
    z.null(),
  ]),
  latestAttempt: z.union([spaceDispatchTraceLatestAttemptSchema, z.null()]),
  executionIdentity: z.union([
    spaceDispatchTraceExecutionIdentitySchema,
    z.null(),
  ]),
  // Legacy field. Current RuntimeCoordinator-backed traces project this as null.
  claimLease: z.union([spaceDispatchTraceClaimLeaseSchema, z.null()]),
  result: z.union([spaceDispatchTraceResultSchema, z.null()]),
  resultInbox: z.union([spaceDispatchTraceResultInboxSchema, z.null()]),
  recentOpsDecisions: z.array(spaceDispatchTraceOpsDecisionSchema),
  replySignal: z.union([spaceDispatchTraceReplySignalSchema, z.null()]),
  finalVisibleMessage: z
    .union([spaceDispatchTraceFinalVisibleMessageSchema, z.null()])
    .optional(),
  finalVisibleMessageLinkage: z
    .union([spaceDispatchTraceFinalVisibleMessageLinkageSchema, z.null()])
    .optional(),
  finalVisibleOutcome: spaceDispatchTraceFinalVisibleOutcomeSchema.optional(),
  streaming: z.union([spaceDispatchTraceStreamingSchema, z.null()]),
  runtime: z.union([spaceDispatchTraceRuntimeSchema, z.null()]),
  execution: z.union([spaceDispatchTraceExecutionSchema, z.null()]),
  origin: z.union([spaceDispatchTraceOriginSchema, z.null()]),
  prompt: z.union([spaceDispatchTracePromptSchema, z.null()]),
  dispatchExecution: z.union([
    spaceDispatchTraceDispatchExecutionSchema,
    z.null(),
  ]),
  openClawGatewayVisibility: z.union([
    spaceDispatchTraceOpenClawGatewayVisibilitySchema,
    z.null(),
  ]),
  openClawBinding: z.union([spaceDispatchTraceOpenClawBindingSchema, z.null()]),
  structuredActionFailure: z.union([
    spaceDispatchTraceStructuredActionFailureSchema,
    z.null(),
  ]),
});

export const spaceDispatchTraceSnapshotV1Schema =
  spaceDispatchTraceSnapshotSchema.extend({
    runtimeCoordinatorHeadLifecycle: z.union([
      spaceDispatchTraceRuntimeCoordinatorHeadLifecycleV1Schema,
      z.null(),
    ]),
  });

export const spaceDispatchTraceSnapshotV2Schema =
  spaceDispatchTraceSnapshotSchema.extend({
    runtimeCoordinatorHeadLifecycle: z.union([
      spaceDispatchTraceRuntimeCoordinatorHeadLifecycleV2Schema,
      z.null(),
    ]),
  });

export const spaceNativeDeliveryTraceSchema = z.strictObject({
  factSource: z.literal("remote_agent_native_delivery_ledger"),
  bindingId: trimmedNonEmptyStringSchema,
  destination: spaceDispatchTraceNativeDeliverySchema.shape.destination.extend({
    conversationKind: z.literal("space"),
  }),
  turn: centerAgentTurnDiagnosticSchema.partial({
    runtimeEvidence: true,
    runtimeEvidenceStatus: true,
  }),
  finalVisibleMessage: spaceDispatchTraceFinalVisibleMessageSchema.nullable(),
  finalVisibleMessageLinkage:
    spaceDispatchTraceFinalVisibleMessageLinkageSchema.nullable(),
  finalVisibleOutcome: spaceDispatchTraceFinalVisibleOutcomeSchema,
});

function validateSpaceNativeDeliveryTraceResponse(
  value: {
    correlation: zod.infer<typeof observabilityWakeCorrelationSchema>;
    query: zod.infer<typeof spaceDispatchTraceQuerySchema>;
    trace: SpaceDispatchTraceSnapshotValue | null;
    nativeDeliveryTrace?: zod.infer<typeof spaceNativeDeliveryTraceSchema>;
  },
  context: zod.RefinementCtx
): void {
  const native = value.nativeDeliveryTrace;
  if (!native) {
    return;
  }
  if (value.trace !== null) {
    context.addIssue({
      code: "custom",
      path: ["trace"],
      message: "native-only trace must not contain a workstation dispatch",
    });
  }
  expectTraceEvidence(
    context,
    native.turn.dispatchId,
    value.query.dispatchId,
    ["nativeDeliveryTrace", "turn", "dispatchId"],
    "native dispatch must match the selector"
  );
  expectTraceEvidence(
    context,
    native.destination.spaceId,
    value.query.spaceId,
    ["nativeDeliveryTrace", "destination", "spaceId"],
    "native destination must match the queried Space"
  );
  expectTraceEvidence(
    context,
    value.correlation.targetProfileId,
    native.destination.targetProfileId,
    ["correlation", "targetProfileId"],
    "native target must match correlation"
  );
  expectTraceEvidence(
    context,
    value.correlation.bindingId,
    native.bindingId,
    ["correlation", "bindingId"],
    "native Binding must match correlation"
  );
  expectTraceEvidence(
    context,
    value.correlation.agentControllerRef,
    "hosted:center-agent",
    ["correlation", "agentControllerRef"],
    "native controller must match its runtime family"
  );
  expectTraceEvidence(
    context,
    value.correlation.publishedSignalId,
    native.turn.publishedResultId,
    ["correlation", "publishedSignalId"],
    "published signal must match native publication evidence"
  );
  expectTraceEvidence(
    context,
    value.correlation.replySignalId,
    native.finalVisibleMessage?.signalId ?? null,
    ["correlation", "replySignalId"],
    "visible signal must match native publication evidence"
  );
  for (const key of [
    "clientMessageId",
    "sourceSignalId",
    "latestAttemptId",
    "runtimeCoordinatorExecutionId",
    "claimLeaseId",
    "openMeldServiceRuntimeId",
    "resultRef",
  ] as const) {
    expectNullTraceEvidence(context, value.correlation[key], [
      "correlation",
      key,
    ]);
  }
  if (
    native.turn.conversationSource?.kind !== "space" ||
    native.turn.conversationSource.spaceId !== value.query.spaceId
  ) {
    context.addIssue({
      code: "custom",
      path: ["nativeDeliveryTrace", "turn", "conversationSource"],
      message: "native turn must belong to the queried Space",
    });
  }
  if (
    (native.turn.runtimeEvidenceStatus === undefined) !==
    (native.turn.runtimeEvidence === undefined)
  ) {
    context.addIssue({
      code: "custom",
      path: ["nativeDeliveryTrace", "turn", "runtimeEvidenceStatus"],
      message: "runtime evidence and read status must be provided together",
    });
  }
  if (native.finalVisibleMessage) {
    expectTraceEvidence(
      context,
      native.finalVisibleMessage.dispatchId,
      value.query.dispatchId,
      ["nativeDeliveryTrace", "finalVisibleMessage", "dispatchId"],
      "visible message must match native dispatch"
    );
    expectTraceEvidence(
      context,
      native.finalVisibleMessage.targetProfileId,
      native.destination.targetProfileId,
      ["nativeDeliveryTrace", "finalVisibleMessage", "targetProfileId"],
      "visible message must match native target"
    );
  }
  if (native.finalVisibleMessageLinkage) {
    expectTraceEvidence(
      context,
      native.finalVisibleMessageLinkage.selectedSignalId,
      native.finalVisibleMessage?.signalId ?? null,
      ["nativeDeliveryTrace", "finalVisibleMessageLinkage", "selectedSignalId"],
      "native linkage must identify the visible message"
    );
  }
  const outcome = projectSpaceNativeDeliveryTraceFinalVisibleOutcome(native);
  for (const key of Object.keys(outcome) as Array<keyof typeof outcome>) {
    if (native.finalVisibleOutcome[key] !== outcome[key]) {
      context.addIssue({
        code: "custom",
        path: ["nativeDeliveryTrace", "finalVisibleOutcome", key],
        message: "native visible outcome must come from the visible message",
      });
    }
  }
}

export const spaceDispatchTraceResponseSchema = z
  .strictObject({
    correlation: observabilityWakeCorrelationSchema,
    query: spaceDispatchTraceQuerySchema,
    serviceConnectionDiagnostics:
      serviceConnectionTraceDiagnosticsSchema.optional(),
    remoteAgentRuntimeDiagnostics:
      remoteAgentWorkerRuntimeDiagnosticsResponseSchema.optional(),
    nativeDeliveryTrace: spaceNativeDeliveryTraceSchema.optional(),
    trace: z.union([spaceDispatchTraceSnapshotSchema, z.null()]),
  })
  .superRefine((value, context) => {
    expectTraceEvidence(
      context,
      value.correlation.selector.kind,
      "dispatch",
      ["correlation", "selector", "kind"],
      "trace response correlation selector must be dispatch"
    );
    expectTraceEvidence(
      context,
      value.correlation.spaceId,
      value.query.spaceId,
      ["correlation", "spaceId"],
      "correlation.spaceId must match query.spaceId"
    );
    expectTraceEvidence(
      context,
      value.correlation.dispatchId,
      value.query.dispatchId,
      ["correlation", "dispatchId"],
      "correlation.dispatchId must match query.dispatchId"
    );

    if (value.nativeDeliveryTrace) {
      validateSpaceNativeDeliveryTraceResponse(value, context);
      return;
    }
    if (value.trace === null) {
      expectNullTraceEvidence(context, value.correlation.clientMessageId, [
        "correlation",
        "clientMessageId",
      ]);
      expectNullTraceEvidence(context, value.correlation.sourceSignalId, [
        "correlation",
        "sourceSignalId",
      ]);
      expectNullTraceEvidence(context, value.correlation.targetProfileId, [
        "correlation",
        "targetProfileId",
      ]);
      expectNullTraceEvidence(context, value.correlation.latestAttemptId, [
        "correlation",
        "latestAttemptId",
      ]);
      expectNullTraceEvidence(
        context,
        value.correlation.runtimeCoordinatorExecutionId,
        ["correlation", "runtimeCoordinatorExecutionId"]
      );
      expectNullTraceEvidence(context, value.correlation.claimLeaseId, [
        "correlation",
        "claimLeaseId",
      ]);
      expectNullTraceEvidence(context, value.correlation.bindingId, [
        "correlation",
        "bindingId",
      ]);
      expectNullTraceEvidence(
        context,
        value.correlation.openMeldServiceRuntimeId,
        ["correlation", "openMeldServiceRuntimeId"]
      );
      expectNullTraceEvidence(context, value.correlation.agentControllerRef, [
        "correlation",
        "agentControllerRef",
      ]);
      expectNullTraceEvidence(context, value.correlation.resultRef, [
        "correlation",
        "resultRef",
      ]);
      expectNullTraceEvidence(context, value.correlation.publishedSignalId, [
        "correlation",
        "publishedSignalId",
      ]);
      expectNullTraceEvidence(context, value.correlation.replySignalId, [
        "correlation",
        "replySignalId",
      ]);
      return;
    }

    expectTraceEvidence(
      context,
      value.trace.dispatch.dispatchId,
      value.query.dispatchId,
      ["trace", "dispatch", "dispatchId"],
      "trace.dispatch.dispatchId must match query.dispatchId"
    );
    expectTraceEvidence(
      context,
      value.correlation.clientMessageId,
      value.trace.dispatch.sourceClientMessageId,
      ["correlation", "clientMessageId"],
      "correlation.clientMessageId must match trace.dispatch.sourceClientMessageId"
    );
    expectTraceEvidence(
      context,
      value.correlation.sourceSignalId,
      value.trace.dispatch.sourceEventId,
      ["correlation", "sourceSignalId"],
      "correlation.sourceSignalId must match trace.dispatch.sourceEventId"
    );
    expectTraceEvidence(
      context,
      value.correlation.targetProfileId,
      value.trace.dispatch.targetProfileId,
      ["correlation", "targetProfileId"],
      "correlation.targetProfileId must match trace.dispatch.targetProfileId"
    );
    expectTraceEvidence(
      context,
      value.correlation.latestAttemptId,
      value.trace.latestAttempt?.attemptId ??
        value.trace.dispatch.latestAttemptId,
      ["correlation", "latestAttemptId"],
      "correlation.latestAttemptId must match latest attempt evidence"
    );
    expectTraceEvidence(
      context,
      value.correlation.runtimeCoordinatorExecutionId,
      value.trace.runtimeCoordinatorExecution?.runtimeCoordinatorExecutionId ??
        null,
      ["correlation", "runtimeCoordinatorExecutionId"],
      "correlation.runtimeCoordinatorExecutionId must match trace.runtimeCoordinatorExecution.runtimeCoordinatorExecutionId"
    );
    expectTraceEvidence(
      context,
      value.correlation.claimLeaseId,
      value.trace.claimLease?.claimLeaseId ?? null,
      ["correlation", "claimLeaseId"],
      "correlation.claimLeaseId must match trace.claimLease.claimLeaseId"
    );
    expectTraceEvidence(
      context,
      value.correlation.bindingId,
      value.trace.runtimeCoordinatorExecution?.bindingId ??
        value.trace.executionIdentity?.core.bindingId ??
        value.trace.nativeDelivery?.bindingId ??
        value.trace.claimLease?.bindingId ??
        null,
      ["correlation", "bindingId"],
      "correlation.bindingId must match trace execution identity evidence"
    );
    expectTraceEvidence(
      context,
      value.correlation.openMeldServiceRuntimeId,
      value.trace.runtimeCoordinatorExecution?.openMeldServiceRuntimeId.value ??
        value.trace.executionIdentity?.core.openMeldServiceRuntimeId.value ??
        value.trace.claimLease?.openMeldServiceRuntimeId ??
        null,
      ["correlation", "openMeldServiceRuntimeId"],
      "correlation.openMeldServiceRuntimeId must match trace execution identity evidence"
    );
    expectTraceEvidence(
      context,
      value.correlation.agentControllerRef,
      value.trace.runtimeCoordinatorExecution?.agentControllerRef ??
        value.trace.executionIdentity?.core.agentControllerRef ??
        value.trace.nativeDelivery?.controllerNormalization
          .canonicalAgentControllerRef ??
        value.trace.claimLease?.agentControllerRef ??
        null,
      ["correlation", "agentControllerRef"],
      "correlation.agentControllerRef must match trace execution identity evidence"
    );
    expectTraceEvidence(
      context,
      value.correlation.resultRef,
      value.trace.result?.resultRef ?? null,
      ["correlation", "resultRef"],
      "correlation.resultRef must match trace.result.resultRef"
    );
    expectTraceEvidence(
      context,
      value.correlation.publishedSignalId,
      value.trace.result?.publishedSignalId ?? null,
      ["correlation", "publishedSignalId"],
      "correlation.publishedSignalId must match trace.result.publishedSignalId"
    );
    expectTraceEvidence(
      context,
      value.correlation.replySignalId,
      value.trace.replySignal?.signalId ?? null,
      ["correlation", "replySignalId"],
      "correlation.replySignalId must match trace.replySignal.signalId"
    );
    expectFinalVisibleMessageTraceEvidence(context, value.trace);

    expectLatestAttemptTraceEvidence(context, value.trace);
    expectNativeDeliveryTraceEvidence(context, {
      query: value.query,
      trace: value.trace,
    });
    if (value.trace.claimLease) {
      expectTraceEvidence(
        context,
        value.trace.claimLease.dispatchId,
        value.trace.dispatch.dispatchId,
        ["trace", "claimLease", "dispatchId"],
        "trace.claimLease.dispatchId must match trace.dispatch.dispatchId"
      );
      expectTraceEvidence(
        context,
        value.trace.claimLease.sourceEventId,
        value.trace.dispatch.sourceEventId,
        ["trace", "claimLease", "sourceEventId"],
        "trace.claimLease.sourceEventId must match trace.dispatch.sourceEventId"
      );
      expectTraceEvidence(
        context,
        value.trace.claimLease.sourceClientMessageId,
        value.trace.dispatch.sourceClientMessageId,
        ["trace", "claimLease", "sourceClientMessageId"],
        "trace.claimLease.sourceClientMessageId must match trace.dispatch.sourceClientMessageId"
      );
      expectTraceEvidence(
        context,
        value.trace.claimLease.targetProfileId,
        value.trace.dispatch.targetProfileId,
        ["trace", "claimLease", "targetProfileId"],
        "trace.claimLease.targetProfileId must match trace.dispatch.targetProfileId"
      );
    }
    if (value.trace.executionIdentity) {
      expectTraceEvidence(
        context,
        value.trace.executionIdentity.core.spaceId,
        value.query.spaceId,
        ["trace", "executionIdentity", "core", "spaceId"],
        "trace.executionIdentity.core.spaceId must match query.spaceId"
      );
      expectTraceEvidence(
        context,
        value.trace.executionIdentity.core.dispatchId,
        value.trace.dispatch.dispatchId,
        ["trace", "executionIdentity", "core", "dispatchId"],
        "trace.executionIdentity.core.dispatchId must match trace.dispatch.dispatchId"
      );
      expectTraceEvidence(
        context,
        value.trace.executionIdentity.core.targetProfileId,
        value.trace.dispatch.targetProfileId,
        ["trace", "executionIdentity", "core", "targetProfileId"],
        "trace.executionIdentity.core.targetProfileId must match trace.dispatch.targetProfileId"
      );
    }
    if (value.trace.runtimeCoordinatorExecution) {
      expectTraceEvidence(
        context,
        value.trace.runtimeCoordinatorExecution.spaceId,
        value.query.spaceId,
        ["trace", "runtimeCoordinatorExecution", "spaceId"],
        "trace.runtimeCoordinatorExecution.spaceId must match query.spaceId"
      );
      expectTraceEvidence(
        context,
        value.trace.runtimeCoordinatorExecution.dispatchId,
        value.trace.dispatch.dispatchId,
        ["trace", "runtimeCoordinatorExecution", "dispatchId"],
        "trace.runtimeCoordinatorExecution.dispatchId must match trace.dispatch.dispatchId"
      );
      expectTraceEvidence(
        context,
        value.trace.runtimeCoordinatorExecution.targetProfileId,
        value.trace.dispatch.targetProfileId,
        ["trace", "runtimeCoordinatorExecution", "targetProfileId"],
        "trace.runtimeCoordinatorExecution.targetProfileId must match trace.dispatch.targetProfileId"
      );
    }
    expectRuntimeCoordinatorHeadLifecycleTraceEvidence(context, {
      query: value.query,
      trace: value.trace,
    });
    for (const diagnostic of value.trace
      .runtimeCoordinatorCreationDiagnostics) {
      expectTraceEvidence(
        context,
        diagnostic.spaceId,
        value.query.spaceId,
        ["trace", "runtimeCoordinatorCreationDiagnostics"],
        "trace.runtimeCoordinatorCreationDiagnostics.spaceId must match query.spaceId"
      );
      expectTraceEvidence(
        context,
        diagnostic.dispatchId,
        value.trace.dispatch.dispatchId,
        ["trace", "runtimeCoordinatorCreationDiagnostics"],
        "trace.runtimeCoordinatorCreationDiagnostics.dispatchId must match trace.dispatch.dispatchId"
      );
      expectTraceEvidence(
        context,
        diagnostic.targetProfileId,
        value.trace.dispatch.targetProfileId,
        ["trace", "runtimeCoordinatorCreationDiagnostics"],
        "trace.runtimeCoordinatorCreationDiagnostics.targetProfileId must match trace.dispatch.targetProfileId"
      );
    }
    for (const event of value.trace.runtimeCoordinatorEvents) {
      expectTraceEvidence(
        context,
        event.runtimeCoordinatorExecutionId,
        value.trace.runtimeCoordinatorExecution
          ?.runtimeCoordinatorExecutionId ?? null,
        ["trace", "runtimeCoordinatorEvents"],
        "trace.runtimeCoordinatorEvents.runtimeCoordinatorExecutionId must match trace.runtimeCoordinatorExecution.runtimeCoordinatorExecutionId"
      );
    }
    if (value.trace.result) {
      expectTraceEvidence(
        context,
        value.trace.result.dispatchId,
        value.trace.dispatch.dispatchId,
        ["trace", "result", "dispatchId"],
        "trace.result.dispatchId must match trace.dispatch.dispatchId"
      );
    }
    if (value.trace.resultInbox) {
      expectTraceEvidence(
        context,
        value.trace.resultInbox.dispatchId,
        value.trace.dispatch.dispatchId,
        ["trace", "resultInbox", "dispatchId"],
        "trace.resultInbox.dispatchId must match trace.dispatch.dispatchId"
      );
      expectTraceEvidence(
        context,
        value.trace.resultInbox.targetProfileId,
        value.trace.dispatch.targetProfileId,
        ["trace", "resultInbox", "targetProfileId"],
        "trace.resultInbox.targetProfileId must match trace.dispatch.targetProfileId"
      );
      expectTraceEvidence(
        context,
        value.trace.resultInbox.attemptId,
        value.trace.latestAttempt?.attemptId ??
          value.trace.dispatch.latestAttemptId,
        ["trace", "resultInbox", "attemptId"],
        "trace.resultInbox.attemptId must match latest attempt evidence"
      );
    }
  });

export const spaceDispatchTraceResponseV1Schema =
  spaceDispatchTraceResponseSchema.safeExtend({
    trace: z.union([spaceDispatchTraceSnapshotV1Schema, z.null()]),
  });

export const spaceDispatchTraceResponseV2Schema =
  spaceDispatchTraceResponseSchema.safeExtend({
    trace: z.union([spaceDispatchTraceSnapshotV2Schema, z.null()]),
  });

type SpaceDispatchTraceSnapshotValue = zod.infer<
  typeof spaceDispatchTraceSnapshotSchema
>;
type SpaceDispatchTraceFinalVisibleOutcomeValue = zod.infer<
  typeof spaceDispatchTraceFinalVisibleOutcomeSchema
>;

export type SpaceDispatchTraceRootCauseProjection = {
  reasonCode: string;
  source:
    | "dispatch"
    | "final_visible_outcome"
    | "final_visible_message"
    | "latest_attempt"
    | "reply_lookup"
    | "result_inbox"
    | "runtime"
    | "runtime_coordinator";
};

const FINAL_VISIBLE_OUTCOME_PUBLICATION_PENDING_REASON_CODE =
  "final_visible_outcome.publication_pending";
const FINAL_VISIBLE_OUTCOME_PUBLICATION_RETRYING_REASON_CODE =
  "final_visible_outcome.publication_retrying";
const FINAL_VISIBLE_OUTCOME_PUBLICATION_UNRESOLVED_REASON_CODE =
  "final_visible_outcome.publication_unresolved";
const RUNTIME_COORDINATOR_PUBLICATION_UNRESOLVED_REASON_CODE =
  "runtime_coordinator.publication_unresolved";
const RUNTIME_COORDINATOR_DELIVERY_EXPIRED_REASON_CODE =
  "runtime_coordinator.delivery_expired";

type SpaceDispatchTraceFinalVisibleSignalCandidateInput = Pick<
  SpaceDispatchTraceSnapshotValue,
  "result" | "resultInbox" | "runtimeCoordinatorHeadLifecycle"
> & {
  runtimeCoordinatorEvents: readonly SpaceDispatchTraceSnapshotValue["runtimeCoordinatorEvents"][number][];
};

export function listSpaceDispatchTraceFinalVisibleSignalCandidates(
  trace: SpaceDispatchTraceFinalVisibleSignalCandidateInput
): string[] {
  const candidates: string[] = [];
  addRuntimeCoordinatorStoppedNoticeSignalCandidates(
    candidates,
    trace.runtimeCoordinatorEvents
  );
  addFinalVisibleSignalCandidate(
    candidates,
    trace.runtimeCoordinatorHeadLifecycle?.readStatus === "found"
      ? trace.runtimeCoordinatorHeadLifecycle.publicationOutcome
          ?.publishedSignalId
      : null
  );
  addFinalVisibleSignalCandidate(candidates, trace.result?.publishedSignalId);
  addFinalVisibleSignalCandidate(
    candidates,
    trace.resultInbox?.publishedSignalId
  );
  return candidates;
}

function addRuntimeCoordinatorStoppedNoticeSignalCandidates(
  candidates: string[],
  events: readonly SpaceDispatchTraceSnapshotValue["runtimeCoordinatorEvents"][number][]
): void {
  for (const event of events) {
    if (event.eventType !== "cancellation_control_accepted") {
      continue;
    }
    const payload = parseRuntimeCoordinatorEventPayload(event);
    const stoppedNoticePublication = readPayloadObject(
      payload,
      "stoppedNoticePublication"
    );
    addFinalVisibleSignalCandidate(
      candidates,
      readPayloadString(stoppedNoticePublication, "publishedSignalId")
    );
  }
}

function addFinalVisibleSignalCandidate(
  candidates: string[],
  value: string | null | undefined
): void {
  const normalized = normalizeOptionalTraceText(value);
  if (normalized && !candidates.includes(normalized)) {
    candidates.push(normalized);
  }
}

function normalizeOptionalTraceText(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

export function projectSpaceDispatchTraceFinalVisibleOutcome(
  trace: SpaceDispatchTraceSnapshotValue
): SpaceDispatchTraceFinalVisibleOutcomeValue {
  return (
    resolveFinalVisibleMessageOutcome(trace) ??
    resolvePublicationBlockerOutcome(trace) ??
    resolveHeadPublicationExhaustionOutcome(trace) ??
    resolveHeadPublicationOutcome(trace) ??
    resolveResultPublicationOutcome(trace) ??
    resolveRuntimeCoordinatorExecutionPublicationOutcome(trace) ??
    resolveHeadPublicationIntentOutcome(trace) ??
    createNotApplicableFinalVisibleOutcome()
  );
}

export function projectSpaceNativeDeliveryTraceFinalVisibleOutcome(
  trace: Pick<SpaceDispatchTraceSnapshotValue, "finalVisibleMessage">
): SpaceDispatchTraceFinalVisibleOutcomeValue {
  return (
    resolveFinalVisibleMessageOutcome(trace) ??
    createNotApplicableFinalVisibleOutcome()
  );
}

function resolveFinalVisibleMessageOutcome(
  trace: Pick<SpaceDispatchTraceSnapshotValue, "finalVisibleMessage">
): SpaceDispatchTraceFinalVisibleOutcomeValue | null {
  const finalVisibleMessage = trace.finalVisibleMessage ?? null;
  if (!finalVisibleMessage) {
    return null;
  }
  const visibleStopped = isStoppedFinalVisibleMessage(finalVisibleMessage);
  const visibleFailure =
    isFailureFinalVisibleSystemNotice(finalVisibleMessage) ||
    isFailureFinalVisibleTextMessage(finalVisibleMessage);
  let publicationKind: SpaceDispatchTraceFinalVisibleOutcomeValue["publicationKind"] =
    "success_reply";
  let status: SpaceDispatchTraceFinalVisibleOutcomeValue["status"] =
    "visible_reply";
  if (visibleStopped) {
    publicationKind = "stopped_notice";
    status = "visible_stopped";
  } else if (visibleFailure) {
    publicationKind = "failure_notice";
    status = "visible_failure";
  }
  return {
    delivered: true,
    publicationErrorCode: null,
    publicationKind,
    reasonCode: resolveFinalVisibleMessageOutcomeReasonCode(
      finalVisibleMessage,
      visibleStopped,
      visibleFailure
    ),
    signalId: finalVisibleMessage.signalId,
    sourceFact: "final_visible_message",
    sourceReasonCode: finalVisibleMessage.reasonCode,
    sourceStatus: finalVisibleMessage.signalType,
    status,
  };
}

function isStoppedFinalVisibleMessage(
  finalVisibleMessage: NonNullable<
    SpaceDispatchTraceSnapshotValue["finalVisibleMessage"]
  >
): boolean {
  return (
    (finalVisibleMessage.signalType === "signal.system_notice" &&
      finalVisibleMessage.noticeType === "wake_stopped") ||
    (finalVisibleMessage.signalType === "signal.text" &&
      finalVisibleMessage.reasonCode === "remote_agent.execution_cancelled")
  );
}

function isFailureFinalVisibleSystemNotice(
  finalVisibleMessage: NonNullable<
    SpaceDispatchTraceSnapshotValue["finalVisibleMessage"]
  >
): boolean {
  return (
    finalVisibleMessage.signalType === "signal.system_notice" &&
    (finalVisibleMessage.noticeType === "terminal_failure" ||
      finalVisibleMessage.noticeType === "policy_blocked")
  );
}

function isFailureFinalVisibleTextMessage(
  finalVisibleMessage: NonNullable<
    SpaceDispatchTraceSnapshotValue["finalVisibleMessage"]
  >
): boolean {
  return (
    finalVisibleMessage.signalType === "signal.text" &&
    finalVisibleMessage.reasonCode !== null
  );
}

function resolveFinalVisibleMessageOutcomeReasonCode(
  finalVisibleMessage: NonNullable<
    SpaceDispatchTraceSnapshotValue["finalVisibleMessage"]
  >,
  visibleStopped: boolean,
  visibleFailure: boolean
): string {
  if (visibleStopped) {
    return (
      finalVisibleMessage.reasonCode ?? "space.wake_stopped_notice_published"
    );
  }
  if (!visibleFailure) {
    return finalVisibleMessage.noticeType === "stay_silent"
      ? "space.stay_silent_notice_published"
      : "reply.delivered";
  }

  if (finalVisibleMessage.reasonCode) {
    return finalVisibleMessage.reasonCode;
  }

  return finalVisibleMessage.noticeType === "policy_blocked"
    ? "space.policy_blocked_notice_published"
    : "space.terminal_failure_notice_published";
}

function resolvePublicationBlockerOutcome(
  trace: SpaceDispatchTraceSnapshotValue
): SpaceDispatchTraceFinalVisibleOutcomeValue | null {
  const publicationBlocker =
    resolveRuntimeCoordinatorPublicationUnresolvedBlocker(trace);
  return publicationBlocker
    ? {
        delivered: false,
        publicationErrorCode: null,
        publicationKind: publicationBlocker.publicationKind,
        reasonCode: FINAL_VISIBLE_OUTCOME_PUBLICATION_UNRESOLVED_REASON_CODE,
        signalId: null,
        sourceFact: "runtime_coordinator_event",
        sourceReasonCode: publicationBlocker.reasonCode,
        sourceStatus: publicationBlocker.status,
        status: "publication_unresolved",
      }
    : null;
}

function resolveHeadPublicationExhaustionOutcome(
  trace: SpaceDispatchTraceSnapshotValue
): SpaceDispatchTraceFinalVisibleOutcomeValue | null {
  const headPublicationExhaustion =
    trace.runtimeCoordinatorHeadLifecycle?.readStatus === "found"
      ? (trace.runtimeCoordinatorHeadLifecycle.publicationExhaustion ?? null)
      : null;
  if (!headPublicationExhaustion) {
    return null;
  }
  return {
    delivered: false,
    publicationErrorCode: null,
    publicationKind: "failure_notice",
    reasonCode: FINAL_VISIBLE_OUTCOME_PUBLICATION_UNRESOLVED_REASON_CODE,
    signalId: null,
    sourceFact: "runtime_coordinator_head_lifecycle",
    sourceReasonCode: headPublicationExhaustion.reasonCode,
    sourceStatus: headPublicationExhaustion.status,
    status: "publication_unresolved",
  };
}

function resolveHeadPublicationOutcome(
  trace: SpaceDispatchTraceSnapshotValue
): SpaceDispatchTraceFinalVisibleOutcomeValue | null {
  const headPublicationOutcome =
    trace.runtimeCoordinatorHeadLifecycle?.readStatus === "found"
      ? (trace.runtimeCoordinatorHeadLifecycle.publicationOutcome ?? null)
      : null;
  if (!headPublicationOutcome) {
    return null;
  }

  if (headPublicationOutcome?.status === "failure_publication_failed") {
    return {
      delivered: false,
      publicationErrorCode: headPublicationOutcome.publicationErrorCode,
      publicationKind: "failure_notice",
      reasonCode: FINAL_VISIBLE_OUTCOME_PUBLICATION_RETRYING_REASON_CODE,
      signalId: headPublicationOutcome.publishedSignalId,
      sourceFact: "runtime_coordinator_head_lifecycle",
      sourceReasonCode:
        headPublicationOutcome.publicationErrorCode ??
        "runtime_coordinator.failure_publication_failed",
      sourceStatus: headPublicationOutcome.status,
      status: "publication_retrying",
    };
  }
  return {
    delivered: false,
    publicationErrorCode: headPublicationOutcome.publicationErrorCode,
    publicationKind:
      headPublicationOutcome.finalMessageKind === "success_reply"
        ? "success_reply"
        : "failure_notice",
    reasonCode: FINAL_VISIBLE_OUTCOME_PUBLICATION_UNRESOLVED_REASON_CODE,
    signalId: headPublicationOutcome.publishedSignalId,
    sourceFact: "runtime_coordinator_head_lifecycle",
    sourceReasonCode:
      headPublicationOutcome.publicationErrorCode ?? "reply.not_found",
    sourceStatus: headPublicationOutcome.status,
    status: "publication_unresolved",
  };
}

function resolveResultPublicationOutcome(
  trace: SpaceDispatchTraceSnapshotValue
): SpaceDispatchTraceFinalVisibleOutcomeValue | null {
  if (hasRuntimeCoordinatorPreResultAuthority(trace)) {
    return null;
  }
  const resultInbox = trace.resultInbox;
  if (resultInbox?.publishState === "reply_publication_failed") {
    return {
      delivered: false,
      publicationErrorCode: resultInbox.publicationErrorCode,
      publicationKind: "success_reply",
      reasonCode: FINAL_VISIBLE_OUTCOME_PUBLICATION_RETRYING_REASON_CODE,
      signalId: resultInbox.publishedSignalId,
      sourceFact: "result_inbox",
      sourceReasonCode:
        resultInbox.publicationErrorCode ?? "reply.publication_failed",
      sourceStatus: resultInbox.publishState,
      status: "publication_retrying",
    };
  }
  if (
    resultInbox?.publishState === "reply_published" ||
    trace.result?.publishedSignalId
  ) {
    return {
      delivered: false,
      publicationErrorCode: resultInbox?.publicationErrorCode ?? null,
      publicationKind: "success_reply",
      reasonCode: FINAL_VISIBLE_OUTCOME_PUBLICATION_UNRESOLVED_REASON_CODE,
      signalId:
        trace.result?.publishedSignalId ??
        resultInbox?.publishedSignalId ??
        null,
      sourceFact: trace.result?.publishedSignalId
        ? "dispatch_result"
        : "result_inbox",
      sourceReasonCode: "reply.not_found",
      sourceStatus:
        resultInbox?.publishState ??
        (trace.result?.publishedSignalId ? "published_signal_missing" : null),
      status: "publication_unresolved",
    };
  }
  return null;
}

function resolveRuntimeCoordinatorExecutionPublicationOutcome(
  trace: SpaceDispatchTraceSnapshotValue
): SpaceDispatchTraceFinalVisibleOutcomeValue | null {
  const runtimeCoordinatorExecution = trace.runtimeCoordinatorExecution;
  const runtimeCoordinatorReason =
    runtimeCoordinatorExecution?.terminalOutcome?.reasonCode ?? null;
  const publicationFailureEvent = trace.runtimeCoordinatorEvents
    .filter(
      (event) =>
        event.eventType === "reply_publication_failed" &&
        event.runtimeCoordinatorExecutionId ===
          runtimeCoordinatorExecution?.runtimeCoordinatorExecutionId
    )
    .at(-1);
  if (
    runtimeCoordinatorExecution?.status === "failed_retryable" &&
    publicationFailureEvent
  ) {
    const publicationReason =
      publicationFailureEvent.reasonCode ?? runtimeCoordinatorReason;
    return {
      delivered: false,
      publicationErrorCode: publicationReason,
      publicationKind: "success_reply",
      reasonCode: FINAL_VISIBLE_OUTCOME_PUBLICATION_RETRYING_REASON_CODE,
      signalId: null,
      sourceFact: "runtime_coordinator_execution",
      sourceReasonCode: publicationReason,
      sourceStatus: runtimeCoordinatorExecution.status,
      status: "publication_retrying",
    };
  }
  if (
    runtimeCoordinatorExecution?.status === "failed_terminal" &&
    runtimeCoordinatorReason ===
      RUNTIME_COORDINATOR_DELIVERY_EXPIRED_REASON_CODE
  ) {
    return {
      delivered: false,
      publicationErrorCode: null,
      publicationKind: "failure_notice",
      reasonCode: FINAL_VISIBLE_OUTCOME_PUBLICATION_UNRESOLVED_REASON_CODE,
      signalId: null,
      sourceFact: "runtime_coordinator_execution",
      sourceReasonCode: runtimeCoordinatorReason,
      sourceStatus: runtimeCoordinatorExecution.status,
      status: "publication_unresolved",
    };
  }
  if (runtimeCoordinatorExecution?.status === "reply_published") {
    return {
      delivered: false,
      publicationErrorCode: null,
      publicationKind: "success_reply",
      reasonCode: FINAL_VISIBLE_OUTCOME_PUBLICATION_UNRESOLVED_REASON_CODE,
      signalId: null,
      sourceFact: "runtime_coordinator_execution",
      sourceReasonCode: "reply.not_found",
      sourceStatus: runtimeCoordinatorExecution.status,
      status: "publication_unresolved",
    };
  }
  if (runtimeCoordinatorExecution?.status === "cancelled") {
    return {
      delivered: false,
      publicationErrorCode: null,
      publicationKind: "stopped_notice",
      reasonCode: FINAL_VISIBLE_OUTCOME_PUBLICATION_UNRESOLVED_REASON_CODE,
      signalId: null,
      sourceFact: "runtime_coordinator_execution",
      sourceReasonCode:
        runtimeCoordinatorReason ?? "space.wake_stopped_notice_missing",
      sourceStatus: runtimeCoordinatorExecution.status,
      status: "publication_unresolved",
    };
  }
  return null;
}

function resolveHeadPublicationIntentOutcome(
  trace: SpaceDispatchTraceSnapshotValue
): SpaceDispatchTraceFinalVisibleOutcomeValue | null {
  const headLifecycle = trace.runtimeCoordinatorHeadLifecycle;
  if (
    headLifecycle?.readStatus !== "found" ||
    !headLifecycle.publicationIntent
  ) {
    return null;
  }
  return {
    delivered: false,
    publicationErrorCode: null,
    publicationKind:
      headLifecycle.publicationIntent.kind === "stopped_notice"
        ? "stopped_notice"
        : "failure_notice",
    reasonCode: FINAL_VISIBLE_OUTCOME_PUBLICATION_PENDING_REASON_CODE,
    signalId: null,
    sourceFact: "runtime_coordinator_head_lifecycle",
    sourceReasonCode: headLifecycle.publicationIntent.reasonCode,
    sourceStatus: headLifecycle.publicationIntent.status,
    status: "publication_pending",
  };
}

function createNotApplicableFinalVisibleOutcome(): SpaceDispatchTraceFinalVisibleOutcomeValue {
  return {
    delivered: false,
    publicationErrorCode: null,
    publicationKind: null,
    reasonCode: null,
    signalId: null,
    sourceFact: "none",
    sourceReasonCode: null,
    sourceStatus: null,
    status: "not_applicable",
  };
}

export function projectSpaceDispatchTraceRootCause(
  trace: SpaceDispatchTraceSnapshotValue
): SpaceDispatchTraceRootCauseProjection {
  const finalVisibleOutcomeRootCause =
    resolveFinalVisibleOutcomeRootCause(trace);
  if (finalVisibleOutcomeRootCause) {
    return finalVisibleOutcomeRootCause;
  }

  const legacyResultInboxRootCause = resolveLegacyResultInboxRootCause(trace);
  if (legacyResultInboxRootCause) {
    return legacyResultInboxRootCause;
  }

  const headLifecycleRootCause =
    resolveRuntimeCoordinatorHeadLifecycleRootCause(trace);
  if (headLifecycleRootCause) {
    return headLifecycleRootCause;
  }

  const runtimeCoordinatorCreationFailure =
    resolveRuntimeCoordinatorCreationRootCause(trace);
  if (runtimeCoordinatorCreationFailure) {
    return runtimeCoordinatorCreationFailure;
  }

  const runtimeProgressStale = resolveRuntimeProgressStaleRootCause(trace);
  if (runtimeProgressStale) {
    return runtimeProgressStale;
  }

  const runtimeCoordinatorRootCause =
    resolveRuntimeCoordinatorExecutionRootCause(trace);
  if (runtimeCoordinatorRootCause) {
    return runtimeCoordinatorRootCause;
  }

  const attemptErrorRootCause = resolveLatestAttemptErrorRootCause(trace);
  if (attemptErrorRootCause) {
    return attemptErrorRootCause;
  }

  if (trace.result?.publishedSignalId) {
    return { reasonCode: "reply.not_found", source: "reply_lookup" };
  }

  if (trace.dispatch.status === "succeeded") {
    return { reasonCode: "dispatch.succeeded", source: "dispatch" };
  }
  if (trace.execution?.progressEvidenceState === "stalled") {
    return { reasonCode: "daemon.execution_stalled", source: "runtime" };
  }
  if (trace.runtime?.timeoutTriggeredAt) {
    return { reasonCode: "runtime.timeout", source: "runtime" };
  }
  if (trace.latestAttempt?.status) {
    return {
      reasonCode: `attempt.${trace.latestAttempt.status}`,
      source: "latest_attempt",
    };
  }
  return {
    reasonCode: `dispatch.${trace.dispatch.status}`,
    source: "dispatch",
  };
}

export function resolveSpaceDispatchTraceRootCause(
  trace: SpaceDispatchTraceSnapshotValue
): string {
  return projectSpaceDispatchTraceRootCause(trace).reasonCode;
}

function resolveFinalVisibleOutcomeRootCause(
  trace: SpaceDispatchTraceSnapshotValue
): SpaceDispatchTraceRootCauseProjection | null {
  const finalVisibleOutcome =
    projectSpaceDispatchTraceFinalVisibleOutcome(trace);
  switch (finalVisibleOutcome.status) {
    case "visible_reply":
      return {
        reasonCode: finalVisibleOutcome.reasonCode ?? "reply.delivered",
        source: "final_visible_message",
      };
    case "visible_failure":
      return {
        reasonCode:
          finalVisibleOutcome.reasonCode ??
          "space.terminal_failure_notice_published",
        source: "final_visible_message",
      };
    case "visible_stopped":
      return {
        reasonCode:
          finalVisibleOutcome.reasonCode ??
          "space.wake_stopped_notice_published",
        source: "final_visible_message",
      };
    case "publication_pending":
    case "publication_retrying":
      return {
        reasonCode:
          finalVisibleOutcome.reasonCode ??
          FINAL_VISIBLE_OUTCOME_PUBLICATION_UNRESOLVED_REASON_CODE,
        source: "final_visible_outcome",
      };
    case "publication_unresolved":
      return (
        resolveFinalVisibleMessageLinkageRootCause(
          trace,
          finalVisibleOutcome
        ) ?? {
          reasonCode:
            finalVisibleOutcome.reasonCode ??
            FINAL_VISIBLE_OUTCOME_PUBLICATION_UNRESOLVED_REASON_CODE,
          source: "final_visible_outcome",
        }
      );
    case "not_applicable":
      return resolveFinalVisibleMessageLinkageRootCause(
        trace,
        finalVisibleOutcome
      );
    default:
      return assertNever(finalVisibleOutcome.status);
  }
}

function resolveFinalVisibleMessageLinkageRootCause(
  trace: SpaceDispatchTraceSnapshotValue,
  finalVisibleOutcome: SpaceDispatchTraceFinalVisibleOutcomeValue
): SpaceDispatchTraceRootCauseProjection | null {
  const linkage = trace.finalVisibleMessageLinkage ?? null;
  if (
    !linkage ||
    linkage.status === "matched_published_signal" ||
    linkage.status === "matched_final_reply_claim" ||
    linkage.status === "projection_pending"
  ) {
    return null;
  }

  if (isAuthoritativePublicationUnresolved(finalVisibleOutcome)) {
    return null;
  }

  if (
    linkage.status === "linkage_missing" ||
    linkage.status === "storage_inconsistent"
  ) {
    return {
      reasonCode:
        linkage.reasonCode ?? `final_visible_message.${linkage.status}`,
      source: "final_visible_message",
    };
  }

  return null;
}

function isAuthoritativePublicationUnresolved(
  finalVisibleOutcome: SpaceDispatchTraceFinalVisibleOutcomeValue
): boolean {
  return (
    finalVisibleOutcome.status === "publication_unresolved" &&
    (finalVisibleOutcome.sourceFact === "runtime_coordinator_event" ||
      (finalVisibleOutcome.sourceFact ===
        "runtime_coordinator_head_lifecycle" &&
        finalVisibleOutcome.signalId === null))
  );
}

function resolveLegacyResultInboxRootCause(
  trace: SpaceDispatchTraceSnapshotValue
): SpaceDispatchTraceRootCauseProjection | null {
  if (hasRuntimeCoordinatorPreResultAuthority(trace)) {
    return null;
  }
  if (trace.resultInbox?.publishState === "late_result_available") {
    return {
      reasonCode: "runtime_coordinator.late_result_available",
      source: "result_inbox",
    };
  }
  if (trace.resultInbox?.publishState === "reply_publication_failed") {
    return { reasonCode: "reply.publication_failed", source: "result_inbox" };
  }
  if (trace.resultInbox?.publishState === "invalid_space_action") {
    return {
      reasonCode: "reply.invalid_space_action",
      source: "result_inbox",
    };
  }
  return null;
}

function resolveRuntimeProgressStaleRootCause(
  trace: SpaceDispatchTraceSnapshotValue
): SpaceDispatchTraceRootCauseProjection | null {
  if (
    hasRuntimeCoordinatorPreResultAuthority(trace) &&
    hasRuntimeCoordinatorProgressStalePolicyEvidence(trace)
  ) {
    return { reasonCode: "runtime.progress_stale", source: "runtime" };
  }
  if (
    !hasRuntimeCoordinatorPreResultAuthority(trace) &&
    trace.runtimeCoordinatorExecution
  ) {
    return null;
  }
  if (trace.execution?.progressEvidenceState === "stalled") {
    return { reasonCode: "runtime.progress_stale", source: "runtime" };
  }
  if (trace.latestAttempt?.errorCode === "daemon.delivery.execution_stalled") {
    return { reasonCode: "runtime.progress_stale", source: "runtime" };
  }
  return null;
}

function hasRuntimeCoordinatorProgressStalePolicyEvidence(
  trace: SpaceDispatchTraceSnapshotValue
): boolean {
  return trace.runtimeCoordinatorEvents.some(
    (event) =>
      event.eventType === "runtime_coordinator_decision_recorded" &&
      event.reasonCode === "runtime_coordinator.progress_stale_policy_pending"
  );
}

function resolveRuntimeCoordinatorHeadLifecycleRootCause(
  trace: SpaceDispatchTraceSnapshotValue
): SpaceDispatchTraceRootCauseProjection | null {
  if (trace.runtimeCoordinatorExecution) {
    return null;
  }
  const headLifecycle = trace.runtimeCoordinatorHeadLifecycle;
  if (!headLifecycle) {
    return null;
  }
  if (headLifecycle.readStatus === "authority_unavailable") {
    return {
      reasonCode: headLifecycle.reasonCode,
      source: "runtime_coordinator",
    };
  }
  if (headLifecycle.readStatus === "missing") {
    return {
      reasonCode: headLifecycle.reasonCode,
      source: "runtime_coordinator",
    };
  }
  return {
    reasonCode:
      headLifecycle.noExecutionDecision?.reasonCode ??
      headLifecycle.publicationIntent?.reasonCode ??
      headLifecycle.waitingBoundary?.reasonCode ??
      resolvePreExecutionNoExecutionEvidenceRootCause(trace) ??
      resolveRuntimeCoordinatorHeadStatusRootCause(headLifecycle.status),
    source: "runtime_coordinator",
  };
}

export function resolveRuntimeCoordinatorHeadStatusRootCause(
  status: string
): string {
  if (status === "queued") {
    return "runtime_coordinator.head_queued";
  }
  if (status === "accepted") {
    return "runtime_coordinator.head_accepted";
  }
  if (status === "execution_linked") {
    return "runtime_coordinator.head_execution_linked";
  }
  if (status === "waiting") {
    return "runtime_coordinator.head_waiting";
  }
  return "runtime_coordinator.head_publication_intent_ready";
}

function resolveRuntimeCoordinatorCreationRootCause(
  trace: SpaceDispatchTraceSnapshotValue
): SpaceDispatchTraceRootCauseProjection | null {
  if (
    trace.runtimeCoordinatorExecution ||
    trace.runtimeCoordinatorHeadLifecycle?.readStatus === "found" ||
    trace.runtimeCoordinatorHeadLifecycle?.readStatus ===
      "authority_unavailable" ||
    trace.runtimeCoordinatorCreationDiagnostics.length === 0
  ) {
    return null;
  }
  return {
    reasonCode:
      trace.runtimeCoordinatorCreationDiagnostics.at(-1)?.reasonCode ??
      "runtime_coordinator.execution_not_created",
    source: "runtime_coordinator",
  };
}

const PRE_EXECUTION_NO_EXECUTION_EVIDENCE_REASON_CODES = new Set([
  "local_service.identity_mismatch",
]);

function resolvePreExecutionNoExecutionEvidenceRootCause(
  trace: SpaceDispatchTraceSnapshotValue
): string | null {
  const headLifecycle = trace.runtimeCoordinatorHeadLifecycle;
  if (
    trace.runtimeCoordinatorExecution ||
    headLifecycle?.readStatus !== "found" ||
    headLifecycle.runtimeCoordinatorExecutionId ||
    headLifecycle.waitingBoundary
  ) {
    return null;
  }

  const authoritativeHeadReason =
    headLifecycle.noExecutionDecision?.reasonCode ??
    headLifecycle.publicationIntent?.reasonCode ??
    null;
  return authoritativeHeadReason &&
    PRE_EXECUTION_NO_EXECUTION_EVIDENCE_REASON_CODES.has(
      authoritativeHeadReason
    )
    ? authoritativeHeadReason
    : null;
}

function resolveRuntimeCoordinatorExecutionRootCause(
  trace: SpaceDispatchTraceSnapshotValue
): SpaceDispatchTraceRootCauseProjection | null {
  const execution = trace.runtimeCoordinatorExecution;
  if (!execution) {
    return null;
  }
  switch (execution.status) {
    case "failed_retryable":
    case "failed_terminal":
      return {
        reasonCode:
          execution.terminalOutcome?.reasonCode ??
          `runtime_coordinator.${execution.status}`,
        source: "runtime_coordinator",
      };
    case "reply_published":
    case "cancelled":
      return null;
    case "state_unknown":
      return {
        reasonCode: "runtime_coordinator.state_unknown",
        source: "runtime_coordinator",
      };
    default:
      return {
        reasonCode: `runtime_coordinator.${execution.status}`,
        source: "runtime_coordinator",
      };
  }
}

function resolveLatestAttemptErrorRootCause(
  trace: SpaceDispatchTraceSnapshotValue
): SpaceDispatchTraceRootCauseProjection | null {
  if (!trace.latestAttempt?.errorCode) {
    return null;
  }
  return {
    reasonCode:
      resolveAttemptErrorRootCause(trace.latestAttempt.errorCode) ??
      trace.latestAttempt.errorCode,
    source: "latest_attempt",
  };
}

function resolveAttemptErrorRootCause(errorCode: string): string | null {
  switch (errorCode) {
    case "daemon.delivery.execution_stalled":
      return "runtime.progress_stale";
    case "timeout":
    case "timed_out_no_output":
    case "timed_out_after_output":
      return "local_adapter.timeout";
    case "daemon.delivery.timeout":
    case "daemon.delivery.finalization_timeout":
      return "delivery.result_timeout";
    case "daemon.delivery.start_timeout":
      return "delivery.start_timeout";
    case "core.transport_restarting":
      return "runtime_transport.restarting";
    default:
      return null;
  }
}

function hasRuntimeCoordinatorPreResultAuthority(
  trace: SpaceDispatchTraceSnapshotValue
): boolean {
  switch (trace.runtimeCoordinatorExecution?.status) {
    case "created":
    case "delivery_pending":
    case "delivery_accepted":
    case "cancellation_requested":
    case "accepted_local":
    case "running":
    case "completed_local":
      return true;
    default:
      return false;
  }
}

function resolveRuntimeCoordinatorPublicationUnresolvedBlocker(
  trace: SpaceDispatchTraceSnapshotValue
): {
  publicationKind: "failure_notice" | "stopped_notice" | "success_reply";
  reasonCode: string | null;
  status: string;
} | null {
  const event = trace.runtimeCoordinatorEvents
    .filter(
      (candidate) =>
        candidate.eventType === "runtime_coordinator_decision_recorded" &&
        candidate.reasonCode ===
          RUNTIME_COORDINATOR_PUBLICATION_UNRESOLVED_REASON_CODE
    )
    .at(-1);
  if (!event) {
    return null;
  }
  const payload = parseRuntimeCoordinatorEventPayload(event);
  if (
    readPayloadString(payload, "status") !== "unresolved_publication_failure"
  ) {
    return null;
  }
  const publicationKind = readPayloadString(payload, "publicationKind");
  let parsedPublicationKind:
    | "failure_notice"
    | "stopped_notice"
    | "success_reply" = "success_reply";
  if (publicationKind === "failure_notice") {
    parsedPublicationKind = "failure_notice";
  } else if (publicationKind === "stopped_notice") {
    parsedPublicationKind = "stopped_notice";
  }
  return {
    publicationKind: parsedPublicationKind,
    reasonCode: readPayloadString(payload, "reasonCode"),
    status: "unresolved_publication_failure",
  };
}

function parseRuntimeCoordinatorEventPayload(
  event: SpaceDispatchTraceSnapshotValue["runtimeCoordinatorEvents"][number]
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(event.payloadJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readPayloadString(
  payload: Record<string, unknown> | null,
  fieldName: string
): string | null {
  const value = payload?.[fieldName];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readPayloadObject(
  payload: Record<string, unknown> | null,
  fieldName: string
): Record<string, unknown> | null {
  const value = payload?.[fieldName];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected space dispatch trace value: ${String(value)}`);
}

function expectRuntimeCoordinatorHeadLifecycleTraceEvidence(
  context: zod.RefinementCtx,
  value: {
    query: zod.infer<typeof spaceDispatchTraceQuerySchema>;
    trace: zod.infer<typeof spaceDispatchTraceSnapshotSchema>;
  }
): void {
  const headLifecycle = value.trace.runtimeCoordinatorHeadLifecycle;
  if (headLifecycle?.readStatus !== "found") {
    return;
  }
  expectTraceEvidence(
    context,
    headLifecycle.targetWakeLifecycleIdentity.spaceId,
    value.query.spaceId,
    ["trace", "runtimeCoordinatorHeadLifecycle"],
    "trace.runtimeCoordinatorHeadLifecycle.spaceId must match query.spaceId"
  );
  expectTraceEvidence(
    context,
    headLifecycle.targetWakeLifecycleIdentity.sourceSignalId,
    value.trace.dispatch.sourceEventId,
    ["trace", "runtimeCoordinatorHeadLifecycle"],
    "trace.runtimeCoordinatorHeadLifecycle.sourceSignalId must match trace.dispatch.sourceEventId"
  );
  expectTraceEvidence(
    context,
    headLifecycle.targetWakeLifecycleIdentity.targetProfileId,
    value.trace.dispatch.targetProfileId,
    ["trace", "runtimeCoordinatorHeadLifecycle"],
    "trace.runtimeCoordinatorHeadLifecycle.targetProfileId must match trace.dispatch.targetProfileId"
  );
  if (headLifecycle.runtimeCoordinatorExecutionId === null) {
    return;
  }
  expectTraceEvidence(
    context,
    headLifecycle.runtimeCoordinatorExecutionId,
    value.trace.runtimeCoordinatorExecution?.runtimeCoordinatorExecutionId ??
      null,
    ["trace", "runtimeCoordinatorHeadLifecycle"],
    "trace.runtimeCoordinatorHeadLifecycle.runtimeCoordinatorExecutionId must match trace.runtimeCoordinatorExecution"
  );
}

function expectNativeDeliveryTraceEvidence(
  context: zod.RefinementCtx,
  value: {
    query: zod.infer<typeof spaceDispatchTraceQuerySchema>;
    trace: zod.infer<typeof spaceDispatchTraceSnapshotSchema>;
  }
): void {
  const nativeDelivery = value.trace.nativeDelivery;
  if (!nativeDelivery) {
    return;
  }
  expectTraceEvidence(
    context,
    nativeDelivery.dispatchId,
    value.trace.dispatch.dispatchId,
    ["trace", "nativeDelivery", "dispatchId"],
    "trace.nativeDelivery.dispatchId must match trace.dispatch.dispatchId"
  );
  expectTraceEvidence(
    context,
    nativeDelivery.destination.spaceId,
    value.query.spaceId,
    ["trace", "nativeDelivery", "destination", "spaceId"],
    "trace.nativeDelivery.destination.spaceId must match query.spaceId"
  );
  expectTraceEvidence(
    context,
    nativeDelivery.destination.targetProfileId,
    value.trace.dispatch.targetProfileId,
    ["trace", "nativeDelivery", "destination", "targetProfileId"],
    "trace.nativeDelivery.destination.targetProfileId must match trace.dispatch.targetProfileId"
  );
}

function expectFinalVisibleMessageTraceEvidence(
  context: zod.RefinementCtx,
  trace: zod.infer<typeof spaceDispatchTraceSnapshotSchema>
): void {
  if (!trace.finalVisibleMessage) {
    return;
  }
  expectTraceEvidence(
    context,
    trace.finalVisibleMessage.dispatchId,
    trace.dispatch.dispatchId,
    ["trace", "finalVisibleMessage", "dispatchId"],
    "trace.finalVisibleMessage.dispatchId must match trace.dispatch.dispatchId"
  );
  expectTraceEvidence(
    context,
    trace.finalVisibleMessage.targetProfileId,
    trace.dispatch.targetProfileId,
    ["trace", "finalVisibleMessage", "targetProfileId"],
    "trace.finalVisibleMessage.targetProfileId must match trace.dispatch.targetProfileId"
  );
  const finalVisibleSignalCandidates =
    listSpaceDispatchTraceFinalVisibleSignalCandidates(trace);
  if (
    trace.finalVisibleMessage.factSource !==
      "space_signal_by_published_signal_id" ||
    finalVisibleSignalCandidates.length === 0
  ) {
    return;
  }
  if (
    !finalVisibleSignalCandidates.includes(trace.finalVisibleMessage.signalId)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "trace.finalVisibleMessage.signalId must match a canonical final visible publication signal",
      path: ["trace", "finalVisibleMessage", "signalId"],
    });
  }
}

function expectLatestAttemptTraceEvidence(
  context: zod.RefinementCtx,
  trace: SpaceDispatchTraceSnapshotValue
): void {
  if (trace.latestAttempt) {
    expectTraceEvidence(
      context,
      trace.latestAttempt.dispatchId,
      trace.dispatch.dispatchId,
      ["trace", "latestAttempt", "dispatchId"],
      "trace.latestAttempt.dispatchId must match trace.dispatch.dispatchId"
    );
  }
}

function expectTraceEvidence(
  context: zod.RefinementCtx,
  actual: string | null,
  expected: string | null,
  path: Array<string | number>,
  message: string
): void {
  if (actual !== expected) {
    context.addIssue({
      code: "custom",
      message,
      path,
    });
  }
}

function expectNullTraceEvidence(
  context: zod.RefinementCtx,
  actual: string | null,
  path: Array<string | number>
): void {
  expectTraceEvidence(
    context,
    actual,
    null,
    path,
    "not-found trace correlation must not include resolved trace evidence"
  );
}
