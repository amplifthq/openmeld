import * as z from "zod/v4";
import { runtimeCoordinatorExecutionTokenEchoSchema } from "../daemon/runtime-coordinator-execution-token";

// Credentials for sensitive operations (design-plans/member-agent-program.md
// §4.7, §6). A sensitive operation accepts a task credential whose chain root
// is the Profile owner, or the owner's own Web or App session. The CLI login
// credential passes unless a task whose root is not the owner is running;
// then the owner confirms in the Inbox. Every decision is audited.

const identifierSchema = z.string().trim().min(1).max(256);

export const CREDENTIAL_CONFIRMATION_ROUTE =
  "/v1/credential-confirmations/:confirmationId";
export const CREDENTIAL_CONFIRMATION_DECISION_ROUTE =
  "/v1/credential-confirmations/:confirmationId/decision";
// Under the current Organization, like the other Gateway MemberAgent routes,
// so it never collides with Auth's `/v1/member-agents`.
export const MEMBER_AGENT_SENSITIVE_OPERATION_AUDIT_ROUTE =
  "/v1/organizations/current/member-agents/:memberAgentId/sensitive-operation-audit";

export const CREDENTIAL_CONFIRMATION_REQUIRED_CODE =
  "credential_confirmation.required";
export const CREDENTIAL_CONFIRMATION_DECLINED_CODE =
  "credential_confirmation.declined";
export const TASK_CREDENTIAL_REJECTED_CODE = "task_credential.rejected";
export const SENSITIVE_OPERATION_ROOT_NOT_OWNER_CODE =
  "sensitive_operation.root_not_owner";
export const SENSITIVE_OPERATION_SOURCE_REQUIRED_CODE =
  "sensitive_operation.source_required";

const CONFIRMATION_ID_IN_MESSAGE_PATTERN =
  /\(confirmation ([A-Za-z0-9_-]{16,256})\)/u;

/**
 * The credential_confirmation.required message names the confirmation, so a
 * client that reuses a pending one (a repeated command) polls the right id.
 */
export function formatCredentialConfirmationRequiredMessage(
  confirmationId: string
): string {
  return `Confirm this change in your OpenMeld Inbox (confirmation ${confirmationId}). A task requested by someone else is running on your computer.`;
}

export function readCredentialConfirmationIdFromMessage(
  message: unknown
): string | null {
  return typeof message === "string"
    ? (CONFIRMATION_ID_IN_MESSAGE_PATTERN.exec(message)?.[1] ?? null)
    : null;
}

/** A confirmation is answered and used within this window. */
export const CREDENTIAL_CONFIRMATION_TTL_MS = 10 * 60 * 1000;
export const SENSITIVE_OPERATION_AUDIT_LIST_LIMIT = 100;

/**
 * How the signed-in account authenticated this request.
 * - `interactive_session`: a Web or App session that was never handed to a
 *   CLI.
 * - `cli_credential`: a session token held by a CLI (device login, a
 *   one-time-token login, or any Bearer use), or an API key.
 */
export const requestCredentialKindSchema = z.enum([
  "interactive_session",
  "cli_credential",
]);
export type RequestCredentialKind = z.infer<typeof requestCredentialKindSchema>;

/**
 * The credential facts the Gateway passes to Core for a sensitive operation
 * only. The task credential is the task's RuntimeCoordinator execution token;
 * it never enters the general request context.
 */
export const requestCredentialSchema = z.strictObject({
  confirmationId: identifierSchema.optional(),
  kind: requestCredentialKindSchema,
  taskCredential: runtimeCoordinatorExecutionTokenEchoSchema.optional(),
});
export type RequestCredential = z.infer<typeof requestCredentialSchema>;

export const sensitiveOperationSchema = z.enum([
  "binding_ensure",
  "binding_disable",
  "binding_model_selection",
  "binding_permission_mode",
  "binding_collaboration_mode",
  "binding_opencode_permission",
  "creation_defaults_write",
  "default_project_write",
  "working_folder_write",
  "execution_mode_write",
  "work_recovery",
  "agent_interaction_answer",
  "space_members_add_agent",
  "space_delete",
  "agent_access_decision",
  "agent_access_grant_revoke",
  "profile_delete",
  "session_archive",
  "session_delete",
  "runtime_settings_write",
]);
export type SensitiveOperation = z.infer<typeof sensitiveOperationSchema>;

