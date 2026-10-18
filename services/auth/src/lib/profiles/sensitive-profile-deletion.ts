import {
  hasBearerAuthorization,
  isCliCredentialSessionRecord,
} from "@openmeld/auth/server";
import {
  readCredentialConfirmationHeader,
  readTaskCredentialHeader,
} from "@openmeld/gateway-contract";
import {
  MEMBER_AGENTS_ENABLED,
  type RequestCredential,
  type SensitiveOperationDecision,
  sensitiveOperationAuthorizationSchema,
} from "@openmeld/schemas";
import type { Context } from "hono";
import type { AppContext } from "../context";

// Deleting an Agent Profile is a sensitive operation (member-agent-program.md
// §6). Auth performs it, so it asks Core's gate first and reports the outcome:
// one gate decides every source, and every decision is audited.

export type AgentProfileDeletionGuard = {
  record(
    outcome: "failed" | "succeeded",
    reasonCode?: string | null
  ): Promise<void>;
};

const NO_GUARD: AgentProfileDeletionGuard = {
  record: async () => undefined,
};

/** Null-object guard when the target is not an Agent Profile in an Organization. */
export async function guardAgentProfileDeletion(
  c: Context<AppContext>,
  input: { profileId: string; userId: string }
): Promise<AgentProfileDeletionGuard | Response> {
  if (!MEMBER_AGENTS_ENABLED) {
    return NO_GUARD;
  }
  const profile = await c.var.profileService
    .resolveProfileById(input.profileId)
    .catch(() => null);
  if (
    !(
      profile &&
      profile.profileKind === "agent" &&
      profile.organizationId &&
      profile.ownerUserId === input.userId
    )
  ) {
    // Not a personal Agent the caller owns: the deletion itself refuses it.
    return NO_GUARD;
  }
  const core = c.env.OPENMELD_CORE_WORKER;
  const credential = readRequestCredential(c);
  if (!(core && credential)) {
    return c.json(
      {
        ok: false,
        code: core ? "bad_request" : "sensitive_operation.store_unavailable",
        message: core
          ? "The task credential is malformed."
          : "OpenMeld could not check this change right now.",
      },
      core ? 400 : 503
    );
  }
  const actor = {
    humanProfileId: null,
    organizationId: profile.organizationId,
    userId: input.userId,
  };
  const request = {
    agentProfileId: profile.profileId,
    operation: "profile_delete" as const,
  };
  const authorization = sensitiveOperationAuthorizationSchema.parse(
    await core.authorizeSensitiveOperation({
      ...request,
      actor,
      credential,
      digestInput: { profileId: profile.profileId },
    })
  );
  if (authorization.status === "not_enforced") {
    return NO_GUARD;
  }
  if (authorization.status === "refused") {
    return c.json(
      { ok: false, code: authorization.code, message: authorization.message },
      authorization.httpStatus as 400
    );
  }
  const decision: SensitiveOperationDecision = authorization.decision;
  return {
    record: async (outcome, reasonCode = null) => {
      try {
        await core.recordSensitiveOperationOutcome({
          ...request,
          actor,
          decision,
          outcome,
          reasonCode,
        });
      } catch (error) {
        // The deletion already happened or failed; report, never reverse it.
        console.error("[auth.sensitive_operation.audit_failed]", {
          agentProfileId: request.agentProfileId,
          error: error instanceof Error ? error.message : String(error),
          event: "auth.sensitive_operation.audit_failed",
          operation: request.operation,
          outcome,
        });
      }
    },
  };
}

/** The same classification the Gateway receives from Auth's claims. */
function readRequestCredential(
  c: Context<AppContext>
): RequestCredential | null {
  const headers = c.req.raw.headers;
  const taskCredential = readTaskCredentialHeader(headers);
  if (taskCredential.status === "invalid") {
    return null;
  }
  const confirmationId = readCredentialConfirmationHeader(headers);
  return {
    kind:
      headers.has("x-api-key") ||
      hasBearerAuthorization(headers) ||
      isCliCredentialSessionRecord(c.var.session)
        ? "cli_credential"
        : "interactive_session",
    ...(taskCredential.status === "present"
      ? { taskCredential: taskCredential.taskCredential }
      : {}),
    ...(confirmationId ? { confirmationId } : {}),
  };
}
