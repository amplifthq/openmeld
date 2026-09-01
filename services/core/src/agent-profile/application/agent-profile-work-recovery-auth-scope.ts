import type { CoreBindings } from "../../lib/bindings";

export type AgentProfileWorkRecoveryAuthScope = {
  organizationId: string;
  ownerUserId: string;
  profileId: string;
  profileName: string;
};

export type AgentProfileWorkRecoveryAuthScopeResult =
  | {
      status: "valid";
      scope: AgentProfileWorkRecoveryAuthScope;
    }
  | {
      status: "invalid" | "unavailable";
      reasonCode: string;
    };

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function resolveAgentProfileWorkRecoveryAuthScope(input: {
  agentProfileId: string;
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"] | undefined;
}): Promise<AgentProfileWorkRecoveryAuthScopeResult> {
  if (!input.authWorker?.resolveProfileById) {
    return {
      status: "unavailable",
      reasonCode: "agent_profile_work_recovery.auth_scope_unavailable",
    };
  }

  let result: unknown;
  try {
    result = await input.authWorker.resolveProfileById({
      openMeldProfileId: input.agentProfileId,
    });
  } catch {
    return {
      status: "unavailable",
      reasonCode: "agent_profile_work_recovery.auth_scope_unavailable",
    };
  }

  if (!isRecord(result) || result.ok !== true) {
    return isRecord(result) &&
      result.ok === false &&
      result.code === "profile.not_found"
      ? {
          status: "invalid",
          reasonCode: "agent_profile_work_recovery.profile_not_found",
        }
      : {
          status: "unavailable",
          reasonCode: "agent_profile_work_recovery.auth_scope_unavailable",
        };
  }

  const profile = result.profile;
  if (!isRecord(profile)) {
    return {
      status: "unavailable",
      reasonCode: "agent_profile_work_recovery.auth_scope_unavailable",
    };
  }
  const profileId = normalizeOptionalText(profile.profileId);
  const profileName = normalizeOptionalText(profile.profileName);
  const ownerUserId = normalizeOptionalText(profile.ownerUserId);
  const organizationId = normalizeOptionalText(profile.organizationId);
  if (!(profileId && profileName && ownerUserId && organizationId)) {
    return {
      status: "unavailable",
      reasonCode: "agent_profile_work_recovery.auth_scope_unavailable",
    };
  }
  if (
    profileId !== input.agentProfileId ||
    profile.profileKind !== "agent" ||
    profile.status !== "active"
  ) {
    return {
      status: "invalid",
      reasonCode: "agent_profile_work_recovery.profile_invalid",
    };
  }

  return {
    status: "valid",
    scope: {
      organizationId,
      ownerUserId,
      profileId,
      profileName,
    },
  };
}
