import * as z from "../../lazy-zod";
import { openMeldNavigationTargetSchema } from "../../navigation-action";
import { DISPATCH_ERROR_SUMMARY_MAX_LENGTH } from "../../public-agent-failure-reason";
import {
  ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT,
  organizationSkillRuntimeReleaseSelectionSchema,
} from "../http/organization-skills";
import {
  SPACE_FILE_MAX_SIZE_BYTES,
  SPACE_MESSAGE_FILE_MAX_COUNT,
  spaceMessageFileReferencesSchema,
} from "../http/space-files";
import {
  AGENT_STREAM_SNAPSHOT_MAX_CHARS,
  agentStreamToolPartSchema,
} from "../protocol/agent-stream";
import { MAX_TEXT_LENGTH } from "../protocol/constants";
import { conversationCompactionMarkerSchema } from "../protocol/conversation-compaction";
import {
  agentProfileIdSchema,
  openMeldRuntimeProfileIdSchema,
} from "../protocol/profile";
import {
  CENTER_AGENT_TASK_REFERENCE_MAX_COUNT,
  centerAgentTaskReferenceSchema,
} from "../protocol/signal";
import {
  SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE,
  spaceMessageAttachmentSchema,
  spaceMessageAttachmentsSchema,
} from "../protocol/space-attachment";
import { centerAgentModelRouteSchema } from "./center-agent-model";
import {
  remoteAgentTurnEnvelopeSchema,
  remoteAgentWorkLoopCheckpointSchema,
} from "./remote-agent-turn-envelope";

const nonEmptyStringSchema = z.string().trim().min(1);
const optionalNonEmptyStringSchema = nonEmptyStringSchema.optional();
const nullableNonEmptyStringSchema = nonEmptyStringSchema.nullable();
const optionalDispatchErrorSummarySchema = nonEmptyStringSchema
  .max(DISPATCH_ERROR_SUMMARY_MAX_LENGTH)
  .optional();

export const REMOTE_AGENT_CONVERSATION_CONTINUITY_MAX_ENTRIES = 20;
export const REMOTE_AGENT_CONVERSATION_CONTINUITY_ENTRY_TEXT_MAX_CHARS = 4000;
export const REMOTE_AGENT_CONVERSATION_CONTINUITY_TOTAL_TEXT_MAX_CHARS = 16_000;
const REMOTE_AGENT_LOGICAL_CONVERSATION_ID_MAX_CHARS = 1024;
const REMOTE_AGENT_RUNTIME_CONVERSATION_ID_MAX_CHARS = 2048;
const contentHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const isoDateTimeSchema = z.iso.datetime({ offset: true });

export function buildRemoteAgentRuntimeConversationId(input: {
  generation: number;
  logicalConversationId: string;
  organizationId: string;
}): string {
  const organizationId = nonEmptyStringSchema
    .max(256)
    .parse(input.organizationId);
  const logicalConversationId = nonEmptyStringSchema
    .max(REMOTE_AGENT_LOGICAL_CONVERSATION_ID_MAX_CHARS)
    .parse(input.logicalConversationId);
  const generation = z.number().int().nonnegative().parse(input.generation);
  if (generation === 0) {
    return logicalConversationId;
  }
  return nonEmptyStringSchema
    .max(REMOTE_AGENT_RUNTIME_CONVERSATION_ID_MAX_CHARS)
    .parse(
      [
        "remote-agent-runtime-generation.v1",
        `${organizationId.length}:${organizationId}`,
        `${logicalConversationId.length}:${logicalConversationId}`,
        String(generation),
      ].join("|")
    );
}

export const remoteAgentConversationContinuityEntrySourceSchema =
  z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("space_signal"),
      signalId: nonEmptyStringSchema.max(256),
      spaceId: nonEmptyStringSchema.max(256),
      version: contentHashSchema,
    }),
    z.strictObject({
      conversationId: nonEmptyStringSchema.max(512),
      kind: z.literal("message_channel_message"),
      messageId: nonEmptyStringSchema.max(256),
      provider: z.enum(["feishu", "lark", "slack"]),
    }),
    z.strictObject({
      eventId: nonEmptyStringSchema.max(256),
      kind: z.literal("center_agent_task_event"),
      taskId: nonEmptyStringSchema.max(256),
    }),
  ]);

