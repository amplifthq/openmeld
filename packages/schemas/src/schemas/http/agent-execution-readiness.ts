import {
  agentExecutionReadinessImpactKindSchema,
  agentExecutionReadinessImpactSourceSchema,
} from "../../agent-execution-readiness-impact-taxonomy";
import * as z from "../../lazy-zod";
import type { AgentExecutionReadinessResponseOptions } from "../../types/http/agent-execution-readiness";
import type { RuntimeProviderConversationProofMethod } from "../../types/http/runtime-reporting";
import { daemonRouteObservationSummarySchema } from "../daemon/route-observation-summary";
import { daemonServiceLaneSchema } from "../daemon/service-contract";
import { openMeldDaemonProviderAccessEvidenceProviderSchema } from "../daemon/task-result";
import { agentProfileIdSchema } from "../protocol/profile";
import { agentControllerUsageLimitsSchema } from "../runtime/agent-controller-interface";
import {
  agentProfileBindingAgentControllerCollaborationModeSchema,
  agentProfileBindingAgentControllerPermissionModeSchema,
  agentProfileBindingModelSelectionSchema,
  agentProfileBindingProjectionSchema,
} from "./agent-profile-binding";
import { prepareReadinessRuntimeIdSchema } from "./prepare-readiness";
import { publicWakeabilityReasonSchema } from "./public-wakeability-reason";

const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const nullableTrimmedStringSchema = z.union([
  trimmedNonEmptyStringSchema,
  z.null(),
]);
const nullableIsoDateTimeSchema = z.union([ISO_DATE_TIME_SCHEMA, z.null()]);
export const AGENT_EXECUTION_READINESS_RESPONSE_VERSION_HEADER =
  "x-openmeld-agent-execution-readiness-version";
export const agentExecutionReadinessResponseOptionsSchema = z.strictObject({
  responseVersion: z.literal(2).optional(),
});
export const agentExecutionReadinessRouteParamsSchema = z.strictObject({
  agentProfileId: agentProfileIdSchema,
});

export const agentExecutionReadinessTargetRuntimeSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("current_local_runtime"),
    }),
    z.strictObject({
      kind: z.literal("openmeld_service_runtime_id"),
      openMeldServiceRuntimeId: prepareReadinessRuntimeIdSchema,
    }),
  ]
);

export const getAgentExecutionReadinessBatchBodySchema = z.strictObject({
  agentProfileIds: z.array(agentProfileIdSchema).min(1).max(100),
  targetRuntime: agentExecutionReadinessTargetRuntimeSchema.optional(),
});

export const agentExecutionReadinessPrimaryActionSchema = z.enum([
  "none",
  "connect_service",
  "reconnect_binding",
  "run_prepare",
  "update_service",
  "check_status",
  "fix_provider_account",
]);

export const agentExecutionReadinessPrimaryActionPlanSchema =
  z.discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("none"),
      target: z.null(),
    }),
    z.strictObject({
      action: z.literal("connect_service"),
      target: z.strictObject({
        kind: z.literal("openmeld_service_connection"),
      }),
    }),
    z.strictObject({
      action: z.literal("reconnect_binding"),
      target: z.union([
        z.strictObject({
          kind: z.literal("choose_local_agent"),
        }),
        z.strictObject({
          agentControllerRef: trimmedNonEmptyStringSchema,
          kind: z.literal("local_agent_connection"),
        }),
      ]),
    }),
    z.strictObject({
      action: z.literal("run_prepare"),
      target: z.strictObject({
        kind: z.literal("current_computer"),
      }),
    }),
    z.strictObject({
      action: z.literal("update_service"),
      target: z.strictObject({
        kind: z.literal("openmeld_service"),
      }),
    }),
    z.strictObject({
      action: z.literal("check_status"),
      target: z.strictObject({
        kind: z.literal("status"),
      }),
    }),
    z.strictObject({
      action: z.literal("fix_provider_account"),
      target: z.strictObject({
        kind: z.literal("provider_account"),
        provider: openMeldDaemonProviderAccessEvidenceProviderSchema,
      }),
    }),
  ]);

export const wakeRouteEvidenceSchema = daemonRouteObservationSummarySchema;

export const wakeRouteStatusSchema = z.discriminatedUnion("status", [
  z.strictObject({
    connectionGeneration: z.int().positive(),
    daemonSessionId: trimmedNonEmptyStringSchema,
    deviceId: trimmedNonEmptyStringSchema,
    lane: daemonServiceLaneSchema,
    lastHeartbeatMs: z.int().nonnegative(),
    leaseEpoch: z.int().positive(),
    status: z.literal("ready"),
  }),
  z.strictObject({
    status: z.enum(["checking", "offline", "unavailable"]),
  }),
]);

