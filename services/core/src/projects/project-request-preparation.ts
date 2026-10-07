import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import { openMeldRequestContextSchema } from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
import { requireExpectedOrganizationContext } from "../organizations/expected-organization-context";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import { createCoreRpcHttpError } from "../rpc/errors";
import { parseProjectPayload } from "./project-rpc-contract";
import { createProjectService } from "./project-service";
export async function prepareHumanProjectRequest(
  env: CoreBindings,
  contextInput: OpenMeldRequestContext | undefined
) {
  const context = parseProjectPayload(
    openMeldRequestContextSchema,
    contextInput
  );
  const membership = await resolveActiveOrganizationMembership({
    context,
    env,
  });
  if (!membership.ok) {
    throw createCoreRpcHttpError({
      code: membership.code,
      reason: membership.message,
      status: membership.status,
    });
  }
  if (context.actorContext.profileKind !== "human") {
    throw memberActorRequiredError();
  }
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "project.store_unavailable",
      reason: "Project storage is unavailable.",
      status: 503,
    });
  }
  await requireHumanProfileAuthority({
    db,
    profileId: context.actorContext.openMeldProfileId,
    userId: membership.userId,
  });
  return {
    authority: {
      organizationId: membership.organizationId,
      role: membership.role,
      userId: membership.userId,
    },
    service: createProjectService({ db }),
  };
}
export async function prepareExpectedHumanProjectRequest(
  env: CoreBindings,
  input: {
    context: OpenMeldRequestContext | undefined;
    expectedOrganizationId: string;
  }
) {
  const prepared = await prepareHumanProjectRequest(env, input.context);
  requireExpectedOrganizationContext({
    actualOrganizationId: prepared.authority.organizationId,
    errorCode: "project.organization_context_changed",
    expectedOrganizationId: input.expectedOrganizationId,
  });
  return prepared;
}
async function requireHumanProfileAuthority(input: {
  db: PostgresDatabase;
  profileId: string;
  userId: string;
}): Promise<void> {
  const profile = await input.db
    .query<{
      present: number;
    }>({
      text: `
        SELECT 1 AS present
        FROM "openmeld"."openmeld_profiles"
        WHERE profile_id = $1
          AND owner_user_id = $2
          AND profile_kind = 'human'
          AND status = 'active'
        LIMIT 1
      `,
      values: [input.profileId, input.userId],
    })
    .then((result) => result.rows[0] ?? null);
  if (profile?.present !== 1) {
    throw memberActorRequiredError();
  }
}
function memberActorRequiredError(): Error {
  return createCoreRpcHttpError({
    code: "project.member_actor_required",
    reason: "A verified active human Organization member is required.",
    status: 403,
  });
}
