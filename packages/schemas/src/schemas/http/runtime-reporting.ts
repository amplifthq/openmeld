import * as z from "zod/v4";
import { agentControllerRefSchema } from "../daemon/agent-controller-ref";
import { runtimeTransportModeSchema } from "../daemon/controller-contract";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { agentControllerInterfaceSnapshotSchema } from "../runtime/agent-controller-interface";

const boundedIdentifierSchema = z.string().trim().min(1).max(256);
const reasonCodeSchema = z.string().trim().min(1).max(256);

export const AGENT_CONTROLLER_TASK_LIFECYCLE_EVENT_BATCH_MAX_BYTES = 128 * 1024;

export const runtimeReportingRouteParamsSchema = z.strictObject({
  deviceId: boundedIdentifierSchema,
});

export const runtimeReportingRuntimeIdSchema = z.strictObject({
  source: z.literal("runtime_registry_authority"),
  value: z.string().trim().min(1).max(512),
});

export const submitRuntimeRegistrationBodySchema = z.strictObject({
  lane: boundedIdentifierSchema,
});

export const agentControllerTaskLifecycleEventTypeSchema = z.enum([
  "registered",
  "completed",
  "needs_attention",
]);

export const agentControllerTaskLifecycleEventSourceSchema = z.enum([
  "claude_notification",
  "claude_session_start",
  "claude_subagent_start",
  "claude_subagent_stop",
  "claude_task_completed",
  "claude_task_created",
  "codex_permission_request",
  "codex_stop",
  "codex_subagent_start",
  "codex_subagent_stop",
  "codex_user_prompt_submit",
]);

export const submitAgentControllerTaskLifecycleEventItemSchema = z
  .strictObject({
    agentControllerRef: agentControllerRefSchema,
    attentionCode: reasonCodeSchema.nullable(),
    eventId: boundedIdentifierSchema,
    eventType: agentControllerTaskLifecycleEventTypeSchema,
    occurredAtMs: z.int().nonnegative(),
    organizationId: boundedIdentifierSchema,
    source: agentControllerTaskLifecycleEventSourceSchema,
    taskId: boundedIdentifierSchema,
  })
  .superRefine((value, context) => {
    if (value.eventType === "needs_attention" && value.attentionCode === null) {
      context.addIssue({
        code: "custom",
        message: "needs_attention lifecycle events require an attentionCode.",
        path: ["attentionCode"],
      });
    }
    if (value.eventType !== "needs_attention" && value.attentionCode !== null) {
      context.addIssue({
        code: "custom",
        message:
          "Only needs_attention lifecycle events may carry attentionCode.",
        path: ["attentionCode"],
      });
    }
  });

export const submitAgentControllerTaskLifecycleEventsBodySchema =
  z.strictObject({
    events: z
      .array(submitAgentControllerTaskLifecycleEventItemSchema)
      .min(1)
      .max(64),
    lane: boundedIdentifierSchema,
    openMeldServiceRuntimeId: runtimeReportingRuntimeIdSchema,
  });

export const submitAgentControllerTaskLifecycleEventsRpcInputSchema =
  z.strictObject({
    ...submitAgentControllerTaskLifecycleEventsBodySchema.shape,
    context: openMeldRequestContextSchema.optional(),
    deviceId: boundedIdentifierSchema,
  });

export const runtimeRegistrationRejectedReasonSchema = z.enum([
  "device_forgotten",
  "owner_authorization_denied",
  "owner_authorization_unknown",
  "owner_authorization_unavailable",
  "owner_kind_unsupported",
  "openmeld_service_runtime_id_collision",
  "openmeld_service_runtime_id_invalid",
  "openmeld_service_runtime_id_not_opaque",
  "runtime_record_missing_after_conflict",
  "unknown",
]);

export const submitRuntimeRegistrationResponseSchema = z
  .strictObject({
    reason: runtimeRegistrationRejectedReasonSchema.optional(),
    openMeldServiceRuntimeId: runtimeReportingRuntimeIdSchema.optional(),
    status: z.enum(["created", "reused", "rejected"]),
  })
  .superRefine((value, context) => {
    if (value.status !== "rejected" && !value.openMeldServiceRuntimeId) {
      context.addIssue({
        code: "custom",
        message:
          "registered Runtime response requires authority openMeldServiceRuntimeId",
        path: ["openMeldServiceRuntimeId"],
      });
    }
    if (value.status === "rejected" && !value.reason) {
      context.addIssue({
        code: "custom",
        message: "rejected Runtime registration requires a reason",
        path: ["reason"],
      });
    }
  });

