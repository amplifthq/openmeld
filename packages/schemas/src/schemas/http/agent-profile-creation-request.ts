import { z } from "zod/v4";

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

export const agentProfileCreationRequestSchema = z
  .strictObject({
    actorProfileId: identifierSchema,
    completedAt: isoDateTimeSchema.nullable(),
    createdAgentProfileId: identifierSchema.nullable(),
    createdAt: isoDateTimeSchema,
    decidedAt: isoDateTimeSchema.nullable(),
    id: identifierSchema,
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
      (request.status === "completed") !==
      (request.createdAgentProfileId !== null && request.completedAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Completed requests require a created Agent Profile and completion time.",
        path: ["status"],
      });
    }
  });

export const createAgentProfileCreationRequestBodySchema = z
  .strictObject({
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