/**
 * `center_agent`: the Center Agent acting for a verified member; its root is
 * checked at the tool boundary (§6, Center Agent runtime-settings write).
 */
export const sensitiveOperationSourceKindSchema = z.enum([
  "task_credential",
  "web_session",
  "cli_credential",
  "center_agent",
]);
export type SensitiveOperationSourceKind = z.infer<
  typeof sensitiveOperationSourceKindSchema
>;

export const sensitiveOperationOutcomeSchema = z.enum([
  "succeeded",
  "failed",
  "rejected",
  "confirmation_required",
  "declined",
]);
export type SensitiveOperationOutcome = z.infer<
  typeof sensitiveOperationOutcomeSchema
>;

export const credentialConfirmationStatusSchema = z.enum([
  "pending",
  "approved",
  "declined",
  "consumed",
  "expired",
]);
export type CredentialConfirmationStatus = z.infer<
  typeof credentialConfirmationStatusSchema
>;

export const credentialConfirmationDecisionSchema = z.enum([
  "approve",
  "decline",
]);
export type CredentialConfirmationDecision = z.infer<
  typeof credentialConfirmationDecisionSchema
>;

export const credentialConfirmationViewSchema = z.strictObject({
  id: identifierSchema,
  operation: sensitiveOperationSchema,
  agentProfileId: identifierSchema.nullable(),
  agentProfileName: z.string().trim().min(1).max(200).nullable(),
  status: credentialConfirmationStatusSchema,
  createdAtMs: z.number().int().nonnegative(),
  expiresAtMs: z.number().int().nonnegative(),
  decidedAtMs: z.number().int().nonnegative().nullable(),
});
export type CredentialConfirmationView = z.infer<
  typeof credentialConfirmationViewSchema
>;

export const credentialConfirmationRouteParamsSchema = z.strictObject({
  confirmationId: identifierSchema,
});

export const getCredentialConfirmationResponseSchema = z.strictObject({
  confirmation: credentialConfirmationViewSchema,
});
export type GetCredentialConfirmationResponse = z.infer<
  typeof getCredentialConfirmationResponseSchema
>;

export const decideCredentialConfirmationBodySchema = z.strictObject({
  decision: credentialConfirmationDecisionSchema,
});
export type DecideCredentialConfirmationBody = z.infer<
  typeof decideCredentialConfirmationBodySchema
>;

export const decideCredentialConfirmationResponseSchema =
  getCredentialConfirmationResponseSchema;
export type DecideCredentialConfirmationResponse =
  GetCredentialConfirmationResponse;

export const sensitiveOperationAuditEventSchema = z.strictObject({
  id: identifierSchema,
  operation: sensitiveOperationSchema,
  agentProfileId: identifierSchema.nullable(),
  sourceKind: sensitiveOperationSourceKindSchema,
  actorUserId: identifierSchema,
  chainRootProfileId: identifierSchema.nullable(),
  outcome: sensitiveOperationOutcomeSchema,
  reasonCode: z.string().trim().min(1).max(160).nullable(),
  confirmationId: identifierSchema.nullable(),
  createdAtMs: z.number().int().nonnegative(),
});
export type SensitiveOperationAuditEvent = z.infer<
  typeof sensitiveOperationAuditEventSchema
>;

export const memberAgentSensitiveOperationAuditRouteParamsSchema =
  z.strictObject({
    memberAgentId: identifierSchema,
  });

export const listSensitiveOperationAuditResponseSchema = z.strictObject({
  events: z
    .array(sensitiveOperationAuditEventSchema)
    .max(SENSITIVE_OPERATION_AUDIT_LIST_LIMIT),
});
export type ListSensitiveOperationAuditResponse = z.infer<
  typeof listSensitiveOperationAuditResponseSchema
