import * as z from "../../lazy-zod";
import { projectLocalConnectionFailureReasonCodeSchema } from "../../public-agent-failure-reason";
import { profileWorkingDirectorySchema } from "../protocol/profile";
import { openMeldSpaceEgressActionSchema } from "../space-mesh/openmeld-space-action";
import { runtimeTransportModeSchema } from "./controller-contract";
import { agentControllerConversationRefSchema } from "./conversation-contract";
import { bootstrapTemplateFactsSchema } from "./conversation-execution-state";
import { dispatchExecutionSchema } from "./conversation-lifecycle";

export const OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION = 4 as const;
const OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION_PREVIOUS = 3 as const;
const OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION_LEGACY = 2 as const;
const OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION_OLDEST = 1 as const;

export const openMeldDaemonTaskResultStatusSchema = z.enum([
  "success",
  "partial_success",
  "failed",
]);

export const openMeldDaemonTaskResultErrorTypeSchema = z.enum([
  "config",
  "network",
  "adapter",
  "policy",
  "timeout",
  "internal",
  "auth",
]);

export const openMeldDaemonProviderAccessEvidenceProviderSchema = z.enum([
  "claude-code",
  "codex",
  "opencode",
  "openclaw",
]);

export const openMeldDaemonProviderAccessEvidenceReasonCodeSchema = z.enum([
  "provider_account.capacity_exhausted",
  "provider_account.organization_access_disabled",
  "provider_account.subscription_access_unavailable",
]);

export const openMeldDaemonProviderAccessEvidenceSourceSchema =
  z.literal("wake_failure");

export const openMeldDaemonProviderAccessEvidenceSchema = z.strictObject({
  observedAtMs: z.number().int().nonnegative(),
  provider: openMeldDaemonProviderAccessEvidenceProviderSchema,
  reasonCode: openMeldDaemonProviderAccessEvidenceReasonCodeSchema,
  source: openMeldDaemonProviderAccessEvidenceSourceSchema,
});

export const openMeldDaemonTaskResultSpaceActionProvenanceSchema = z.enum([
  "cli_action",
  "direct",
  "local_repair",
  "controller_repair",
]);

export const openMeldDaemonTaskResultSpaceActionFailureRepairModeSchema =
  z.enum(["required_check", "local_synthetic", "controller_roundtrip"]);

export const openMeldDaemonTaskResultSpaceActionCarrierKindSchema = z.enum([
  "fenced_block",
  "invalid_json",
  "none",
  "trailing_json",
]);

export const openMeldDaemonTaskResultSpaceActionFailureDiagnosticsSchema =
  z.strictObject({
    carrierKind: openMeldDaemonTaskResultSpaceActionCarrierKindSchema,
    invalidOutputPreview: z.union([z.string().min(1), z.null()]),
    publicFailureReason: z
      .union([z.string().min(1), z.null()])
      .optional()
      .default(null),
    repairMode: openMeldDaemonTaskResultSpaceActionFailureRepairModeSchema,
    spaceActionCandidatePresent: z.boolean(),
    spaceActionParseError: z.union([z.string().min(1), z.null()]),
  });

export const openMeldDaemonTaskResultOpenClawGatewayVisibilityStatusSchema =
  z.enum([
    "missing_after_restart",
    "missing_before_restart",
    "visible",
    "visible_after_restart",
  ]);

export const openMeldDaemonTaskResultOpenClawGatewayVisibilitySchema =
  z.strictObject({
    agentId: z.string().min(1),
    gatewayRestartAttempted: z.boolean(),
    gatewayVisibility:
      openMeldDaemonTaskResultOpenClawGatewayVisibilityStatusSchema,
  });

export const openMeldDaemonTaskResultOpenClawBindingClassificationSchema =
  z.enum(["missing", "canonical_owned", "legacy", "foreign"]);

export const openMeldDaemonTaskResultOpenClawBindingSchema = z.strictObject({
  classification: openMeldDaemonTaskResultOpenClawBindingClassificationSchema,
});

