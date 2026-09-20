import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { type CoreBindings, identityDb } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  type CenterAgentDesignationRecord,
  isCenterAgentDesignationActive,
  readCenterAgentDesignationRecord,
} from "./center-agent-repository";

export type CurrentDesignatedCenterAgentProfile = {
  managedRole: string | null;
  organizationId: string | null;
  ownerUserId: string | null;
  profileId: string;
  profileKind: "agent" | "human" | "system";
  profileName: string;
  status: "active" | "disabled";
};

export type CurrentDesignatedCenterAgentAuthorization = {
  activeOrganization: {
    organizationId: string;
  };
  actorProfile: CurrentDesignatedCenterAgentProfile;
  actorProfileId: string;
  context: OpenMeldRequestContext;
  db: D1Database;
  designation: CenterAgentDesignationRecord;
};

export async function requireCurrentDesignatedCenterAgentCaller(input: {
  context: OpenMeldRequestContext;
  env: CoreBindings;
}): Promise<CurrentDesignatedCenterAgentAuthorization> {
  const organizationId = normalizeOptionalText(
    input.context.activeOrganizationId
  );
  const actorProfileId = normalizeOptionalText(
    input.context.actorContext.openMeldProfileId
  );
  if (
    !(
      organizationId &&
      actorProfileId &&
      input.context.actorContext.profileKind === "agent"
    ) ||
    input.context.actorContext.callerPrincipalId !== actorProfileId ||
    input.context.actorContext.ownerUserId
  ) {
    throw centerAgentNotDesignatedError(
      "This action requires the designated Center Agent profile."
    );
  }
  const db = requireCenterAgentDb(input.env);
  const designation = await readCenterAgentDesignationRecord({
    db,
    organizationId,
  });
  if (!designation) {
    throw createCoreRpcHttpError({
      status: 403,
      reason: "This Organization has no designated Center Agent.",
      code: "center_agent.designation_required",
    });
  }
  if (designation.agentProfileId !== actorProfileId) {
    throw centerAgentNotDesignatedError(
      "This Agent Profile is not the Organization's Center Agent."
    );
  }
  if (!isCenterAgentDesignationActive(designation)) {
    throw createCoreRpcHttpError({
      code: "center_agent.paused",
      reason:
        "The Center Agent is paused. An Organization owner or admin must resume it before it can continue.",
      status: 409,
    });
  }
  const actorProfile = await readCenterAgentProfile({ db, actorProfileId });
  const canonicalProfileName = normalizeOptionalText(actorProfile?.profileName);
  if (
    !(actorProfile && canonicalProfileName) ||
    actorProfile.managedRole !== "center_agent" ||
    actorProfile.status !== "active" ||
    actorProfile.organizationId !== organizationId ||
    actorProfile.ownerUserId !== null
  ) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "The designated Center Agent identity is unavailable.",
      code: "center_agent.profile_invalid",
    });
  }
  return {
    activeOrganization: {
      organizationId,
    },
    actorProfile: { ...actorProfile, profileName: canonicalProfileName },
    actorProfileId,
    context: {
      ...input.context,
      actorContext: {
        ...input.context.actorContext,
        profileName: canonicalProfileName,
      },
    },
    db,
    designation,
  };
}

async function readCenterAgentProfile(input: {
  actorProfileId: string;
  db: D1Database;
}): Promise<CurrentDesignatedCenterAgentProfile | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          profile_id,
          profile_name,
          profile_kind,
          status,
          organization_id,
          owner_user_id,
          managed_role
        FROM openmeld_profiles
        WHERE profile_id = ?
        LIMIT 1
      `
    )
    .bind(input.actorProfileId)
    .first<{
      managed_role: string | null;
      organization_id: string | null;
      owner_user_id: string | null;
      profile_id: string;
      profile_kind: "agent" | "human" | "system";
      profile_name: string;
      status: "active" | "disabled";
    }>();
  if (!row) {
    return null;
  }
  return {
    managedRole: normalizeOptionalText(row.managed_role),
    organizationId: normalizeOptionalText(row.organization_id),
    ownerUserId: row.owner_user_id,
    profileId: row.profile_id,
    profileKind: row.profile_kind,
    profileName: row.profile_name,
    status: row.status,
  };
}

function requireCenterAgentDb(env: CoreBindings): D1Database {
  const db = identityDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Center Agent store is unavailable.",
      code: "center_agent.designation_store_unavailable",
    });
  }
  return db;
}

function centerAgentNotDesignatedError(reason: string): Error {
  return createCoreRpcHttpError({
    status: 403,
    reason,
    code: "center_agent.not_designated",
  });
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