export const remoteAgentConversationContinuityEntrySchema = z
  .strictObject({
    author: z.strictObject({
      displayName: nonEmptyStringSchema.max(256).optional(),
      id: nonEmptyStringSchema.max(256).optional(),
      kind: z.enum(["agent", "bot", "human", "system", "unknown"]),
    }),
    content: z.strictObject({
      materializedContentHash: contentHashSchema,
      originalCharacterCount: z.number().int().nonnegative(),
      text: z
        .string()
        .max(REMOTE_AGENT_CONVERSATION_CONTINUITY_ENTRY_TEXT_MAX_CHARS * 2),
      truncated: z.boolean(),
    }),
    occurredAt: isoDateTimeSchema,
    source: remoteAgentConversationContinuityEntrySourceSchema,
  })
  .superRefine((entry, context) => {
    const materializedCharacterCount = Array.from(entry.content.text).length;
    if (
      materializedCharacterCount >
      REMOTE_AGENT_CONVERSATION_CONTINUITY_ENTRY_TEXT_MAX_CHARS
    ) {
      context.addIssue({
        code: "custom",
        message: "Continuity entry text exceeds its character budget.",
        path: ["content", "text"],
      });
    }
    if (materializedCharacterCount > entry.content.originalCharacterCount) {
      context.addIssue({
        code: "custom",
        message:
          "Continuity entry text cannot exceed its original character count.",
        path: ["content", "originalCharacterCount"],
      });
    }
  });

export const remoteAgentConversationContinuityContextSchema = z
  .strictObject({
    entries: z
      .array(remoteAgentConversationContinuityEntrySchema)
      .min(1)
      .max(REMOTE_AGENT_CONVERSATION_CONTINUITY_MAX_ENTRIES),
    fromGeneration: z.number().int().nonnegative(),
    logicalConversationId: nonEmptyStringSchema.max(
      REMOTE_AGENT_LOGICAL_CONVERSATION_ID_MAX_CHARS
    ),
    toGeneration: z.number().int().positive(),
    truncated: z.boolean(),
    v: z.literal(1),
  })
  .superRefine((continuity, context) => {
    if (continuity.toGeneration !== continuity.fromGeneration + 1) {
      context.addIssue({
        code: "custom",
        message:
          "Continuity context must connect adjacent runtime generations.",
        path: ["toGeneration"],
      });
    }
    const totalTextCharacters = continuity.entries.reduce(
      (total, entry) => total + Array.from(entry.content.text).length,
      0
    );
    if (
      totalTextCharacters >
      REMOTE_AGENT_CONVERSATION_CONTINUITY_TOTAL_TEXT_MAX_CHARS
    ) {
      context.addIssue({
        code: "custom",
        message: "Continuity context exceeds its total text budget.",
        path: ["entries"],
      });
    }
  });

export const remoteAgentRuntimeConversationSchema = z.strictObject({
  generation: z.number().int().nonnegative(),
  id: nonEmptyStringSchema.max(REMOTE_AGENT_RUNTIME_CONVERSATION_ID_MAX_CHARS),
});

export const REMOTE_AGENT_CENTER_AGENT_TASK_CONVERSATION_ID_PREFIX =
  "center-agent-task:";

export function buildRemoteAgentCenterAgentTaskConversationId(
  taskId: string
): string {
  return `${REMOTE_AGENT_CENTER_AGENT_TASK_CONVERSATION_ID_PREFIX}${nonEmptyStringSchema.parse(taskId)}`;
}

export const REMOTE_AGENT_STREAM_DELTA_MAX_CHARS = 1024 as const;

export const REMOTE_AGENT_RUNTIME_EVIDENCE_EVENTS = {
  ADMISSION_STAGE: "remote_agent.openmeld.admission_stage",
  RPC: "remote_agent.openmeld.rpc",
  TURN: "remote_agent.openmeld.turn",
} as const;

export const REMOTE_AGENT_ADMISSION_STAGE_OPERATIONS = {
  CALLBACK_RETRY_ARM_COMPLETED: "callback_retry_arm_completed",
  CALLBACK_RETRY_ARM_STARTED: "callback_retry_arm_started",
  DURABLE_OBJECT_ENTERED: "durable_object_entered",
  DURABLE_OBJECT_EXITED: "durable_object_exited",
  FLUE_REQUEST_COMPLETED: "flue_request_completed",
  FLUE_REQUEST_STARTED: "flue_request_started",
  PROVIDER_REGISTERED: "provider_registered",
  STORAGE_INITIALIZED: "storage_initialized",
  SUBMISSION_ACKNOWLEDGED: "submission_acknowledged",
  SUBMISSION_ATTACHMENTS_RESOLVED: "submission_attachments_resolved",
  SUBMISSION_DEDUPE_COMPLETED: "submission_dedupe_completed",
  SUBMISSION_REQUEST_DIGESTED: "submission_request_digested",
  SUBMISSION_STARTED: "submission_started",
} as const;

export const remoteAgentAdmissionStageOperationSchema = z.enum(
  Object.values(REMOTE_AGENT_ADMISSION_STAGE_OPERATIONS)
);

export const REMOTE_AGENT_RPC_OPERATIONS = {
  CANCEL_EXECUTION: "cancelExecution",
  READ_EXECUTION_STATE: "readExecutionState",
  RECONCILE_EXECUTION: "reconcileExecution",
  READ_RUNTIME_DIAGNOSTICS: "readRuntimeDiagnostics",
  READ_USAGE_DIAGNOSTICS: "readUsageDiagnostics",
  SUBMIT_CONVERSATION_TURN: "submitConversationTurn",
  SUMMARIZE_AGENT_ACTIVITY_DIGEST: "summarizeAgentActivityDigest",
} as const;