>;

const reasonCodeSchema = z.string().trim().min(1).max(160);

/**
 * RuntimeCoordinator's answer for one task credential: the execution it
 * belongs to and the root of that Wake's frozen request chain. Core never
 * reads a root from the caller.
 */
export const taskCredentialResolutionSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("valid"),
    runtimeCoordinatorExecutionId: identifierSchema,
    targetProfileId: identifierSchema,
    openMeldServiceRuntimeId: identifierSchema,
    rootProfileId: identifierSchema.nullable(),
  }),
  z.strictObject({
    status: z.literal("rejected"),
    reasonCode: reasonCodeSchema,
  }),
]);
export type TaskCredentialResolution = z.infer<
  typeof taskCredentialResolutionSchema
>;

export const RISK_WINDOW_EXECUTION_LIMIT = 1024;

/**
 * The owner's running tasks (execution-linked Wake heads) with their chain
 * roots, for the CLI-credential risk window (member-agent-program.md §4.7
 * item 3; decision 5a0 in member-agent-program-reviews/5-credentials.md).
 */
export const riskWindowExecutionsResponseSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("ready"),
      executions: z
        .array(
          z.strictObject({
            targetProfileId: identifierSchema,
            openMeldServiceRuntimeId: identifierSchema.nullable(),
            rootProfileId: identifierSchema.nullable(),
          })
        )
        .max(RISK_WINDOW_EXECUTION_LIMIT),
    }),
    z.strictObject({
      status: z.literal("unavailable"),
      reasonCode: reasonCodeSchema,
    }),
  ]
);
export type RiskWindowExecutionsResponse = z.infer<
  typeof riskWindowExecutionsResponseSchema
>;

/** How Core decided one sensitive operation; the outcome row repeats it. */
export const sensitiveOperationDecisionSchema = z.strictObject({
  chainRootProfileId: identifierSchema.nullable(),
  confirmationId: identifierSchema.nullable(),
  sourceKind: sensitiveOperationSourceKindSchema,
  taskExecutionId: identifierSchema.nullable(),
});
export type SensitiveOperationDecision = z.infer<
  typeof sensitiveOperationDecisionSchema
>;

const sensitiveOperationActorSchema = z.strictObject({
  humanProfileId: identifierSchema.nullable(),
  organizationId: identifierSchema,
  userId: identifierSchema,
});

/**
 * Auth asks Core before a sensitive operation Auth performs itself (Agent
 * Profile deletion), so one gate decides every source.
 */
export const sensitiveOperationAuthorizationInputSchema = z.strictObject({
  actor: sensitiveOperationActorSchema,
  agentProfileId: identifierSchema.nullable(),
  credential: requestCredentialSchema,
  digestInput: z.unknown(),
  operation: sensitiveOperationSchema,
});
export type SensitiveOperationAuthorizationInput = z.infer<
  typeof sensitiveOperationAuthorizationInputSchema
>;

export const sensitiveOperationAuthorizationSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({ status: z.literal("not_enforced") }),
    z.strictObject({
      decision: sensitiveOperationDecisionSchema,
      status: z.literal("allowed"),
    }),
    z.strictObject({
      code: reasonCodeSchema,
      httpStatus: z.number().int().min(400).max(599),
      message: z.string().trim().min(1).max(500),
      status: z.literal("refused"),
    }),
  ]
);
export type SensitiveOperationAuthorization = z.infer<
  typeof sensitiveOperationAuthorizationSchema
>;

export const sensitiveOperationOutcomeInputSchema = z.strictObject({
  actor: sensitiveOperationActorSchema,
  agentProfileId: identifierSchema.nullable(),
  decision: sensitiveOperationDecisionSchema,
  operation: sensitiveOperationSchema,
  outcome: z.enum(["succeeded", "failed"]),
  reasonCode: reasonCodeSchema.nullable(),
});
export type SensitiveOperationOutcomeInput = z.infer<
  typeof sensitiveOperationOutcomeInputSchema
>;
