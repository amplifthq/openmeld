import * as z from "zod/v4";
import { agentControllerRefSchema } from "../daemon/agent-controller-ref";
import { agentProfileCreationPreferenceSelectionSchema } from "./agent-profile-binding";

const identifierSchema = z.string().trim().min(1).max(256);
const profileNameSchema = z.string().trim().min(1).max(80);
const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const agentProfileCreationApprovalPolicySchema = z.enum([
  "never_allow",
  "ask_every_time",
  "automatically_allow",
]);

export const agentProfileCreationRequestSourceSchema = z.enum([
  "web",
  "cli",
  "local_agent",
  "center_agent",
]);

export const agentProfileCreationSessionStrategySchema = z.enum([
  "new",
  "resume",
  "fork",
]);

export const agentProfileCreationRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "declined",
  "cancelled",
  "completed",
  "failed",
]);

export const agentProfileCreationRequestStatusReasonSchema = z.enum([
  "approval_required",
  "automatically_allowed",
  "self_request",
  "target_policy_denied",
  "target_approved",
  "target_declined",
  "requester_cancelled",
  "profile_created",
  "profile_creation_failed",
]);

const completeAgentProfileCreationConfigurationSchema =
  agentProfileCreationPreferenceSelectionSchema
    .safeExtend({
      agentControllerRef: agentControllerRefSchema.nullable(),
      authorizeForOrganization: z.boolean(),
      targetComputerId: identifierSchema.nullable(),
    })
    .superRefine((configuration, context) => {
      const hasController = configuration.agentControllerRef !== null;
      const hasComputer = configuration.targetComputerId !== null;
      if (hasController !== hasComputer) {
        context.addIssue({
          code: "custom",
          message:
            "agentControllerRef and targetComputerId must be provided together.",
          path: hasController ? ["targetComputerId"] : ["agentControllerRef"],
        });
      }
      if (
        configuration.reasoningLevel !== null &&
        configuration.modelId === null
      ) {
        context.addIssue({
          code: "custom",
          message: "reasoningLevel requires modelId.",
          path: ["reasoningLevel"],
        });
      }
      if (!hasController) {
        const controllerSetting = [
          configuration.agentControllerCollaborationMode,
          configuration.agentControllerPermissionMode,
          configuration.modelId,
          configuration.openCodePermission,
          configuration.reasoningLevel,
        ].find((value) => value !== null);
        if (controllerSetting !== undefined) {
          context.addIssue({
            code: "custom",
            message: "Local agent settings require an Agent Controller.",
            path: ["agentControllerRef"],
          });
        }
      }
    });

export const agentProfileCreationConfigurationSchema = z.preprocess(
  addMissingAgentControllerCollaborationMode,
  completeAgentProfileCreationConfigurationSchema
);

function addMissingAgentControllerCollaborationMode(value: unknown): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.hasOwn(value, "agentControllerCollaborationMode")
  ) {
    return value;
  }
  return { ...value, agentControllerCollaborationMode: null };
}

export const DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION = {
  agentControllerCollaborationMode: null,
  agentControllerPermissionMode: null,
  agentControllerRef: null,
  authorizeForOrganization: true,
  defaultProjectId: null,
  modelId: null,
  openCodePermission: null,
  reasoningLevel: null,
  targetComputerId: null,
} as const;

