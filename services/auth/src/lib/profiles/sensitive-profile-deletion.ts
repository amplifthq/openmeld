import {
  hasBearerAuthorization,
  isCliCredentialSessionRecord,
} from "@openmeld/auth/server";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
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
  input: {
    profileId: string;
    user: { email?: unknown; id: unknown; name?: unknown };
  }
): Promise<AgentProfileDeletionGuard | Response> {
  if (!MEMBER_AGENTS_ENABLED) {
    return NO_GUARD;
  }
  const userId = String(input.user.id);
  let profile: Awaited<
    ReturnType<AppContext["Variables"]["profileService"]["resolveProfileById"]>
  >;
  let humanProfileId: string;
  try {
    profile = await c.var.profileService.resolveProfileById(input.profileId);
    // The signed-in account is its own root for Web, App and CLI requests.
    humanProfileId = (
      await c.var.profileService.ensurePrimaryHumanProfile({
        userEmail: typeof input.user.email === "string" ? input.user.email : "",
        userId,
        userName: typeof input.user.name === "string" ? input.user.name : "",
      })
    ).profileId;
  } catch {
    // An unreadable target must not skip the gate.
    return unavailable(c);
  }
  if (
    !(
      profile &&
      profile.profileKind === "agent" &&
      profile.organizationId &&
      profile.ownerUserId === userId
    )
  ) {
    // Not a personal Agent the caller owns: the deletion itself refuses it.
    return NO_GUARD;
  }
  const core = c.env.OPENMELD_CORE_WORKER;
  const credential = await confirmInteractiveSession(
    c,
    readRequestCredential(c)
  );
  if (!core) {
    return unavailable(c);
  }
  if (!credential) {
    return c.json(
      {
        ok: false,
        code: "bad_request",
        message: "The task credential is malformed.",
      },
      400
    );
  }
  const actor = {
    humanProfileId,
    organizationId: profile.organizationId,
    userId,
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

function unavailable(c: Context<AppContext>): Response {
  return c.json(
    {
      ok: false,
      code: "sensitive_operation.store_unavailable",
      message: "OpenMeld could not check this change right now.",
    },
    503
  );
}

/**
 * The cookie cache can predate the CLI marker, so an interactive session is
 * re-read from the database before it counts as one.
 */
async function confirmInteractiveSession(
  c: Context<AppContext>,
  credential: RequestCredential | null
): Promise<RequestCredential | null> {
  if (credential?.kind !== "interactive_session") {
    return credential;
  }
  const sessionId = c.var.session?.id;
  if (!sessionId) {
    return { ...credential, kind: "cli_credential" };
  }
  const unmarked = await getPostgresDatabase(c.env)
    .query<{ cli_credential_at: string | number | null }>({
      text: `SELECT cli_credential_at FROM "openmeld"."sessions" WHERE id = $1`,
      values: [sessionId],
    })
    .then(
      (result) =>
        result.rows.length === 1 && result.rows[0]?.cli_credential_at === null
    )
    .catch(() => false);
  return unmarked ? credential : { ...credential, kind: "cli_credential" };
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
