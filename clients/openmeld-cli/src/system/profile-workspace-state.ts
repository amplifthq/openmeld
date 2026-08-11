import { resolveCurrentOpenMeldAccountContext } from "../config/account-context";
import { getAuthSessionState } from "../config/auth-session";
import {
  listOpenMeldProfiles,
  type OpenMeldProfile,
} from "../config/openmeld-profiles-api";
import { resolveProfileWorkspaceRuntimeForAccount } from "../profile-workspace/runtime-resolution";
import {
  ensureOpenMeldManagedProfileWorkspace,
  migrateLegacyProfileWorkspaceConfigIfNeeded,
  readProfileWorkspaceConfigForAccount,
} from "../profile-workspace/service";

export type ProfileWorkspaceStateSyncMode = "check" | "repair";

export type ProfileWorkspaceStateSyncResult = {
  invalidWorkspaceProfileIds: string[];
  migratedProfileIds: string[];
  missingWorkspaceProfileIds: string[];
  mode: ProfileWorkspaceStateSyncMode;
  projectedProfileIds: string[];
  provisionedProfileIds: string[];
  reason: string;
  status: "degraded" | "ok" | "skipped";
};

type ProjectedProfileWorkspaceSyncOutcome = {
  invalid: boolean;
  migrated: boolean;
  missing: boolean;
  provisioned: boolean;
};

export async function syncProfileWorkspaceState(input: {
  mode: ProfileWorkspaceStateSyncMode;
  profileIds?: readonly string[];
}): Promise<ProfileWorkspaceStateSyncResult> {
  const authState = await getAuthSessionState({
    validateRemote: false,
  }).catch(() => ({
    session: null,
    state: "missing" as const,
  }));
  if (authState.state !== "valid") {
    return {
      invalidWorkspaceProfileIds: [],
      migratedProfileIds: [],
      missingWorkspaceProfileIds: [],
      mode: input.mode,
      projectedProfileIds: [],
      provisionedProfileIds: [],
      reason:
        "sign in is required before OpenMeld can check profile workspaces",
      status: "skipped",
    };
  }

  const accountContext = await resolveCurrentOpenMeldAccountContext();
  const profiles = await listOpenMeldProfiles();
  const requestedProfileIds = new Set(
    (input.profileIds ?? [])
      .map((profileId) => profileId.trim())
      .filter((profileId) => profileId.length > 0)
  );
  const projectedProfiles = collectProjectedWorkspaceProfiles(
    profiles,
    requestedProfileIds
  );
  const projectedProfileIds = projectedProfiles
    .map((profile) => profile.openMeldProfileId)
    .sort((left, right) => left.localeCompare(right));

  if (projectedProfiles.length === 0) {
    return {
      invalidWorkspaceProfileIds: [],
      migratedProfileIds: [],
      missingWorkspaceProfileIds: [],
      mode: input.mode,
      projectedProfileIds,
      provisionedProfileIds: [],
      reason: "no projected agent profiles require local workspace setup",
      status: "ok",
    };
  }

  const invalidWorkspaceProfileIds: string[] = [];
  const migratedProfileIds: string[] = [];
  const missingWorkspaceProfileIds: string[] = [];
  const provisionedProfileIds: string[] = [];

  for (const profile of projectedProfiles) {
    const outcome = await syncProjectedProfileWorkspace({
      account: accountContext.key,
      openMeldProfileId: profile.openMeldProfileId,
      mode: input.mode,
    });

    if (outcome.provisioned) {
      provisionedProfileIds.push(profile.openMeldProfileId);
    }
    if (outcome.migrated) {
      migratedProfileIds.push(profile.openMeldProfileId);
    }
    if (outcome.missing) {
      missingWorkspaceProfileIds.push(profile.openMeldProfileId);
    }
    if (outcome.invalid) {
      invalidWorkspaceProfileIds.push(profile.openMeldProfileId);
    }
  }

  const hasFailures =
    missingWorkspaceProfileIds.length > 0 ||
    invalidWorkspaceProfileIds.length > 0;
  return {
    invalidWorkspaceProfileIds,
    migratedProfileIds,
    missingWorkspaceProfileIds,
    mode: input.mode,
    projectedProfileIds,
    provisionedProfileIds,
    reason: resolveProfileWorkspaceStateReason({
      hasFailures,
      invalidWorkspaceProfileIds,
      missingWorkspaceProfileIds,
      projectedProfileIds,
      provisionedProfileIds,
    }),
    status: hasFailures ? "degraded" : "ok",
  };
}

