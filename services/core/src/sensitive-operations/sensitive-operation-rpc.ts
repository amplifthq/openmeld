import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import {
  credentialConfirmationRouteParamsSchema,
  type DecideCredentialConfirmationResponse,
  decideCredentialConfirmationBodySchema,
  type GetCredentialConfirmationResponse,
  type ListSensitiveOperationAuditResponse,
  MEMBER_AGENTS_DISABLED_CODE,
  MEMBER_AGENTS_DISABLED_MESSAGE,
  memberAgentSensitiveOperationAuditRouteParamsSchema,
  type RequestCredential,
  SENSITIVE_OPERATION_AUDIT_LIST_LIMIT,
  type SensitiveOperationAuditQuery,
  type SensitiveOperationAuthorization,
  sensitiveOperationAuditQuerySchema,
  sensitiveOperationAuthorizationInputSchema,
  sensitiveOperationAuthorizationSchema,
  sensitiveOperationOutcomeInputSchema,
} from "@openmeld/schemas";
import type { CoreBindings } from "../lib/bindings";
import {
  isMemberAgentsEnabled,
  isRequestChainEnforced,
} from "../member-agent/member-agents-feature";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  type CoreRpcContextInput,
  requireActiveOrganizationMembershipOrThrow,
  requireRpcContext,
} from "../rpc/methods";
import {
  decideCredentialConfirmation,
  readCredentialConfirmationView,
} from "./application/credential-confirmation-service";
import {
  authorizeSensitiveOperation,
  recordSensitiveOperationOutcome,
} from "./application/sensitive-operation-gate";
import {
  asQueryable,
  listMemberAgentSensitiveOperationAudit,
} from "./infrastructure/postgresql/sensitive-operation-repo";

// The owner's side of sensitive operations (design-plans/member-agent-program.md
// §4.7): read and answer a credential confirmation, read the audit.

async function requireOwner(
  env: CoreBindings,
  rawContext: CoreRpcContextInput | undefined
): Promise<{ db: PostgresDatabase; organizationId: string; userId: string }> {
  if (!isMemberAgentsEnabled()) {
    throw createCoreRpcHttpError({
      status: 404,
      code: MEMBER_AGENTS_DISABLED_CODE,
      reason: MEMBER_AGENTS_DISABLED_MESSAGE,
    });
  }
  const context = requireRpcContext(rawContext);
  const membership = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  if (context.actorContext.profileKind !== "human") {
    throw createCoreRpcHttpError({
      status: 403,
      code: "sensitive_operation.human_caller_required",
      reason: "Only a person can do this.",
    });
  }
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      code: "sensitive_operation.store_unavailable",
      reason: "OpenMeld could not read this right now.",
    });
  }
  return {
    db,
    organizationId: membership.organizationId,
    userId: membership.userId,
  };
}

function confirmationNotFound(): Error {
  return createCoreRpcHttpError({
    status: 404,
    code: "credential_confirmation.not_found",
    reason: "This confirmation does not exist.",
  });
}

/** The owner reads a confirmation; the waiting CLI polls the same read. */
export async function rpcGetCredentialConfirmation(
  env: CoreBindings,
  input: { confirmationId: string; context?: CoreRpcContextInput }
): Promise<GetCredentialConfirmationResponse> {
  const owner = await requireOwner(env, input.context);
  const params = credentialConfirmationRouteParamsSchema.safeParse({
    confirmationId: input.confirmationId,
  });
  if (!params.success) {
    throw confirmationNotFound();
  }
  const confirmation = await readCredentialConfirmationView({
    confirmationId: params.data.confirmationId,
    db: owner.db,
    nowMs: Date.now(),
    ownerUserId: owner.userId,
  });
  if (!confirmation) {
    throw confirmationNotFound();
  }
  return { confirmation };
}

/**
 * Only the owner's own Web or App session answers. A CLI credential or a
 * task credential is exactly what the confirmation guards against.
 */