export const remoteAgentRpcOperationSchema = z.enum(
  Object.values(REMOTE_AGENT_RPC_OPERATIONS)
);

export const REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES = {
  ADMISSION_ACCEPTED: "remote_agent.admission.accepted",
  ADMISSION_CONVERSATION_BUSY: "remote_agent.admission.conversation_busy",
  ADMISSION_NOT_ACCEPTED: "remote_agent.admission.not_accepted",
  PROVIDER_AUTHENTICATION_FAILED: "remote_agent.provider.authentication_failed",
  PROVIDER_FAILED: "remote_agent.provider.failed",
  PROVIDER_RATE_LIMITED: "remote_agent.provider.rate_limited",
  PROVIDER_UNAVAILABLE: "remote_agent.provider.unavailable",
  RPC_FAILED: "remote_agent.rpc.failed",
  RPC_INVALID_REQUEST: "remote_agent.rpc.invalid_request",
  RPC_SUCCEEDED: "remote_agent.rpc.succeeded",
  TURN_COMPLETED: "remote_agent.turn.completed",
  TURN_CONTEXT_WINDOW_EXCEEDED: "remote_agent.turn.context_window_exceeded",
  TURN_EMPTY_ASSISTANT_RESPONSE: "remote_agent.empty_assistant_response",
  TURN_FAILED: "remote_agent.turn.failed",
  TURN_NOT_COMPLETED: "remote_agent.turn_not_completed",
  TURN_TIMEOUT: "remote_agent.turn.timeout",
} as const;

export const remoteAgentRuntimeEvidenceReasonCodeSchema = z.enum(
  Object.values(REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES)
);

export const remoteAgentWorkerSubmissionStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "aborted",
  "skipped",
  "error",
]);

export const remoteAgentWorkerSubmitMessagesResultSchema = z.strictObject({
  submissionId: nonEmptyStringSchema,
  idempotencyKey: optionalNonEmptyStringSchema,
  requestId: optionalNonEmptyStringSchema,
  status: remoteAgentWorkerSubmissionStatusSchema,
  error: optionalNonEmptyStringSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.number().finite(),
  startedAt: z.number().finite().optional(),
  completedAt: z.number().finite().optional(),
  accepted: z.boolean(),
});

export const remoteAgentWorkerAdmissionRejectionCodeSchema = z.enum([
  "remote_agent.conversation_history_limit_exceeded",
  "remote_agent.routine_identity_mismatch",
  "remote_agent.member_research_identity_mismatch",
  "remote_agent.center_agent_task_identity_mismatch",
  "remote_agent.turn_envelope_identity_mismatch",
]);

export const remoteAgentRuntimeEvidenceOutcomeReasonCodeSchema = z.union([
  remoteAgentRuntimeEvidenceReasonCodeSchema,
  remoteAgentWorkerAdmissionRejectionCodeSchema,
]);

export const remoteAgentWorkerAdmissionRejectedResponseSchema = z.strictObject({
  idempotencyKey: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
  outcome: z.literal("rejected"),
  reasonCode: remoteAgentWorkerAdmissionRejectionCodeSchema,
  v: z.literal(1),
});

export const remoteAgentWorkerSubmitTurnResponseSchema = z.union([
  remoteAgentWorkerSubmitMessagesResultSchema,
  remoteAgentWorkerAdmissionRejectedResponseSchema,
]);

const remoteAgentWorkerLegacyInputAttachmentSchema =
  spaceMessageAttachmentSchema.extend({
    objectKey: z.undefined().optional(),
    removeAfterAdmission: z.literal(true).optional(),
  });

const remoteAgentWorkerSpaceFileInputAttachmentSchema =
  spaceMessageAttachmentSchema.extend({
    /**
     * Core-resolved immutable object key for a canonical Space File revision.
     */
    objectKey: nonEmptyStringSchema.max(4096),
    removeAfterAdmission: z.never().optional(),
    sizeBytes: z.number().int().finite().min(1).max(SPACE_FILE_MAX_SIZE_BYTES),
  });

export const remoteAgentWorkerInputAttachmentSchema = z.union([
  remoteAgentWorkerLegacyInputAttachmentSchema,
  remoteAgentWorkerSpaceFileInputAttachmentSchema,
]);

export const remoteAgentWorkerInputAttachmentsSchema = z
  .array(remoteAgentWorkerInputAttachmentSchema)
  .max(SPACE_MESSAGE_FILE_MAX_COUNT)
  .superRefine((attachments, context) => {
    const legacyAttachmentCount = attachments.filter(
      (attachment) => attachment.objectKey === undefined
    ).length;
    if (legacyAttachmentCount > SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE) {
      context.addIssue({
        code: "custom",
        path: [],
        message: `Legacy message attachments cannot exceed ${SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE}.`,
      });
    }
  });

export const remoteAgentWorkerTurnMessageSchema = z.strictObject({
  role: z.enum(["user"]),
  content: nonEmptyStringSchema,
  attachments: remoteAgentWorkerInputAttachmentsSchema.optional(),
});