export const runtimeAgentControllerReportStatusSchema = z.enum([
  "ready",
  "disabled",
  "unavailable",
  "unknown",
]);

export const submitRuntimeAgentControllerReportItemSchema = z
  .strictObject({
    agentControllerRef: boundedIdentifierSchema,
    agentControllerInterface: agentControllerInterfaceSnapshotSchema.optional(),
    expiresAtMs: z.int().positive(),
    observedAtMs: z.int().positive(),
    reasonCodes: z.array(reasonCodeSchema).optional(),
    status: runtimeAgentControllerReportStatusSchema,
  })
  .superRefine((value, context) => {
    if (
      value.agentControllerInterface &&
      value.agentControllerInterface.agentControllerRef !==
        value.agentControllerRef
    ) {
      context.addIssue({
        code: "custom",
        message:
          "agentControllerInterface.agentControllerRef must match report agentControllerRef",
        path: ["agentControllerInterface", "agentControllerRef"],
      });
    }
  });

export const submitRuntimeAgentControllerReportsBodySchema = z.strictObject({
  lane: boundedIdentifierSchema,
  reports: z.array(submitRuntimeAgentControllerReportItemSchema).min(1).max(64),
  openMeldServiceRuntimeId: runtimeReportingRuntimeIdSchema,
});

export const runtimeProviderConversationProofProviderSchema =
  z.literal("codex");

export const runtimeProviderConversationProofMethodSchema = z.enum([
  "codex_app_server_thread_resume",
  "codex_app_server_thread_read",
]);

export const runtimeProviderConversationProofStatusSchema = z.enum([
  "failed",
  "passed",
]);

export const submitRuntimeProviderConversationProofItemSchema = z.strictObject({
  agentProfileId: boundedIdentifierSchema,
  bindingId: boundedIdentifierSchema,
  agentControllerRef: boundedIdentifierSchema,
  agentControllerConversationId: boundedIdentifierSchema,
  transportMode: runtimeTransportModeSchema,
  provider: runtimeProviderConversationProofProviderSchema,
  method: runtimeProviderConversationProofMethodSchema,
  intrusive: z.literal(false),
  observedAtMs: z.int().positive(),
  expiresAtMs: z.int().positive(),
  status: runtimeProviderConversationProofStatusSchema,
  errorCode: boundedIdentifierSchema.optional(),
  errorMessage: z.string().trim().min(1).max(2000).optional(),
  errorType: boundedIdentifierSchema.optional(),
});

export const submitRuntimeProviderConversationProofsBodySchema = z.strictObject(
  {
    lane: boundedIdentifierSchema,
    proofs: z
      .array(submitRuntimeProviderConversationProofItemSchema)
      .min(1)
      .max(64),
    openMeldServiceRuntimeId: runtimeReportingRuntimeIdSchema,
  }
);

export const runtimeAgentControllerReportRejectedReasonSchema = z.enum([
  "agent_controller_ref_invalid",
  "conflict",
  "out_of_order",
  "report_status_invalid",
  "report_time_invalid",
  "openmeld_service_runtime_id_invalid",
  "openmeld_service_runtime_id_mismatch",
  "openmeld_service_runtime_identity_invalid",
  "runtime_lookup_conflict",
  "runtime_missing",
  "stale",
]);

export const agentControllerTaskLifecycleEventRejectedReasonSchema = z.enum([
  "agent_controller_ref_unsupported",
  "event_id_conflict",
  "event_source_invalid",
  "event_time_invalid",
  "organization_membership_denied",
  "organization_membership_unavailable",
  "registered_task_missing",
  "runtime_lookup_conflict",
  "runtime_missing",
  "openmeld_service_runtime_id_invalid",
  "openmeld_service_runtime_id_mismatch",
  "openmeld_service_runtime_identity_invalid",
]);

export const runtimeProviderConversationProofRejectedReasonSchema = z.enum([
  "agent_controller_ref_invalid",
  "agent_profile_binding_mismatch",
  "agent_profile_binding_missing",
  "openmeld_service_runtime_id_invalid",
  "openmeld_service_runtime_id_mismatch",
  "openmeld_service_runtime_identity_invalid",
  "binding_id_invalid",
  "conflict",
  "out_of_order",
  "proof_status_invalid",
  "proof_time_invalid",
  "provider_method_invalid",
  "provider_unsupported",
  "runtime_lookup_conflict",
  "runtime_missing",
  "stale",
]);