export const agentProfileCreationRequestSchema = z
  .strictObject({
    actorProfileId: identifierSchema,
    completedAt: isoDateTimeSchema.nullable(),
    configuration: agentProfileCreationConfigurationSchema,
    createdAgentProfileId: identifierSchema.nullable(),
    createdAt: isoDateTimeSchema,
    decidedAt: isoDateTimeSchema.nullable(),
    id: identifierSchema,
    failureMessage: z.string().trim().min(1).max(1000).nullable(),
    nativeSessionId: identifierSchema.nullable(),
    organizationId: identifierSchema,
    profileName: profileNameSchema,
    requestedSpaceId: identifierSchema.nullable(),
    requesterUserId: identifierSchema,
    sessionStrategy: agentProfileCreationSessionStrategySchema,
    source: agentProfileCreationRequestSourceSchema,
    status: agentProfileCreationRequestStatusSchema,
    statusReason: agentProfileCreationRequestStatusReasonSchema,
    targetOwnerUserId: identifierSchema,
    updatedAt: isoDateTimeSchema,
  })
  .superRefine((request, context) => {
    if (request.sessionStrategy === "new" && request.nativeSessionId !== null) {
      context.addIssue({
        code: "custom",
        message: "New-session requests cannot include nativeSessionId.",
        path: ["nativeSessionId"],
      });
    }
    if (request.sessionStrategy !== "new" && request.nativeSessionId === null) {
      context.addIssue({
        code: "custom",
        message: "Resume and fork requests require nativeSessionId.",
        path: ["nativeSessionId"],
      });
    }
    if (
      request.status === "completed" &&
      request.createdAgentProfileId === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Completed requests require a created Agent Profile.",
        path: ["createdAgentProfileId"],
      });
    }
    if ((request.status === "completed") !== (request.completedAt !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only completed requests can have a completion time.",
        path: ["status"],
      });
    }
    if ((request.status === "failed") !== (request.failureMessage !== null)) {
      context.addIssue({
        code: "custom",
        message: "Failed requests require a failure message.",
        path: ["failureMessage"],
      });
    }
  });

export const createAgentProfileCreationRequestBodySchema = z
  .strictObject({
    configuration: agentProfileCreationConfigurationSchema.optional(),
    idempotencyKey: identifierSchema,
    nativeSessionId: identifierSchema.nullable().optional(),
    profileName: profileNameSchema,
    requestedSpaceId: identifierSchema.nullable().optional(),
    sessionStrategy: agentProfileCreationSessionStrategySchema,
    source: agentProfileCreationRequestSourceSchema,
    targetOwnerUserId: identifierSchema,
  })
  .superRefine((request, context) => {
    const nativeSessionId = request.nativeSessionId ?? null;
    if (request.sessionStrategy === "new" && nativeSessionId !== null) {
      context.addIssue({
        code: "custom",
        message: "New-session requests cannot include nativeSessionId.",
        path: ["nativeSessionId"],
      });
    }
    if (request.sessionStrategy !== "new" && nativeSessionId === null) {
      context.addIssue({
        code: "custom",
        message: "Resume and fork requests require nativeSessionId.",
        path: ["nativeSessionId"],
      });
    }
  });

export const createAgentProfileCreationRequestResponseSchema = z.strictObject({
  replayed: z.boolean(),
  request: agentProfileCreationRequestSchema,
});

export const listAgentProfileCreationRequestsResponseSchema = z.strictObject({
  organizationId: identifierSchema,
  requests: z.array(agentProfileCreationRequestSchema).max(200),
});

export const decideAgentProfileCreationRequestBodySchema = z.strictObject({
  decision: z.enum(["approve", "decline"]),
});

export const agentProfileCreationRequestMutationResponseSchema = z.strictObject(
  {
    request: agentProfileCreationRequestSchema,
  }
);

export const agentProfileCreationApprovalPreferenceSchema = z.strictObject({
  existingSessionPolicy: agentProfileCreationApprovalPolicySchema,
  newSessionPolicy: agentProfileCreationApprovalPolicySchema,
  organizationId: identifierSchema,
  updatedAt: isoDateTimeSchema.nullable(),
  userId: identifierSchema,
});

export const setAgentProfileCreationApprovalPreferenceBodySchema =
  z.strictObject({
    existingSessionPolicy: agentProfileCreationApprovalPolicySchema,
    newSessionPolicy: agentProfileCreationApprovalPolicySchema,
  });

export const getAgentProfileCreationApprovalPreferenceResponseSchema =
  agentProfileCreationApprovalPreferenceSchema;

export const setAgentProfileCreationApprovalPreferenceResponseSchema =
  agentProfileCreationApprovalPreferenceSchema;