export const remoteAgentWorkerAuthorContextSchema = z.strictObject({
  profileId: openMeldRuntimeProfileIdSchema.nullable(),
  profileKind: z.enum(["human", "agent", "system"]).nullable(),
  displayName: nullableNonEmptyStringSchema,
});

const remoteAgentWorkerSubmitTurnRequestShape = {
  organizationId: nonEmptyStringSchema,
  spaceId: nonEmptyStringSchema,
  // Canonical conversation identity is independent from the publication
  // destination. Ordinary turns omit this field and keep the Space/provider
  // conversation as their serial lane. Center Agent Tasks use a Task-scoped
  // identity so separate Tasks can run in parallel without changing where the
  // result is published.
  conversationId: optionalNonEmptyStringSchema,
  agentProfileId: agentProfileIdSchema,
  agentProfileOwnerUserId: nonEmptyStringSchema,
  bindingId: nonEmptyStringSchema,
  triggerMessageId: nonEmptyStringSchema,
  dispatchId: nonEmptyStringSchema,
  sourceClientMessageId: nullableNonEmptyStringSchema.optional(),
  idempotencyKey: nonEmptyStringSchema,
  // Deprecated compatibility field. Current workers ignore total execution
  // deadlines; execution liveness is reported by the worker lifecycle state.
  toolExecutionDeadlineAtMs: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  messages: z.array(remoteAgentWorkerTurnMessageSchema).min(1),
  author: remoteAgentWorkerAuthorContextSchema,
  onBehalfOf: remoteAgentWorkerAuthorContextSchema.nullable(),
  organizationSkillReleases: z
    .array(organizationSkillRuntimeReleaseSelectionSchema)
    .max(ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT)
    .optional(),
  turnEnvelope: remoteAgentTurnEnvelopeSchema,
};

export const remoteAgentWorkerSubmitTurnRequestV1Schema = z.strictObject({
  v: z.literal(1),
  ...remoteAgentWorkerSubmitTurnRequestShape,
});

export const remoteAgentWorkerSubmitTurnRequestV2Schema = z.strictObject({
  v: z.literal(2),
  ...remoteAgentWorkerSubmitTurnRequestShape,
  modelRoute: centerAgentModelRouteSchema,
});

export const remoteAgentWorkerConversationIdentitySchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("center_agent_task"),
      taskId: nonEmptyStringSchema,
    }),
  ]
);

export const remoteAgentWorkerSubmitTurnRequestV3Schema = z.strictObject({
  v: z.literal(3),
  ...remoteAgentWorkerSubmitTurnRequestShape,
  conversationIdentity: remoteAgentWorkerConversationIdentitySchema,
  modelRoute: centerAgentModelRouteSchema,
});

export const remoteAgentWorkerSubmitTurnRequestV4Schema = z
  .strictObject({
    v: z.literal(4),
    ...remoteAgentWorkerSubmitTurnRequestShape,
    conversationId: nonEmptyStringSchema.max(
      REMOTE_AGENT_LOGICAL_CONVERSATION_ID_MAX_CHARS
    ),
    conversationIdentity:
      remoteAgentWorkerConversationIdentitySchema.optional(),
    continuityContext:
      remoteAgentConversationContinuityContextSchema.optional(),
    modelRoute: centerAgentModelRouteSchema,
    runtimeConversation: remoteAgentRuntimeConversationSchema,
  })
  .superRefine((request, context) => {
    const expectedRuntimeConversationId = buildRemoteAgentRuntimeConversationId(
      {
        generation: request.runtimeConversation.generation,
        logicalConversationId: request.conversationId,
        organizationId: request.organizationId,
      }
    );
    if (request.runtimeConversation.id !== expectedRuntimeConversationId) {
      context.addIssue({
        code: "custom",
        message:
          "Runtime conversation identity must match its logical conversation generation.",
        path: ["runtimeConversation", "id"],
      });
    }
    if (
      request.runtimeConversation.generation === 0 &&
      request.continuityContext
    ) {
      context.addIssue({
        code: "custom",
        message: "Legacy generation zero cannot carry rollover continuity.",
        path: ["continuityContext"],
      });
    }
    if (
      request.continuityContext &&
      (request.continuityContext.logicalConversationId !==
        request.conversationId ||
        request.continuityContext.toGeneration !==
          request.runtimeConversation.generation)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Continuity context must match the admitted logical conversation generation.",
        path: ["continuityContext"],
      });
    }
  });

export const remoteAgentWorkerSubmitTurnRequestSchema = z.discriminatedUnion(
  "v",
  [
    remoteAgentWorkerSubmitTurnRequestV1Schema,
    remoteAgentWorkerSubmitTurnRequestV2Schema,
    remoteAgentWorkerSubmitTurnRequestV3Schema,
    remoteAgentWorkerSubmitTurnRequestV4Schema,
  ]
);