export const agentWakeRouteRegistrationStatusSchema = z.enum([
  "registered",
  "pending",
  "skipped",
  "rejected",
  "expired",
  "unavailable",
]);

export const agentWakeRouteRegistrationSchema = z.strictObject({
  status: agentWakeRouteRegistrationStatusSchema,
  reasonCode: nullableTrimmedStringSchema,
  reportedAtMs: z.number().int().nonnegative().nullable(),
  daemonSessionId: nullableTrimmedStringSchema,
  deviceId: nullableTrimmedStringSchema,
  lane: z.union([daemonServiceLaneSchema, z.null()]),
  serviceVersion: nullableTrimmedStringSchema,
});

export const agentWakeAvailabilityStatusSchema = z.enum([
  "available_for_wake",
  "checking_connection",
  "offline_for_wake",
  "unavailable_for_wake",
]);

export const agentWakeAvailabilityCategorySchema = z.enum([
  "available",
  "checking",
  "offline",
  "unavailable",
]);

export const agentWakeAvailabilityPhaseSchema = z.enum([
  "available",
  "checking_route",
  "checking_runtime",
  "checking_service",
  "checking_status",
  "connect_local_agent",
  "offline",
  "provider_blocked",
  "provider_sign_in_needed",
  "service_not_connected",
  "service_update_required",
  "unavailable",
]);

export const agentWakeAvailabilitySchema = z.strictObject({
  action: agentExecutionReadinessPrimaryActionSchema,
  badgeLabel: trimmedNonEmptyStringSchema,
  category: agentWakeAvailabilityCategorySchema,
  isRefreshing: z.boolean(),
  label: trimmedNonEmptyStringSchema,
  phase: agentWakeAvailabilityPhaseSchema,
  reasonCode: nullableTrimmedStringSchema,
  status: agentWakeAvailabilityStatusSchema,
  summary: trimmedNonEmptyStringSchema,
  tooltip: trimmedNonEmptyStringSchema,
});

export const agentExecutionReadinessSchema = z.strictObject({
  agentProfileId: agentProfileIdSchema,
  displayState: z.enum(["ready", "not_ready", "blocked", "unknown"]),
  facts: z.strictObject({
    profile: z.strictObject({
      active: z.boolean(),
      reasonCodes: z.array(trimmedNonEmptyStringSchema),
      source: z.enum(["not_checked", "profile_identity", "unavailable"]),
    }),
    binding: z.strictObject({
      reasonCodes: z.array(trimmedNonEmptyStringSchema),
      routable: z.boolean(),
      source: z.enum([
        "binding_truth",
        "blocked",
        "missing",
        "not_checked",
        "unavailable",
      ]),
    }),
    claim: z.strictObject({
      executionBlocked: z.boolean(),
      grantsClaimSuccess: z.literal(false),
      reasonCodes: z.array(trimmedNonEmptyStringSchema),
      source: z.enum(["claim_diagnostics", "not_checked"]),
    }),
    providerAccount: z.strictObject({
      blocked: z.boolean(),
      expiresAtMs: z.number().int().nonnegative().nullable(),
      observedAtMs: z.number().int().nonnegative().nullable(),
      provider: z.union([
        openMeldDaemonProviderAccessEvidenceProviderSchema,
        z.null(),
      ]),
      reasonCodes: z.array(trimmedNonEmptyStringSchema),
      source: z.enum(["not_checked", "wake_failure"]),
    }),
    providerConversation: z.strictObject({
      agentControllerConversationId: nullableTrimmedStringSchema,
      errorCode: nullableTrimmedStringSchema,
      errorMessage: nullableTrimmedStringSchema,
      errorType: nullableTrimmedStringSchema,
      expiresAtMs: z.number().int().nonnegative().nullable(),
      method: z.union([
        z.enum([
          "codex_app_server_thread_resume",
          "codex_app_server_thread_read",
        ]),
        z.null(),
      ]),
      observedAtMs: z.number().int().nonnegative().nullable(),
      provider: z.union([z.literal("codex"), z.null()]),
      ready: z.boolean(),
      reasonCodes: z.array(trimmedNonEmptyStringSchema),
      required: z.boolean(),
      source: z.enum(["not_required", "runtime_reporting", "unavailable"]),
      status: z.enum([
        "failed",
        "missing",
        "not_required",
        "passed",
        "unavailable",
      ]),
    }),
    readinessImpact: z.strictObject({
      blocked: z.boolean(),
      expiresAtMs: z.number().int().nonnegative().nullable(),
      impactKind: z.union([agentExecutionReadinessImpactKindSchema, z.null()]),
      observedAtMs: z.number().int().nonnegative().nullable(),
      reasonCodes: z.array(trimmedNonEmptyStringSchema),
      source: z.union([
        z.literal("not_checked"),
        agentExecutionReadinessImpactSourceSchema,
      ]),
    }),
    localService: z.strictObject({
      reachable: z.boolean(),
      refreshable: z.boolean(),
      reasonCodes: z.array(trimmedNonEmptyStringSchema),
      source: z.enum(["runtime_transport", "not_checked", "unavailable"]),
    }),
    service: z.strictObject({
      executionCompatible: z.boolean(),
      expectedEpoch: trimmedNonEmptyStringSchema,
      observedEpoch: z.union([trimmedNonEmptyStringSchema, z.null()]),
      reasonCodes: z.array(trimmedNonEmptyStringSchema),
      source: z.enum(["runtime_transport", "not_checked", "unavailable"]),
    }),
    route: z.strictObject({
      deviceId: nullableTrimmedStringSchema,
      lane: z.union([daemonServiceLaneSchema, z.null()]),
      observedAt: nullableIsoDateTimeSchema,
      online: z.boolean(),
      reasonCodes: z.array(trimmedNonEmptyStringSchema),
      source: z.enum([
        "daemon_route",
        "hosted_route",
        "missing",
        "not_checked",
      ]),
    }),
    runtime: z.strictObject({
      ready: z.boolean(),
      reasonCodes: z.array(trimmedNonEmptyStringSchema),
      source: z.enum([
        "missing",
        "native_runtime",
        "not_checked",
        "prepare_readiness",
      ]),
    }),
  }),
  primaryAction: agentExecutionReadinessPrimaryActionSchema,
  reasonCodes: z.array(trimmedNonEmptyStringSchema),
});