async function syncProjectedProfileWorkspace(input: {
  account: Parameters<
    typeof readProfileWorkspaceConfigForAccount
  >[0]["account"];
  openMeldProfileId: string;
  mode: ProfileWorkspaceStateSyncMode;
}): Promise<ProjectedProfileWorkspaceSyncOutcome> {
  const workspaceConfig = await readProfileWorkspaceConfigForAccount({
    account: input.account,
    openMeldProfileId: input.openMeldProfileId,
  });
  if (workspaceConfig.status === "missing") {
    if (input.mode !== "repair") {
      return {
        invalid: false,
        migrated: false,
        missing: true,
        provisioned: false,
      };
    }

    await ensureOpenMeldManagedProfileWorkspace({
      account: input.account,
      openMeldProfileId: input.openMeldProfileId,
    });
    return {
      invalid: false,
      migrated: false,
      missing: false,
      provisioned: true,
    };
  }

  if (workspaceConfig.status === "invalid") {
    return {
      invalid: true,
      migrated: false,
      missing: false,
      provisioned: false,
    };
  }

  const migrated =
    workspaceConfig.persistedVersion === 1 && input.mode === "repair"
      ? await migrateLegacyWorkspaceConfig({
          account: input.account,
          openMeldProfileId: input.openMeldProfileId,
        })
      : false;

  if (
    workspaceConfig.value.mode === "openmeld_managed" &&
    input.mode === "repair"
  ) {
    await ensureOpenMeldManagedProfileWorkspace({
      account: input.account,
      openMeldProfileId: input.openMeldProfileId,
    });
  }

  const resolution = await resolveProfileWorkspaceRuntimeForAccount({
    account: input.account,
    openMeldProfileId: input.openMeldProfileId,
    mode: "inspect",
  });
  return {
    invalid: resolution.status === "invalid",
    migrated,
    missing: resolution.status === "missing",
    provisioned: false,
  };
}

async function migrateLegacyWorkspaceConfig(input: {
  account: Parameters<
    typeof readProfileWorkspaceConfigForAccount
  >[0]["account"];
  openMeldProfileId: string;
}): Promise<boolean> {
  const migration = await migrateLegacyProfileWorkspaceConfigIfNeeded({
    account: input.account,
    openMeldProfileId: input.openMeldProfileId,
  });
  return migration.status === "migrated";
}

function collectProjectedWorkspaceProfiles(
  profiles: OpenMeldProfile[],
  requestedProfileIds?: ReadonlySet<string>
): OpenMeldProfile[] {
  return profiles.filter(
    (profile) =>
      (requestedProfileIds === undefined ||
        requestedProfileIds.size === 0 ||
        requestedProfileIds.has(profile.openMeldProfileId)) &&
      profile.profileKind === "agent" &&
      profile.status === "active"
  );
}

function resolveProfileWorkspaceStateReason(input: {
  hasFailures: boolean;
  invalidWorkspaceProfileIds: string[];
  missingWorkspaceProfileIds: string[];
  projectedProfileIds: string[];
  provisionedProfileIds: string[];
}): string {
  if (input.hasFailures) {
    if (input.invalidWorkspaceProfileIds.length > 0) {
      return "one or more projected agent profiles have invalid local workspaces";
    }
    if (input.missingWorkspaceProfileIds.length > 0) {
      return "one or more projected agent profiles are missing local workspace config";
    }
    return "projected agent profile workspace state is degraded";
  }
  if (input.provisionedProfileIds.length > 0) {
    return "projected agent profile workspaces were provisioned";
  }
  if (input.projectedProfileIds.length === 0) {
    return "no projected agent profiles require local workspace setup";
  }
  return "projected agent profile workspaces look good";
}