const remoteAgentWorkerExecutionIdentitySchema = {
  v: z.literal(1),
  organizationId: nonEmptyStringSchema,
  spaceId: nonEmptyStringSchema,
  submissionId: nonEmptyStringSchema,
  idempotencyKey: nonEmptyStringSchema,
};

export const remoteAgentWorkerExecutionStatusSchema = z.enum([
  "pending",
  "running",
  "cancellation_requested",
  "completed",
  "failed",
  "aborted",
]);

export const remoteAgentWorkerExecutionProgressKindSchema = z.enum([
  "admitted",
  "agent_started",
  "thinking_delta",
  "text_delta",
  "tool_started",
  "tool_completed",
  "tool_failed",
  "prompt_completed",
  "prompt_failed",
  "cancellation_requested",
  "aborted",
]);

export const remoteAgentWorkerExecutionQuerySchema = z.strictObject({
  ...remoteAgentWorkerExecutionIdentitySchema,
  conversationId: optionalNonEmptyStringSchema,
});

export const remoteAgentWorkerExecutionStateSchema = z.strictObject({
  ...remoteAgentWorkerExecutionIdentitySchema,
  status: remoteAgentWorkerExecutionStatusSchema,
  acceptedAtMs: z.number().int().nonnegative(),
  lastProgressAtMs: z.number().int().nonnegative(),
  lastProgressKind: remoteAgentWorkerExecutionProgressKindSchema,
  completedAtMs: z.number().int().nonnegative().nullable(),
  cancellationReason: nonEmptyStringSchema.max(512).nullable(),
});

export const remoteAgentWorkerExecutionQueryResponseSchema = z.union([
  z.strictObject({
    status: z.literal("found"),
    execution: remoteAgentWorkerExecutionStateSchema,
  }),
  z.strictObject({ status: z.literal("not_found") }),
  z.strictObject({
    status: z.literal("identity_mismatch"),
    reasonCode: z.literal("remote_agent.execution_identity_mismatch"),
  }),
]);

export const remoteAgentWorkerCancellationRequestSchema = z.strictObject({
  ...remoteAgentWorkerExecutionIdentitySchema,
  conversationId: optionalNonEmptyStringSchema,
  reason: nonEmptyStringSchema.max(512).optional(),
});

export const remoteAgentWorkerCancellationResponseSchema = z.union([
  z.strictObject({
    status: z.literal("cancellation_requested"),
    execution: remoteAgentWorkerExecutionStateSchema,
  }),
  z.strictObject({
    status: z.literal("already_cancelled"),
    execution: remoteAgentWorkerExecutionStateSchema,
  }),
  z.strictObject({
    status: z.literal("not_stoppable"),
    execution: remoteAgentWorkerExecutionStateSchema,
  }),
  z.strictObject({ status: z.literal("not_found") }),
  z.strictObject({
    status: z.literal("identity_mismatch"),
    reasonCode: z.literal("remote_agent.execution_identity_mismatch"),
  }),
]);

export const remoteAgentWorkerReadUsageDiagnosticsRequestSchema =
  z.strictObject({
    organizationId: optionalNonEmptyStringSchema,
    runtimeConversationId: nonEmptyStringSchema.max(
      REMOTE_AGENT_RUNTIME_CONVERSATION_ID_MAX_CHARS
    ),
    spaceId: nonEmptyStringSchema,
  });

export const remoteAgentWorkerRuntimeDiagnosticsRequestSchema = z.strictObject({
  runtimeConversationId: nonEmptyStringSchema.max(
    REMOTE_AGENT_RUNTIME_CONVERSATION_ID_MAX_CHARS
  ),
  spaceId: nonEmptyStringSchema,
});

const nullableNonNegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .nullable();

const remoteAgentRuntimeSubmissionDiagnosticSchema = z.strictObject({
  abortRequestedAtMs: nullableNonNegativeIntegerSchema,
  acceptedAtMs: z.number().int().nonnegative(),
  attemptCount: z.number().int().nonnegative(),
  attemptId: nullableNonEmptyStringSchema,
  canonicalReadyAtMs: nullableNonNegativeIntegerSchema,
  inputAppliedAtMs: nullableNonNegativeIntegerSchema,
  kind: z.enum(["direct", "dispatch"]),
  leaseExpiresAtMs: z.number().int().nonnegative(),
  maxRetry: z.number().int().nonnegative(),
  ownerId: nullableNonEmptyStringSchema,
  recoveryRequestedAtMs: nullableNonNegativeIntegerSchema,
  sequence: z.number().int().positive(),
  settledAtMs: nullableNonNegativeIntegerSchema,
  startedAtMs: nullableNonNegativeIntegerSchema,
  status: z.enum(["queued", "running", "terminalizing", "settled"]),
  submissionId: nonEmptyStringSchema,
  timeoutAtMs: z.number().int().nonnegative(),
});

const remoteAgentRuntimeAttemptMarkerDiagnosticSchema = z.strictObject({
  attemptId: nonEmptyStringSchema,
  createdAtMs: z.number().int().nonnegative(),
  submissionId: nonEmptyStringSchema,
});