// Unversioned readers only understand resume proofs. Null leaves the method
// unspecified without misrepresenting a read as a resume or hiding its outcome.
export function projectProviderConversationProofMethod(
  method: RuntimeProviderConversationProofMethod | null,
  responseVersion?: AgentExecutionReadinessResponseOptions["responseVersion"]
): RuntimeProviderConversationProofMethod | null {
  return responseVersion === 2 || method === "codex_app_server_thread_resume"
    ? method
    : null;
}

export const getAgentExecutionReadinessResponseSchema = z.strictObject({
  usageLimits: agentControllerUsageLimitsSchema.optional(),
  agentExecutionReadiness: agentExecutionReadinessSchema,
  agentWakeAvailability: agentWakeAvailabilitySchema,
  agentWakeRouteRegistration: agentWakeRouteRegistrationSchema,
  agentProfileId: agentProfileIdSchema,
  agentControllerRef: nullableTrimmedStringSchema,
  generatedAt: ISO_DATE_TIME_SCHEMA,
  ownerUserId: nullableTrimmedStringSchema,
  primaryBinding: agentProfileBindingProjectionSchema.nullable().optional(),
  primaryActionPlan: agentExecutionReadinessPrimaryActionPlanSchema,
  profileName: nullableTrimmedStringSchema,
  // The one public blocking reason Organization members may see; absent or
  // null when current evidence names none.
  publicWakeabilityReason: publicWakeabilityReasonSchema.nullable().optional(),
  publicProfileConfiguration: z
    .strictObject({
      agentControllerCollaborationMode:
        agentProfileBindingAgentControllerCollaborationModeSchema.nullable(),
      agentControllerPermissionMode:
        agentProfileBindingAgentControllerPermissionModeSchema.nullable(),
      agentControllerRef: nullableTrimmedStringSchema,
      modelSelection: agentProfileBindingModelSelectionSchema.nullable(),
    })
    .optional(),
  routeDeviceId: nullableTrimmedStringSchema,
  routeLane: z.union([daemonServiceLaneSchema, z.null()]),
  runtimeDeviceDisplayName: nullableTrimmedStringSchema,
  wakeRouteEvidence: wakeRouteEvidenceSchema,
  wakeRouteStatus: wakeRouteStatusSchema,
});

export const getAgentExecutionReadinessBatchResponseSchema = z.strictObject({
  items: z.array(getAgentExecutionReadinessResponseSchema),
});