export const openMeldDaemonTaskResultLocalOwnerConflictSchema = z.strictObject({
  activeAttemptId: z.string().min(1).nullable(),
  activeDispatchId: z.string().min(1).nullable(),
  activeExecutionTokenRunId: z.string().min(1).nullable(),
  activeRuntimeCoordinatorExecutionId: z.string().min(1).nullable(),
  activeTaskId: z.string().min(1).nullable(),
  reason: z.literal("task.owner_conflict"),
  rejectedAttemptId: z.string().min(1),
  rejectedDispatchId: z.string().min(1),
  rejectedExecutionTokenRunId: z.string().min(1).nullable(),
  rejectedRuntimeCoordinatorExecutionId: z.string().min(1).nullable(),
  rejectedTaskId: z.string().min(1),
});

export const openMeldDaemonTaskResultPromptTraceSchema = z.strictObject({
  fingerprint: z.string().min(1),
  length: z.int().nonnegative(),
  preview: z.union([z.string().min(1), z.null()]),
});

export const openMeldDaemonTaskResultClaimLeaseSchema = z.strictObject({
  claimLeaseId: z.string().min(1),
  outcome: z.enum(["existing_lease", "new_lease"]),
  status: z.literal("accepted"),
});

export const openMeldDaemonTaskResultProjectFailureContextSchema =
  z.strictObject({
    bindingGeneration: z.string().min(1).optional(),
    projectId: z.string().min(1),
  });

const openMeldDaemonTaskResultTokenUsageBreakdownSchema = z.strictObject({
  cacheWriteInputTokens: z.int().nonnegative().optional(),
  cachedInputTokens: z.int().nonnegative(),
  inputTokens: z.int().nonnegative(),
  outputTokens: z.int().nonnegative(),
  reasoningOutputTokens: z.int().nonnegative(),
  totalTokens: z.int().nonnegative(),
});

export const openMeldDaemonTaskResultTokenUsageSchema = z.strictObject({
  last: openMeldDaemonTaskResultTokenUsageBreakdownSchema,
  modelContextWindow: z.int().nonnegative().nullable(),
  total: openMeldDaemonTaskResultTokenUsageBreakdownSchema,
});

export const openMeldDaemonTaskResultTelemetrySchema = z.strictObject({
  completedAtMs: z.number().int().nonnegative(),
  contextCompactionObserved: z.boolean().optional(),
  contextHealed: z.boolean().optional(),
  exitCode: z.int().nullable().optional(),
  exitObservedAtMs: z.number().int().nonnegative().optional(),
  exitSignal: z.string().min(1).nullable().optional(),
  firstOutputAtMs: z.number().int().nonnegative().optional(),
  firstStderrAtMs: z.number().int().nonnegative().optional(),
  firstStdoutAtMs: z.number().int().nonnegative().optional(),
  invokedAtMs: z.number().int().nonnegative(),
  previewEmitted: z.boolean().optional(),
  processId: z.number().int().positive().optional(),
  processSpawnedAtMs: z.number().int().nonnegative().optional(),
  resumedContext: z.boolean(),
  stdinClosedAtMs: z.number().int().nonnegative().optional(),
  streamingMode: z.enum(["final", "stream"]).optional(),
  timeoutTriggeredAtMs: z.number().int().nonnegative().optional(),
  tokenUsage: openMeldDaemonTaskResultTokenUsageSchema.optional(),
});

const openMeldDaemonTaskResultCommonSchemaV1 = z.strictObject({
  taskId: z.string().min(1),
  sourceEventId: z.string().min(1),
  agentId: z.string().min(1),
  deduped: z.boolean(),
  agentControllerRef: z.string().min(1).optional(),
  agentControllerConversationId: z.string().min(1).optional(),
});