const remoteAgentRuntimeActiveRunDiagnosticSchema = z.strictObject({
  createdAtMs: z.number().int().nonnegative(),
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
});

const remoteAgentRuntimeFiberDiagnosticSchema = z.strictObject({
  completedAtMs: nullableNonNegativeIntegerSchema,
  createdAtMs: z.number().int().nonnegative(),
  fiberId: nonEmptyStringSchema,
  idempotencyKey: nullableNonEmptyStringSchema,
  name: nonEmptyStringSchema,
  startedAtMs: nullableNonNegativeIntegerSchema,
  status: nonEmptyStringSchema,
});

const remoteAgentRuntimeScheduleDiagnosticSchema = z.strictObject({
  callback: nullableNonEmptyStringSchema,
  createdAtSeconds: z.number().int().nonnegative(),
  delayInSeconds: nullableNonNegativeIntegerSchema,
  executionStartedAtMs: nullableNonNegativeIntegerSchema,
  id: nonEmptyStringSchema,
  running: z.boolean(),
  timeMs: nullableNonNegativeIntegerSchema,
  type: nonEmptyStringSchema,
});

const remoteAgentRuntimeCallbackContextDiagnosticSchema = z.strictObject({
  callbackAttempts: z.number().int().nonnegative(),
  callbackCompletedAt: z.iso.datetime({ offset: true }).nullable(),
  callbackNextAttemptAt: z.iso.datetime({ offset: true }).nullable(),
  callbackStatus: z.enum([
    "completed",
    "delivery_failed",
    "failed",
    "pending",
    "rejected",
    "retryable",
  ]),
  dispatchId: nonEmptyStringSchema,
  hasCompletedText: z.boolean(),
  lastCoreResponseReasonCode: nullableNonEmptyStringSchema,
  lastCoreResponseStatus: z
    .enum(["accepted", "duplicate_rejected", "rejected", "retryable"])
    .nullable(),
  lastFailureCode: nullableNonEmptyStringSchema,
  submissionId: nonEmptyStringSchema,
  updatedAtMs: z.number().int().nonnegative(),
});

const remoteAgentRecentToolCallDiagnosticSchema = z.strictObject({
  calledAtMs: z.number().int().nonnegative(),
  source: z.enum(["code_mode", "direct"]),
  toolName: nonEmptyStringSchema.max(160),
});

const remoteAgentCapabilityDiscoveryDiagnosticSchema = z.strictObject({
  capabilityNames: z.array(nonEmptyStringSchema.max(160)).max(12),
  observedAtMs: z.number().int().nonnegative(),
  operation: z.enum(["describe", "search"]),
  resultCount: z.number().int().nonnegative(),
});

const remoteAgentProviderRequestDiagnosticSchema = z.strictObject({
  availableToolCount: z.number().int().nonnegative(),
  deferredToolCount: z.number().int().nonnegative(),
  exposedToolCount: z.number().int().nonnegative(),
  modelId: nullableNonEmptyStringSchema,
  preparedAtMs: z.number().int().nonnegative(),
});

export const remoteAgentTurnRuntimeEvidenceSchema = z.strictObject({
  budgetExhaustedAtMs: nullableNonNegativeIntegerSchema,
  capabilityDescribeCount: z.number().int().nonnegative(),
  capabilitySearchCount: z.number().int().nonnegative(),
  codeModeToolCallCount: z.number().int().nonnegative(),
  directToolCallCount: z.number().int().nonnegative(),
  firstAssistantTextAtMs: nullableNonNegativeIntegerSchema,
  firstModelEventAtMs: nullableNonNegativeIntegerSchema,
  firstProviderRequestPreparedAtMs: nullableNonNegativeIntegerSchema,
  firstProviderResponseHeadersAtMs: nullableNonNegativeIntegerSchema,
  firstVisibleContentAtMs: nullableNonNegativeIntegerSchema,
  lastModelCompletedAtMs: nullableNonNegativeIntegerSchema,
  modelCallCount: z.number().int().nonnegative(),
  modelId: nullableNonEmptyStringSchema,
  providerAvailableToolCount: z.number().int().nonnegative(),
  providerDeferredToolCount: z.number().int().nonnegative(),
  providerExposedToolCount: z.number().int().nonnegative(),
  providerRequestCount: z.number().int().nonnegative(),
  recentCapabilityDiscovery: z
    .array(remoteAgentCapabilityDiscoveryDiagnosticSchema)
    .max(16),
  recentProviderRequests: z
    .array(remoteAgentProviderRequestDiagnosticSchema)
    .max(16),
  recentToolCalls: z.array(remoteAgentRecentToolCallDiagnosticSchema).max(32),
  submissionId: nonEmptyStringSchema,
  toolCallCount: z.number().int().nonnegative(),
  toolCallLimit: z.number().int().positive(),
  updatedAtMs: z.number().int().nonnegative(),
});

