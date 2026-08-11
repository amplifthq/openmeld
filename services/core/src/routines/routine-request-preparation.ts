import { openMeldRequestContextSchema } from "@openmeld/schemas";
import type {
  CenterAgentRoutineToolSpeaker,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { prepareCenterAgentRepresentedMemberRequest } from "../center-agent/application/represented-member-request";
import { type CoreBindings, projectionsDb, routineDb } from "../lib/bindings";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import { createCoreRpcHttpError } from "../rpc/errors";
import { parseRoutinePayload } from "./routine-rpc-contract";
import { createRoutineService, type RoutineActor } from "./routine-service";

type PreparedRoutineRequest = {
  actor: RoutineActor;
  representedHuman: {
    profileId: string;
    userId: string;
  };
  service: ReturnType<typeof createRoutineService>;
};

export async function prepareHumanRoutineRequest(
  env: CoreBindings,
  contextInput: OpenMeldRequestContext | undefined
): Promise<PreparedRoutineRequest> {
  const context = parseRoutinePayload(
    openMeldRequestContextSchema,
    contextInput
  );
  const membership = await resolveActiveOrganizationMembership({
    context,
    env,
  });
  if (!membership.ok) {
    throw createCoreRpcHttpError({
      status: membership.status,
      reason: membership.message,
      code: membership.code,
    });
  }
  if (context.actorContext.profileKind !== "human") {
    throw memberActorRequiredError();
  }
  const stores = requireRoutineStores(env);
  await requireHumanProfileAuthority({
    db: stores.db,
    profileId: context.actorContext.openMeldProfileId,
    userId: membership.userId,
  });
  return {
    actor: {
      attribution: {
        actorProfileId: context.actorContext.openMeldProfileId,
        onBehalfOf: null,
      },
      authority: {
        organizationId: membership.organizationId,
        role: membership.role,
        userId: membership.userId,
      },
      sourceNativeDeliveryId: null,
    },
    representedHuman: {
      profileId: context.actorContext.openMeldProfileId,
      userId: membership.userId,
    },
    service: createRoutineService(stores),
  };
}

export async function prepareCenterAgentRoutineRequest(
  env: CoreBindings,
  context: OpenMeldRequestContext,
  speakerMember: CenterAgentRoutineToolSpeaker
): Promise<PreparedRoutineRequest> {
  const {
    authorization: centerAgent,
    representedHuman,
    sourceNativeDeliveryId,
  } = await prepareCenterAgentRepresentedMemberRequest(
    env,
    context,
    speakerMember,
    {
      code: "routine.member_actor_required",
      reason: "A verified active human Organization member is required.",
    }
  );
  const stores = requireRoutineStores(env);
  return {
    actor: {
      attribution: {
        actorProfileId: centerAgent.actorProfileId,
        onBehalfOf: {
          displayName: representedHuman.displayName,
          profileId: representedHuman.profileId,
          userId: representedHuman.userId,
        },
      },
      authority: {
        organizationId: centerAgent.activeOrganization.organizationId,
        role: representedHuman.role,
        userId: representedHuman.userId,
      },
      sourceNativeDeliveryId,
    },
    representedHuman: {
      profileId: representedHuman.profileId,
      userId: representedHuman.userId,
    },
    service: createRoutineService(stores),
  };
}

async function requireHumanProfileAuthority(input: {
  db: D1Database;
  profileId: string;
  userId: string;
}): Promise<void> {
  const profile = await input.db
    .prepare(
      `
        SELECT 1 AS present
        FROM openmeld_profiles
        WHERE profile_id = ?
          AND owner_user_id = ?
          AND profile_kind = 'human'
          AND status = 'active'
        LIMIT 1
      `
    )
    .bind(input.profileId, input.userId)
    .first<{ present: number }>();
  if (profile?.present !== 1) {
    throw memberActorRequiredError();
  }
}

function requireRoutineStores(env: CoreBindings) {
  const db = routineDb(env);
  const projectionStore = projectionsDb(env);
  if (!(db && projectionStore)) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Routine storage is unavailable.",
      code: "routine.store_unavailable",
    });
  }
  return { db, projectionsDb: projectionStore };
}

function memberActorRequiredError(override?: {
  code: string;
  reason: string;
}): Error {
  return createCoreRpcHttpError({
    status: 403,
    reason:
      override?.reason ??
      "A verified active human Organization member is required.",
    code: override?.code ?? "routine.member_actor_required",
  });
}