export async function rpcDecideCredentialConfirmation(
  env: CoreBindings,
  input: {
    body: unknown;
    confirmationId: string;
    context?: CoreRpcContextInput;
    requestCredential?: RequestCredential;
  }
): Promise<DecideCredentialConfirmationResponse> {
  const owner = await requireOwner(env, input.context);
  if (
    !(
      input.requestCredential?.kind === "interactive_session" &&
      !input.requestCredential.taskCredential
    )
  ) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "credential_confirmation.interactive_session_required",
      reason: "Answer this in OpenMeld on the web or in the app.",
    });
  }
  const params = credentialConfirmationRouteParamsSchema.safeParse({
    confirmationId: input.confirmationId,
  });
  const body = decideCredentialConfirmationBodySchema.safeParse(input.body);
  if (!params.success) {
    throw confirmationNotFound();
  }
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Choose approve or decline.",
    });
  }
  const result = await decideCredentialConfirmation({
    confirmationId: params.data.confirmationId,
    db: owner.db,
    decision: body.data.decision,
    nowMs: Date.now(),
    ownerUserId: owner.userId,
  });
  if (result.status === "not_found") {
    throw confirmationNotFound();
  }
  if (result.status === "closed") {
    throw createCoreRpcHttpError({
      status: 409,
      code: "credential_confirmation.closed",
      reason:
        result.view.status === "expired"
          ? "This confirmation expired. Run the command again if you still need it."
          : "This confirmation was already answered.",
    });
  }
  return { confirmation: result.view };
}

/** Owner-only: the sensitive operations on the owner's MemberAgent. */
export async function rpcListMemberAgentSensitiveOperationAudit(
  env: CoreBindings,
  input: {
    context?: CoreRpcContextInput;
    memberAgentId: string;
  } & SensitiveOperationAuditQuery
): Promise<ListSensitiveOperationAuditResponse> {
  const owner = await requireOwner(env, input.context);
  const query = sensitiveOperationAuditQuerySchema.safeParse({
    responseVersion: input.responseVersion,
  });
  if (!query.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid audit response version.",
    });
  }
  const params = memberAgentSensitiveOperationAuditRouteParamsSchema.safeParse({
    memberAgentId: input.memberAgentId,
  });
  const events = params.success
    ? await listMemberAgentSensitiveOperationAudit({
        db: asQueryable(owner.db),
        limit: SENSITIVE_OPERATION_AUDIT_LIST_LIMIT,
        memberAgentId: params.data.memberAgentId,
        organizationId: owner.organizationId,
        ownerUserId: owner.userId,
        responseVersion: query.data.responseVersion,
      })
    : null;
  if (!events) {
    throw createCoreRpcHttpError({
      status: 404,
      code: "member_agent.not_found",
      reason: "This Agent does not exist.",
    });
  }
  return { events };
}

/**
 * Auth asks before an Agent Profile deletion it performs itself. Refusals
 * come back as data so Auth answers with the same code the Gateway would.
 */
export async function rpcAuthorizeSensitiveOperation(
  env: CoreBindings,
  raw: unknown
): Promise<SensitiveOperationAuthorization> {
  if (!isRequestChainEnforced()) {
    return { status: "not_enforced" };
  }
  const input = sensitiveOperationAuthorizationInputSchema.parse(raw);
  try {
    const decision = await authorizeSensitiveOperation(env, {
      caller: input.actor,
      credential: input.credential,
      request: {
        agentProfileId: input.agentProfileId,
        digestInput: input.digestInput,
        operation: input.operation,
      },
    });
    return sensitiveOperationAuthorizationSchema.parse({
      decision,
      status: "allowed",
    });
  } catch (error) {
    const refusal = readStructuredRefusal(error);
    if (!refusal) {
      throw error;
    }
    return sensitiveOperationAuthorizationSchema.parse({
      ...refusal,
      status: "refused",
    });
  }
}

export async function rpcRecordSensitiveOperationOutcome(
  env: CoreBindings,
  raw: unknown
): Promise<{ ok: true }> {
  const input = sensitiveOperationOutcomeInputSchema.parse(raw);
  await recordSensitiveOperationOutcome(env, {
    caller: input.actor,
    decision: input.decision,
    outcome: input.outcome,
    reasonCode: input.reasonCode,
    request: {
      agentProfileId: input.agentProfileId,
      operation: input.operation,
    },
  });
  return { ok: true };
}

function readStructuredRefusal(
  error: unknown
): { code: string; httpStatus: number; message: string } | null {
  const cause =
    error && typeof error === "object"
      ? (
          error as {
            cause?: { code?: unknown; message?: unknown; status?: unknown };
          }
        ).cause
      : undefined;
  if (
    typeof cause?.code === "string" &&
    typeof cause.message === "string" &&
    typeof cause.status === "number" &&
    cause.status >= 400
  ) {
    return {
      code: cause.code,
      httpStatus: cause.status,
      message: cause.message.slice(0, 500),
    };
  }
  return null;
}