const remoteAgentWorkerRuntimeDiagnosticsResponseV1Schema = z.strictObject({
  activeRuns: z.array(remoteAgentRuntimeActiveRunDiagnosticSchema).max(50),
  attemptMarkers: z
    .array(remoteAgentRuntimeAttemptMarkerDiagnosticSchema)
    .max(50),
  callbackContexts: z
    .array(remoteAgentRuntimeCallbackContextDiagnosticSchema)
    .max(50),
  collectedAt: z.iso.datetime({ offset: true }),
  durableObjectAlarmAtMs: nullableNonNegativeIntegerSchema,
  fibers: z.array(remoteAgentRuntimeFiberDiagnosticSchema).max(50),
  schedules: z.array(remoteAgentRuntimeScheduleDiagnosticSchema).max(50),
  spaceId: nonEmptyStringSchema,
  submissions: z.array(remoteAgentRuntimeSubmissionDiagnosticSchema).max(50),
  // Optional during rolling deploys so a new Core can still inspect an older
  // Remote Agent generation without misreporting missing evidence as zeroes.
  turnObservability: z
    .array(remoteAgentTurnRuntimeEvidenceSchema)
    .max(50)
    .optional(),
  v: z.literal(1),
});

// Core accepts both during the beta-to-Flue-2 rollout. Flue 2 emits only V2;
// removed upstream fields are not fabricated as empty historical evidence.
const remoteAgentWorkerRuntimeDiagnosticsResponseV2Schema =
  remoteAgentWorkerRuntimeDiagnosticsResponseV1Schema
    .omit({
      attemptMarkers: true,
      submissions: true,
      v: true,
    })
    .extend({
      submissions: z
        .array(
          remoteAgentRuntimeSubmissionDiagnosticSchema
            .omit({
              maxRetry: true,
              recoveryRequestedAtMs: true,
            })
            .extend({
              maxAttempts: z.number().int().positive(),
              joinedInto: nullableNonEmptyStringSchema,
              status: z.enum([
                "queued",
                "running",
                "terminalizing",
                "settled",
                "joining",
                "joined",
              ]),
            })
        )
        .max(50),
      v: z.literal(2),
    });

export const remoteAgentWorkerRuntimeDiagnosticsResponseSchema =
  z.discriminatedUnion("v", [
    remoteAgentWorkerRuntimeDiagnosticsResponseV1Schema,
    remoteAgentWorkerRuntimeDiagnosticsResponseV2Schema,
  ]);

const remoteAgentCoreCallbackIdentitySchema = {
  submissionId: nonEmptyStringSchema,
  idempotencyKey: nonEmptyStringSchema,
  organizationId: nonEmptyStringSchema,
  spaceId: nonEmptyStringSchema,
  agentProfileId: agentProfileIdSchema,
  bindingId: nonEmptyStringSchema,
  triggerMessageId: nonEmptyStringSchema,
  dispatchId: nonEmptyStringSchema,
  callbackAttempt: z.number().int().positive().optional(),
};

const remoteAgentStreamDeltaCallbackIdentitySchema = {
  submissionId: nonEmptyStringSchema,
  idempotencyKey: nonEmptyStringSchema,
  organizationId: nonEmptyStringSchema,
  spaceId: nonEmptyStringSchema,
  agentProfileId: agentProfileIdSchema,
  bindingId: nonEmptyStringSchema,
  triggerMessageId: nonEmptyStringSchema,
  dispatchId: nonEmptyStringSchema,
};

const legacyRemoteAgentStreamDeltaCallbackBodySchema = z.strictObject({
  v: z.literal(1),
  streamId: nonEmptyStringSchema,
  sequence: z.number().int().positive(),
  ...remoteAgentStreamDeltaCallbackIdentitySchema,
  source: z.enum(["flue.text_delta", "simulated.final_text"]),
  textDelta: z.string().min(1).max(REMOTE_AGENT_STREAM_DELTA_MAX_CHARS),
  textSnapshot: z.string().min(1).max(AGENT_STREAM_SNAPSHOT_MAX_CHARS),
  observedAtMs: z.number().int().nonnegative(),
});

const typedRemoteAgentStreamDeltaCallbackIdentitySchema = {
  v: z.literal(2),
  streamId: nonEmptyStringSchema,
  sequence: z.number().int().positive(),
  ...remoteAgentStreamDeltaCallbackIdentitySchema,
  delta: z.string().min(1).max(REMOTE_AGENT_STREAM_DELTA_MAX_CHARS),
  snapshot: z.string().min(1).max(AGENT_STREAM_SNAPSHOT_MAX_CHARS),
  observedAtMs: z.number().int().nonnegative(),
};

export const remoteAgentStreamDeltaCallbackBodySchema = z.union([
  legacyRemoteAgentStreamDeltaCallbackBodySchema,
  z.strictObject({
    ...typedRemoteAgentStreamDeltaCallbackIdentitySchema,
    kind: z.literal("text"),
    source: z.literal("flue.text_delta"),
  }),
  z.strictObject({
    ...typedRemoteAgentStreamDeltaCallbackIdentitySchema,
    kind: z.literal("thinking"),
    source: z.literal("flue.thinking_delta"),
  }),
]);