const openMeldDaemonTaskResultCommonSchema =
  openMeldDaemonTaskResultCommonSchemaV1.extend({
    attemptId: z.string().min(1),
    telemetry: openMeldDaemonTaskResultTelemetrySchema.optional(),
    agentControllerConversation:
      agentControllerConversationRefSchema.optional(),
    effectiveRuntimeWorkingDirectory: profileWorkingDirectorySchema.optional(),
    runtimeWorkspaceFingerprint: z.string().min(1).optional(),
    transportMode: runtimeTransportModeSchema.optional(),
    promptTrace: openMeldDaemonTaskResultPromptTraceSchema.optional(),
    projectFailureContext:
      openMeldDaemonTaskResultProjectFailureContextSchema.optional(),
    // Legacy diagnostic input accepted for older local services only.
    claimLease: openMeldDaemonTaskResultClaimLeaseSchema.optional(),
    bootstrapTemplateFacts: bootstrapTemplateFactsSchema.optional(),
    dispatchExecution: dispatchExecutionSchema.optional(),
    openClawGatewayVisibility:
      openMeldDaemonTaskResultOpenClawGatewayVisibilitySchema.optional(),
    openClawBinding: openMeldDaemonTaskResultOpenClawBindingSchema.optional(),
    localOwnerConflict:
      openMeldDaemonTaskResultLocalOwnerConflictSchema.optional(),
    spaceAction: openMeldSpaceEgressActionSchema.optional(),
    spaceActionFailureDiagnostics:
      openMeldDaemonTaskResultSpaceActionFailureDiagnosticsSchema.optional(),
    spaceActionProvenance:
      openMeldDaemonTaskResultSpaceActionProvenanceSchema.optional(),
    suppressPublicOutcome: z.boolean().optional(),
  });

const openMeldDaemonTaskResultCommonSchemaV3 =
  openMeldDaemonTaskResultCommonSchemaV1.extend({
    attemptId: z.string().min(1),
    telemetry: openMeldDaemonTaskResultTelemetrySchema.optional(),
    agentControllerConversation:
      agentControllerConversationRefSchema.optional(),
    effectiveRuntimeWorkingDirectory: profileWorkingDirectorySchema.optional(),
    runtimeWorkspaceFingerprint: z.string().min(1).optional(),
    bootstrapTemplateFacts: bootstrapTemplateFactsSchema.optional(),
    dispatchExecution: dispatchExecutionSchema.optional(),
    openClawGatewayVisibility:
      openMeldDaemonTaskResultOpenClawGatewayVisibilitySchema.optional(),
    openClawBinding: openMeldDaemonTaskResultOpenClawBindingSchema.optional(),
    spaceAction: openMeldSpaceEgressActionSchema.optional(),
    suppressPublicOutcome: z.boolean().optional(),
  });

const openMeldDaemonTaskResultSuccessPayloadSchema =
  openMeldDaemonTaskResultCommonSchema.extend({
    status: z.literal("success"),
    output: z.string().min(1),
  });

const openMeldDaemonTaskResultPartialSuccessPayloadSchema =
  openMeldDaemonTaskResultCommonSchema.extend({
    status: z.literal("partial_success"),
    output: z.string().min(1),
    errorType: openMeldDaemonTaskResultErrorTypeSchema,
    errorCode: z.string().min(1).optional(),
    partialReason: z.string().min(1),
    errorMessage: z.string().min(1).optional(),
  });

const openMeldDaemonTaskResultFailedPayloadSchema =
  openMeldDaemonTaskResultCommonSchema.extend({
    status: z.literal("failed"),
    errorType: openMeldDaemonTaskResultErrorTypeSchema,
    errorCode: z.string().min(1).optional(),
    errorMessage: z.string().min(1).optional(),
    providerAccessEvidence:
      openMeldDaemonProviderAccessEvidenceSchema.optional(),
  });

export const openMeldDaemonTaskResultPayloadSchema = z
  .discriminatedUnion("status", [
    openMeldDaemonTaskResultSuccessPayloadSchema,
    openMeldDaemonTaskResultPartialSuccessPayloadSchema,
    openMeldDaemonTaskResultFailedPayloadSchema,
  ])
  .superRefine((value, ctx) => {
    const isProjectConnectionFailure =
      value.status === "failed" &&
      projectLocalConnectionFailureReasonCodeSchema.safeParse(value.errorCode)
        .success;

    if (isProjectConnectionFailure && !value.projectFailureContext) {
      ctx.addIssue({
        code: "custom",
        message:
          "Project connection failures must include path-free Project trace context",
        path: ["projectFailureContext"],
      });
    }
    if (!isProjectConnectionFailure && value.projectFailureContext) {
      ctx.addIssue({
        code: "custom",
        message:
          "Project trace context is only valid for Project connection failures",
        path: ["projectFailureContext"],
      });
    }
  });