export const submitRuntimeAgentControllerReportResultSchema = z
  .strictObject({
    agentControllerRef: boundedIdentifierSchema,
    outcome: z.enum(["created", "updated", "reused"]).optional(),
    reason: runtimeAgentControllerReportRejectedReasonSchema.optional(),
    status: z.enum(["accepted", "rejected"]),
  })
  .superRefine((value, context) => {
    if (value.status === "accepted" && !value.outcome) {
      context.addIssue({
        code: "custom",
        message: "accepted Runtime Agent Controller Report requires an outcome",
        path: ["outcome"],
      });
    }
    if (value.status === "rejected" && !value.reason) {
      context.addIssue({
        code: "custom",
        message: "rejected Runtime Agent Controller Report requires a reason",
        path: ["reason"],
      });
    }
  });

export const submitRuntimeAgentControllerReportsResponseSchema = z
  .strictObject({
    reports: z.array(submitRuntimeAgentControllerReportResultSchema),
    openMeldServiceRuntimeId: runtimeReportingRuntimeIdSchema.optional(),
    status: z.enum(["accepted", "partial", "rejected"]),
  })
  .superRefine((value, context) => {
    if (value.status !== "rejected" && !value.openMeldServiceRuntimeId) {
      context.addIssue({
        code: "custom",
        message:
          "accepted Runtime Agent Controller Report response requires authority openMeldServiceRuntimeId",
        path: ["openMeldServiceRuntimeId"],
      });
    }
  });

export const submitAgentControllerTaskLifecycleEventResultSchema = z
  .strictObject({
    eventId: boundedIdentifierSchema,
    outcome: z.enum(["accepted", "reused"]).optional(),
    reason: agentControllerTaskLifecycleEventRejectedReasonSchema.optional(),
    status: z.enum(["accepted", "permanently_rejected", "retryable_rejected"]),
  })
  .superRefine((value, context) => {
    if (value.status === "accepted" && !value.outcome) {
      context.addIssue({
        code: "custom",
        message:
          "Accepted Agent Controller task lifecycle events require an outcome.",
        path: ["outcome"],
      });
    }
    if (value.status === "accepted" && value.reason) {
      context.addIssue({
        code: "custom",
        message:
          "Accepted Agent Controller task lifecycle events cannot carry a rejection reason.",
        path: ["reason"],
      });
    }
    if (value.status !== "accepted" && !value.reason) {
      context.addIssue({
        code: "custom",
        message:
          "Rejected Agent Controller task lifecycle events require a reason.",
        path: ["reason"],
      });
    }
    if (value.status !== "accepted" && value.outcome) {
      context.addIssue({
        code: "custom",
        message:
          "Rejected Agent Controller task lifecycle events cannot carry an accepted outcome.",
        path: ["outcome"],
      });
    }
  });

export const submitAgentControllerTaskLifecycleEventsResponseSchema =
  z.strictObject({
    events: z.array(submitAgentControllerTaskLifecycleEventResultSchema),
    status: z.enum(["accepted", "partial", "rejected"]),
  });

export const submitRuntimeProviderConversationProofResultSchema = z
  .strictObject({
    agentProfileId: boundedIdentifierSchema,
    bindingId: boundedIdentifierSchema,
    outcome: z.enum(["created", "updated", "reused"]).optional(),
    reason: runtimeProviderConversationProofRejectedReasonSchema.optional(),
    status: z.enum(["accepted", "rejected"]),
  })
  .superRefine((value, context) => {
    if (value.status === "accepted" && !value.outcome) {
      context.addIssue({
        code: "custom",
        message: "accepted Provider Conversation Proof requires an outcome",
        path: ["outcome"],
      });
    }
    if (value.status === "rejected" && !value.reason) {
      context.addIssue({
        code: "custom",
        message: "rejected Provider Conversation Proof requires a reason",
        path: ["reason"],
      });
    }
  });

export const submitRuntimeProviderConversationProofsResponseSchema = z
  .strictObject({
    proofs: z.array(submitRuntimeProviderConversationProofResultSchema),
    openMeldServiceRuntimeId: runtimeReportingRuntimeIdSchema.optional(),
    status: z.enum(["accepted", "partial", "rejected"]),
  })
  .superRefine((value, context) => {
    if (value.status !== "rejected" && !value.openMeldServiceRuntimeId) {
      context.addIssue({
        code: "custom",
        message:
          "accepted Provider Conversation Proof response requires authority openMeldServiceRuntimeId",
        path: ["openMeldServiceRuntimeId"],
      });
    }
  });