export const remoteAgentStreamPartCallbackBodySchema = z.strictObject({
  v: z.literal(1),
  streamId: nonEmptyStringSchema,
  sequence: z.number().int().positive(),
  ...remoteAgentStreamDeltaCallbackIdentitySchema,
  source: z.literal("flue.tool"),
  part: agentStreamToolPartSchema,
  observedAtMs: z.number().int().nonnegative(),
});

const remoteAgentStreamLastSequenceSchema = z.number().int().nonnegative();
const remoteAgentRetryAfterMsSchema = z
  .number()
  .int()
  .nonnegative()
  .max(300_000);

export const remoteAgentStreamDeltaCallbackResponseSchema = z.union([
  z.strictObject({
    status: z.literal("accepted"),
    lastSequence: remoteAgentStreamLastSequenceSchema,
    gapDetected: z.boolean().optional(),
  }),
  z.strictObject({
    status: z.literal("duplicate_accepted"),
    lastSequence: remoteAgentStreamLastSequenceSchema,
  }),
  z.strictObject({
    status: z.literal("rejected"),
    lastSequence: remoteAgentStreamLastSequenceSchema,
    reasonCode: nonEmptyStringSchema,
  }),
  z.strictObject({
    status: z.literal("retryable"),
    lastSequence: remoteAgentStreamLastSequenceSchema,
    reasonCode: nonEmptyStringSchema,
    retryAfterMs: remoteAgentRetryAfterMsSchema.optional(),
  }),
]);

export const remoteAgentCoreCallbackBodySchema = z.union([
  z.strictObject({
    ...remoteAgentCoreCallbackIdentitySchema,
    centerAgentTaskReferences: z
      .array(centerAgentTaskReferenceSchema)
      .max(CENTER_AGENT_TASK_REFERENCE_MAX_COUNT)
      .optional(),
    conversationCompaction: conversationCompactionMarkerSchema.optional(),
    navigationTarget: openMeldNavigationTargetSchema.optional(),
    status: z.literal("completed").optional(),
    text: nonEmptyStringSchema.max(MAX_TEXT_LENGTH),
    attachments: spaceMessageAttachmentsSchema.optional(),
    files: spaceMessageFileReferencesSchema.optional(),
  }),
  z.strictObject({
    ...remoteAgentCoreCallbackIdentitySchema,
    status: z.literal("failed"),
    failureCode: nonEmptyStringSchema,
    failureDetail: optionalDispatchErrorSummarySchema,
    failureMessage: nonEmptyStringSchema,
  }),
]);

export const remoteAgentCoreWorkLoopContinuationCallbackBodySchema =
  z.strictObject({
    ...remoteAgentCoreCallbackIdentitySchema,
    checkpoint: remoteAgentWorkLoopCheckpointSchema,
    status: z.literal("continuation_required"),
  });

export const remoteAgentCoreCallbackEventSchema = z.union([
  remoteAgentCoreCallbackBodySchema,
  remoteAgentCoreWorkLoopContinuationCallbackBodySchema,
]);

export const routineWorkflowContinuationEventPayloadSchema =
  z.discriminatedUnion("kind", [
    z.strictObject({
      callback: remoteAgentCoreCallbackBodySchema,
      kind: z.literal("callback"),
    }),
    z.strictObject({
      failureCode: nonEmptyStringSchema,
      kind: z.literal("terminal_failure"),
    }),
  ]);

export const remoteAgentCoreCompletedCallbackBodySchema = z.strictObject({
  ...remoteAgentCoreCallbackIdentitySchema,
  centerAgentTaskReferences: z
    .array(centerAgentTaskReferenceSchema)
    .max(CENTER_AGENT_TASK_REFERENCE_MAX_COUNT)
    .optional(),
  conversationCompaction: conversationCompactionMarkerSchema.optional(),
  navigationTarget: openMeldNavigationTargetSchema.optional(),
  status: z.literal("completed"),
  text: nonEmptyStringSchema.max(MAX_TEXT_LENGTH),
  attachments: spaceMessageAttachmentsSchema.optional(),
  files: spaceMessageFileReferencesSchema.optional(),
});

export const remoteAgentCoreFailedCallbackBodySchema = z.strictObject({
  ...remoteAgentCoreCallbackIdentitySchema,
  status: z.literal("failed"),
  failureCode: nonEmptyStringSchema,
  failureDetail: optionalDispatchErrorSummarySchema,
  failureMessage: nonEmptyStringSchema,
});

export const remoteAgentCoreCallbackResponseSchema = z.strictObject({
  status: z.enum(["accepted", "duplicate_rejected", "rejected", "retryable"]),
  reasonCode: nonEmptyStringSchema.optional(),
  publishedSignalId: nonEmptyStringSchema.nullable().optional(),
  retryAfterMs: remoteAgentRetryAfterMsSchema.optional(),
});