const openMeldDaemonTaskResultSuccessPayloadSchemaV3 =
  openMeldDaemonTaskResultCommonSchemaV3.extend({
    status: z.literal("success"),
    output: z.string().min(1),
  });

const openMeldDaemonTaskResultPartialSuccessPayloadSchemaV3 =
  openMeldDaemonTaskResultCommonSchemaV3.extend({
    status: z.literal("partial_success"),
    output: z.string().min(1),
    errorType: openMeldDaemonTaskResultErrorTypeSchema,
    errorCode: z.string().min(1).optional(),
    partialReason: z.string().min(1),
    errorMessage: z.string().min(1).optional(),
  });

const openMeldDaemonTaskResultFailedPayloadSchemaV3 =
  openMeldDaemonTaskResultCommonSchemaV3.extend({
    status: z.literal("failed"),
    errorType: openMeldDaemonTaskResultErrorTypeSchema,
    errorCode: z.string().min(1).optional(),
    errorMessage: z.string().min(1).optional(),
  });

const openMeldDaemonTaskResultPayloadSchemaV3 = z.discriminatedUnion("status", [
  openMeldDaemonTaskResultSuccessPayloadSchemaV3,
  openMeldDaemonTaskResultPartialSuccessPayloadSchemaV3,
  openMeldDaemonTaskResultFailedPayloadSchemaV3,
]);

const openMeldDaemonTaskResultSuccessPayloadSchemaV1 =
  openMeldDaemonTaskResultCommonSchemaV1.extend({
    status: z.literal("success"),
    output: z.string().min(1),
  });

const openMeldDaemonTaskResultPartialSuccessPayloadSchemaV1 =
  openMeldDaemonTaskResultCommonSchemaV1.extend({
    status: z.literal("partial_success"),
    output: z.string().min(1),
    errorType: openMeldDaemonTaskResultErrorTypeSchema,
    errorCode: z.string().min(1).optional(),
    partialReason: z.string().min(1),
    errorMessage: z.string().min(1).optional(),
  });

const openMeldDaemonTaskResultFailedPayloadSchemaV1 =
  openMeldDaemonTaskResultCommonSchemaV1.extend({
    status: z.literal("failed"),
    errorType: openMeldDaemonTaskResultErrorTypeSchema,
    errorCode: z.string().min(1).optional(),
    errorMessage: z.string().min(1).optional(),
  });

const openMeldDaemonTaskResultPayloadSchemaV1 = z.discriminatedUnion("status", [
  openMeldDaemonTaskResultSuccessPayloadSchemaV1,
  openMeldDaemonTaskResultPartialSuccessPayloadSchemaV1,
  openMeldDaemonTaskResultFailedPayloadSchemaV1,
]);

export const openMeldDaemonTaskResultEnvelopeWriteSchema = z.strictObject({
  v: z.literal(OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION),
  code: z.literal("service.task_result"),
  payload: openMeldDaemonTaskResultPayloadSchema,
});

const openMeldDaemonTaskResultEnvelopeSchemaV3 = z.strictObject({
  v: z.literal(OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION_PREVIOUS),
  code: z.literal("service.task_result"),
  payload: openMeldDaemonTaskResultPayloadSchemaV3,
});

const openMeldDaemonTaskResultEnvelopeSchemaV2 = z.strictObject({
  v: z.literal(OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION_LEGACY),
  code: z.literal("service.task_result"),
  payload: openMeldDaemonTaskResultPayloadSchemaV3,
});

const openMeldDaemonTaskResultEnvelopeSchemaV1 = z.strictObject({
  v: z.literal(OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION_OLDEST),
  code: z.literal("service.task_result"),
  payload: openMeldDaemonTaskResultPayloadSchemaV1,
});

export const openMeldDaemonTaskResultEnvelopeSchema = z.union([
  openMeldDaemonTaskResultEnvelopeWriteSchema,
  openMeldDaemonTaskResultEnvelopeSchemaV2,
  openMeldDaemonTaskResultEnvelopeSchemaV3,
  openMeldDaemonTaskResultEnvelopeSchemaV1,
]);
