import { resolveAvailableProfileHandle } from "@openmeld/protocol";
import {
  AGENT_PROFILE_CREATION_IDEMPOTENCY_KEY_MAX_LENGTH,
  agentAvatarStyleSchema,
  authRpcResolveProfilesByIdsInputSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldProfileManagedRole,
  OpenMeldProfileSource,
} from "../db/openmeld-profile.schema";
import { isProfileHandleUniqueConstraintError } from "../profile-identity/profile-handle-conflict";
import type { AuthProfileKind } from "../types/auth-claims";
import {
  AdditionalHumanProfileCreationDisabledError,
  PrimaryHumanProfileDeleteForbiddenError,
  ProfileCreationIdempotencyConflictError,
  ProfileNotFoundError,
  ProfileValidationError,
} from "./profile-errors";
import type {
  OpenMeldProfileRecord,
  OpenMeldProfileRepository,
} from "./profile-repository";
import type {
  ProfileSpaceHistoryRecord,
  ProfileSpaceHistoryRepository,
} from "./profile-space-history-repository";
import {
  createProfileSpaceHistoryService,
  type ProfileSpaceHistoryServiceHooks,
} from "./profile-space-history-service";
import type { SpaceDeletionTombstoneRepository } from "./space-deletion-tombstone-repository";
import { createSpaceDeletionTombstoneService } from "./space-deletion-tombstone-service";

const DEFAULT_HUMAN_NAME_PREFIX = "human";
const DEFAULT_AGENT_ID_PREFIX = "agt_";
const MAX_AGENT_PROFILE_ID_ATTEMPTS = 5;
const MAX_PRIMARY_HUMAN_PROFILE_ATTEMPTS = 5;
const MAX_PROFILE_HANDLE_UPDATE_ATTEMPTS = 5;
const UUID_PROFILE_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AGENT_PROFILE_ID_REGEX =
  /^agt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type EnsurePrimaryHumanProfileInput = {
  userId: string;
  userName?: string | null;
  userEmail?: string | null;
};

export type ResolveProfileForOwnerInput = {
  ownerUserId: string;
  profileId?: string | null;
  profileKind?: AuthProfileKind | null;
  fallbackUserName?: string | null;
  fallbackUserEmail?: string | null;
};

export type ResolvePrimaryHumanAndRequestedProfileInput =
  EnsurePrimaryHumanProfileInput & {
    profileId?: string | null;
    profileKind?: AuthProfileKind | null;
  };

// The requested Profile settles separately: its failure is a Profile result,
// while a primary Human Profile failure fails the whole request.
export type RequestedProfileResolution =
  | { ok: true; profile: OpenMeldProfileRecord }
  | { ok: false; error: unknown };

export type ListProfilesForOwnerEnsuringPrimaryHumanProfileInput = {
  ownerUserId: string;
  userName?: string | null;
  userEmail?: string | null;
};

export type CreateAgentProfileInput = {
  ownerUserId: string;
  organizationId: string;
  profileName: string;
  createdByUserId?: string | null;
  creationActorProfileId?: string | null;
  creatorProfileId?: string | null;
  idempotencyKey?: string | null;
  source?: OpenMeldProfileSource;
};

export type EnsureManagedAgentProfileInput = {
  ownerUserId?: string | null;
  organizationId: string;
  profileName: string;
  managedRole: OpenMeldProfileManagedRole;
  createdByUserId?: string | null;
  creatorProfileId?: string | null;
};

export type CreateHumanProfileInput = {
  ownerUserId: string;
  profileName: string;
  createdByUserId?: string | null;
  creatorProfileId?: string | null;
};

export type UpdateProfileNameForOwnerInput = {
  ownerUserId: string;
  profileId: string;
  profileName: string;
};

export type UpdateProfileForOwnerInput = {
  ownerUserId: string;
  profileId: string;
  profileName?: string | null;
};

export type UpdateAgentProfileDefaultProjectForOwnerInput = {
  defaultProjectId: string | null;
  onlyIfUnmodified?: boolean;
  organizationId: string;
  ownerUserId: string;
  profileId: string;
};

export type UpdateManagedAgentProfileInOrganizationInput = {
  managedRole: OpenMeldProfileManagedRole;
  organizationId: string;
  profileId: string;
  profileName?: string;
  avatarStyle?: string;
  avatarOptions?: OpenMeldProfileRecord["avatarOptions"];
  expectedAvatarOptions?: OpenMeldProfileRecord["avatarOptions"];
};

export type DeleteProfileForOwnerInput = {
  expectedProfileKind?: "agent";
  ownerUserId: string;
  profileId: string;
};

export type ListProfileSpaceHistoryInput = Parameters<
  ReturnType<typeof createProfileSpaceHistoryService>["listHistory"]
>[0];

export type UpsertProfileSpaceHistoryInput = Parameters<
  ReturnType<typeof createProfileSpaceHistoryService>["upsertHistory"]
>[0];

export type UpdateProfileSpaceHistoryStatusInput = Parameters<
  ReturnType<typeof createProfileSpaceHistoryService>["updateStatus"]
>[0];

export type CanViewerAccessProfileOriginInput = {
  viewerProfileId: string;
  targetProfileId: string;
};

export type ResolvedProfileLineageItem = {
  profileId: string;
  creatorProfileId: string | null;
};

export type ListOwnerAccessibleSpaceIdsInput = {
  ownerUserId: string;
  gatewayHost: string;
  spaceIds: string[];
};

export type QuerySpaceDeletionTombstonesInput = Parameters<
  ReturnType<typeof createSpaceDeletionTombstoneService>["queryTombstones"]
>[0];

export type UpsertSpaceDeletionTombstoneInput = Parameters<
  ReturnType<typeof createSpaceDeletionTombstoneService>["upsertTombstone"]
>[0];

type ProfileServiceOptions = {
  additionalHumanProfileCreationEnabled?: boolean;
  generateAgentProfileId?: () => string;
  generateHumanProfileId?: () => string;
  generatePrimaryHumanProfileId?: (userId: string) => string;
  updateDefaultHumanProfileDisplayName?: (input: {
    displayName: string;
    ownerUserId: string;
    profileId: string;
  }) => Promise<OpenMeldProfileRecord>;
  profileSpaceHistoryRepository?: ProfileSpaceHistoryRepository;
  profileSpaceHistoryHooks?: ProfileSpaceHistoryServiceHooks;
  spaceDeletionTombstoneRepository?: SpaceDeletionTombstoneRepository;
};

export type OpenMeldProfileService = ReturnType<
  typeof createOpenMeldProfileService
>;

export function createOpenMeldProfileService(
  repository: OpenMeldProfileRepository,
  options: ProfileServiceOptions = {}
) {
  const additionalHumanProfileCreationEnabled =
    options.additionalHumanProfileCreationEnabled === true;
  const generateAgentProfileId =
    options.generateAgentProfileId ?? defaultGenerateAgentProfileId;
  const generateHumanProfileId =
    options.generateHumanProfileId ?? defaultGenerateHumanProfileId;
  const generatePrimaryHumanProfileId =
    options.generatePrimaryHumanProfileId ??
    defaultGeneratePrimaryHumanProfileId;
  const profileSpaceHistoryService = options.profileSpaceHistoryRepository
    ? createProfileSpaceHistoryService(
        options.profileSpaceHistoryRepository,
        options.profileSpaceHistoryHooks
      )
    : null;
  const spaceDeletionTombstoneService = options.spaceDeletionTombstoneRepository
    ? createSpaceDeletionTombstoneService(
        options.spaceDeletionTombstoneRepository
      )
    : null;

  const ensurePrimaryProfileIsActiveAndDefault = async (
    profile: OpenMeldProfileRecord
  ): Promise<OpenMeldProfileRecord> => {
    if (!profile.ownerUserId) {
      throw new ProfileNotFoundError();
    }
    if (profile.status === "active" && profile.isDefault === true) {
      return profile;
    }

    const activatedOk = await repository.activateProfile(profile.profileId);
    if (!activatedOk) {
      throw new Error("failed to activate primary human profile");
    }

    const activated = await repository.findByOwnerAndProfileId(
      profile.ownerUserId,
      profile.profileId
    );
    if (activated?.status !== "active") {
      throw new Error("failed to activate primary human profile");
    }
    if (activated.isDefault !== true) {
      throw new Error("failed to activate primary human profile");
    }

    return activated;
  };

  const ensurePrimaryHumanProfile = async (
    input: EnsurePrimaryHumanProfileInput
  ): Promise<OpenMeldProfileRecord> => {
    // OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT default-human-profile
    // The default human profile is the only profile OpenMeld may ensure
    // automatically from account login. Agent Profiles require user intent.
    const userId = normalizeRequiredText(input.userId, "userId");

    const existing = await repository.findDefaultHumanByOwner(userId);
    if (existing) {
      assertPrimaryHumanProfile(existing, userId);
      return ensurePrimaryProfileIsActiveAndDefault(existing);
    }

    const primaryHumanProfileId = normalizeHumanProfileId(
      generatePrimaryHumanProfileId(userId),
      "primaryHumanProfileId"
    );
    const profileName = buildPrimaryHumanProfileName({
      userId,
      userName: input.userName,
      userEmail: input.userEmail,
    });
    for (
      let attempt = 0;
      attempt < MAX_PRIMARY_HUMAN_PROFILE_ATTEMPTS;
      attempt += 1
    ) {
      const profileHandle = await resolveProfileHandleForOwner({
        ownerUserId: userId,
        profileKind: "human",
        profileName,
      });
      await repository.insertPrimaryHumanProfile({
        profileId: primaryHumanProfileId,
        profileName,
        profileHandle,
        ownerUserId: userId,
        createdByUserId: userId,
        source: "auth_bootstrap",
      });

      const ensured = await repository.findDefaultHumanByOwner(userId);
      if (ensured) {
        assertPrimaryHumanProfile(ensured, userId);
        return ensured;
      }
    }

    throw new Error("failed to ensure primary human profile");
  };

  const requireActiveOwnedProfile = (
    profile: OpenMeldProfileRecord | null,
    requestedProfileKind: AuthProfileKind | null
  ): OpenMeldProfileRecord => {
    if (profile?.status !== "active") {
      throw new ProfileNotFoundError();
    }
    if (requestedProfileKind && profile.profileKind !== requestedProfileKind) {
      throw new ProfileNotFoundError();
    }
    return profile;
  };

  // Request-auth hot path: one read answers both the primary Human Profile
  // and the requested Profile. For unchanged state, outcomes match
  // ensurePrimaryHumanProfile followed by resolveProfileForOwner; both
  // answers now come from one snapshot instead of two reads.
  const resolvePrimaryHumanAndRequestedProfileForOwner = async (
    input: ResolvePrimaryHumanAndRequestedProfileInput
  ): Promise<{
    primaryHumanProfile: OpenMeldProfileRecord;
    requestedProfile: RequestedProfileResolution;
  }> => {
    const userId = normalizeRequiredText(input.userId, "userId");
    let profileId: string | null;
    let requestedProfileKind: AuthProfileKind | null;
    try {
      profileId = normalizeOptionalProfileId(input.profileId, "profileId");
      requestedProfileKind = normalizeProfileKind(input.profileKind);
    } catch (error) {
      return {
        primaryHumanProfile: await ensurePrimaryHumanProfile(input),
        requestedProfile: { ok: false, error },
      };
    }
    if (!profileId) {
      const primaryHumanProfile = await ensurePrimaryHumanProfile(input);
      return {
        primaryHumanProfile,
        requestedProfile: { ok: true, profile: primaryHumanProfile },
      };
    }

    const { defaultHumanProfile, ownedProfile } =
      await repository.findDefaultHumanAndOwnedProfile(userId, profileId);
    let primaryHumanProfile: OpenMeldProfileRecord;
    let requestedRow: OpenMeldProfileRecord | null;
    if (defaultHumanProfile) {
      assertPrimaryHumanProfile(defaultHumanProfile, userId);
      primaryHumanProfile =
        await ensurePrimaryProfileIsActiveAndDefault(defaultHumanProfile);
      requestedRow =
        ownedProfile?.profileId === primaryHumanProfile.profileId
          ? primaryHumanProfile
          : ownedProfile;
    } else {
      // First-login bootstrap writes the primary Human Profile, so the
      // requested row is read only after that write.
      primaryHumanProfile = await ensurePrimaryHumanProfile(input);
      try {
        requestedRow = await repository.findByOwnerAndProfileId(
          userId,
          profileId
        );
      } catch (error) {
        return { primaryHumanProfile, requestedProfile: { ok: false, error } };
      }
    }
    try {
      return {
        primaryHumanProfile,
        requestedProfile: {
          ok: true,
          profile: requireActiveOwnedProfile(
            requestedRow,
            requestedProfileKind
          ),
        },
      };
    } catch (error) {
      return { primaryHumanProfile, requestedProfile: { ok: false, error } };
    }
  };

  const resolveProfileHandleForOwner = async (input: {
    ownerUserId: string;
    profileKind: AuthProfileKind;
    profileName: string;
    excludedProfileId?: string;
  }): Promise<string> => {
    const takenHandles = (await repository.listByOwner(input.ownerUserId))
      .filter((profile) => profile.profileId !== input.excludedProfileId)
      .map((profile) => profile.profileHandle);

    return resolveAvailableProfileHandle({
      profileName: input.profileName,
      profileKind: input.profileKind,
      takenHandles,
    });
  };

  const requireActiveCreatorProfileForOwner = async (input: {
    ownerUserId: string;
    creatorProfileId: string;
  }): Promise<OpenMeldProfileRecord> => {
    const creatorProfileId = normalizeAnyProfileId(
      input.creatorProfileId,
      "creatorProfileId"
    );
    const creatorProfile = await repository.findByOwnerAndProfileId(
      input.ownerUserId,
      creatorProfileId
    );
    if (creatorProfile?.status !== "active") {
      throw new ProfileValidationError(
        "creatorProfileId must reference an active profile owned by this user"
      );
    }
    return creatorProfile;
  };

  const resolveAgentCreatorProfileId = async (input: {
    ownerUserId: string;
    creatorProfileId: string | null;
  }): Promise<string> => {
    if (input.creatorProfileId) {
      return (
        await requireActiveCreatorProfileForOwner({
          ownerUserId: input.ownerUserId,
          creatorProfileId: input.creatorProfileId,
        })
      ).profileId;
    }

    const fallbackCreator =
      (await repository.findDefaultHumanByOwner(input.ownerUserId)) ??
      (await ensurePrimaryHumanProfile({
        userId: input.ownerUserId,
      }));
    return fallbackCreator.profileId;
  };

  const resolveHumanCreatorProfileId = async (input: {
    ownerUserId: string;
    creatorProfileId: string | null;
  }): Promise<string | null> => {
    const ownerProfiles = await repository.listByOwner(input.ownerUserId);
    const humanProfiles = ownerProfiles.filter(
      (profile) => profile.profileKind === "human"
    );
    if (humanProfiles.length === 0) {
      if (input.creatorProfileId) {
        throw new ProfileValidationError(
          "creatorProfileId must be omitted when creating the first root human profile"
        );
      }
      return null;
    }

    if (!input.creatorProfileId) {
      throw new ProfileValidationError(
        "creatorProfileId is required for non-root human profiles"
      );
    }

    return (
      await requireActiveCreatorProfileForOwner({
        ownerUserId: input.ownerUserId,
        creatorProfileId: input.creatorProfileId,
      })
    ).profileId;
  };

  const updateProfileIdentityWithRetry = async (input: {
    ownerUserId: string;
    profileId: string;
    profileKind: AuthProfileKind;
    profileName: string;
  }): Promise<void> => {
    for (
      let attempt = 0;
      attempt < MAX_PROFILE_HANDLE_UPDATE_ATTEMPTS;
      attempt += 1
    ) {
      const profileHandle = await resolveProfileHandleForOwner({
        ownerUserId: input.ownerUserId,
        profileKind: input.profileKind,
        profileName: input.profileName,
        excludedProfileId: input.profileId,
      });

      try {
        await repository.updateProfileIdentityForOwner(
          input.ownerUserId,
          input.profileId,
          {
            profileName: input.profileName,
            profileHandle,
          }
        );
        return;
      } catch (error) {
        if (
          attempt === MAX_PROFILE_HANDLE_UPDATE_ATTEMPTS - 1 ||
          !isProfileHandleUniqueConstraintError(error)
        ) {
          throw error;
        }
      }
    }

    throw new Error("failed to update profile identity after max attempts");
  };

  const updateOwnedProfileName = async (input: {
    ownerUserId: string;
    profileId: string;
    profileName: string;
  }): Promise<OpenMeldProfileRecord> => {
    const existing = await repository.findByOwnerAndProfileId(
      input.ownerUserId,
      input.profileId
    );
    if (existing?.status !== "active") {
      throw new ProfileNotFoundError();
    }

    if (isDefaultHumanProfile(existing, input.ownerUserId)) {
      if (!options.updateDefaultHumanProfileDisplayName) {
        throw new ProfileValidationError(
          "default profile name must be updated through the Account Display Name command"
        );
      }
      return options.updateDefaultHumanProfileDisplayName({
        displayName: input.profileName,
        ownerUserId: input.ownerUserId,
        profileId: input.profileId,
      });
    }

    await updateProfileIdentityWithRetry({
      ownerUserId: input.ownerUserId,
      profileId: input.profileId,
      profileKind: existing.profileKind,
      profileName: input.profileName,
    });

    const updated = await repository.findByOwnerAndProfileId(
      input.ownerUserId,
      input.profileId
    );
    if (!updated) {
      throw new ProfileNotFoundError();
    }
    return updated;
  };

  const findManagedAgentByRoleScope = (input: {
    managedRole: OpenMeldProfileManagedRole;
    organizationId: string;
    ownerUserId?: string | null;
  }): Promise<OpenMeldProfileRecord | null> => {
    if (input.managedRole === "center_agent") {
      return repository.findManagedAgentByOrganizationAndRole(
        input.organizationId,
        input.managedRole
      );
    }

    return repository.findManagedAgentByOwnerAndRole(
      normalizeRequiredText(input.ownerUserId ?? "", "ownerUserId"),
      input.managedRole
    );
  };

  return {
    ensurePrimaryHumanProfile,
    getProfileCapabilities: () => ({
      additionalHumanProfileCreationEnabled,
    }),
    resolveProfileById: (profileId: string) => {
      const normalizedProfileId = normalizeOptionalProfileId(
        profileId,
        "profileId"
      );
      if (!normalizedProfileId) {
        throw new ProfileValidationError("profileId is required");
      }
      return repository.findByProfileId(normalizedProfileId);
    },
    resolveProfilesByIds: (profileIds: string[]) => {
      const parsed = authRpcResolveProfilesByIdsInputSchema.safeParse({
        profileIds,
      });
      if (!parsed.success) {
        throw new ProfileValidationError("Profile fact batch is invalid");
      }
      return repository.findFactsByProfileIds([
        ...new Set(parsed.data.profileIds),
      ]);
    },
    listProfilesForOwner: async (ownerUserId: string) => {
      const normalizedOwnerUserId = normalizeRequiredText(
        ownerUserId,
        "ownerUserId"
      );
      return filterOrdinaryOwnerProfiles(
        await repository.listByOwner(normalizedOwnerUserId)
      );
    },
    listProfilesForOwnerEnsuringPrimaryHumanProfile: async (
      input: ListProfilesForOwnerEnsuringPrimaryHumanProfileInput
    ) => {
      const ownerUserId = normalizeRequiredText(
        input.ownerUserId,
        "ownerUserId"
      );
      await ensurePrimaryHumanProfile({
        userId: ownerUserId,
        userName: input.userName,
        userEmail: input.userEmail,
      });
      return filterOrdinaryOwnerProfiles(
        await repository.listByOwner(ownerUserId)
      );
    },
    listResolvedProfileLineageForOwner: async (
      ownerUserId: string
    ): Promise<ResolvedProfileLineageItem[]> => {
      const normalizedOwnerUserId = normalizeRequiredText(
        ownerUserId,
        "ownerUserId"
      );
      const profiles = await repository.listByOwner(normalizedOwnerUserId);
      const resolvedCreatorProfileIdByProfileId =
        buildResolvedCreatorProfileIdByProfileId(profiles);
      return profiles.map((profile) => ({
        profileId: profile.profileId,
        creatorProfileId:
          resolvedCreatorProfileIdByProfileId.get(profile.profileId) ?? null,
      }));
    },
    canViewerAccessProfileOrigin: async (
      input: CanViewerAccessProfileOriginInput
    ): Promise<boolean> => {
      const viewerProfileId = normalizeAnyProfileId(
        input.viewerProfileId,
        "viewerProfileId"
      );
      const targetProfileId = normalizeAnyProfileId(
        input.targetProfileId,
        "targetProfileId"
      );
      if (viewerProfileId === targetProfileId) {
        return true;
      }

      const targetProfile = await repository.findByProfileId(targetProfileId);
      if (!targetProfile?.ownerUserId) {
        return false;
      }
      const ownerProfiles = await repository.listByOwner(
        targetProfile.ownerUserId
      );
      const resolvedCreatorProfileIdByProfileId =
        buildResolvedCreatorProfileIdByProfileId(ownerProfiles);
      const seenProfileIds = new Set<string>();
      let currentProfileId: string | null = targetProfileId;
      while (currentProfileId) {
        if (seenProfileIds.has(currentProfileId)) {
          return false;
        }
        seenProfileIds.add(currentProfileId);

        const creatorProfileId: string | null =
          resolvedCreatorProfileIdByProfileId.get(currentProfileId) ?? null;
        if (!creatorProfileId) {
          return false;
        }
        if (creatorProfileId === viewerProfileId) {
          return true;
        }
        currentProfileId = creatorProfileId;
      }

      return false;
    },
    listProfileSpaceHistory: (
      input: ListProfileSpaceHistoryInput
    ): Promise<ProfileSpaceHistoryRecord[]> => {
      const service = requireProfileSpaceHistoryService(
        profileSpaceHistoryService
      );
      return service.listHistory(input);
    },
    upsertProfileSpaceHistory: (
      input: UpsertProfileSpaceHistoryInput
    ): Promise<ProfileSpaceHistoryRecord> => {
      const service = requireProfileSpaceHistoryService(
        profileSpaceHistoryService
      );
      return service.upsertHistory(input);
    },
    updateProfileSpaceHistoryStatus: (
      input: UpdateProfileSpaceHistoryStatusInput
    ): Promise<ProfileSpaceHistoryRecord> => {
      const service = requireProfileSpaceHistoryService(
        profileSpaceHistoryService
      );
      return service.updateStatus(input);
    },
    listOwnerAccessibleSpaceIds: async (
      input: ListOwnerAccessibleSpaceIdsInput
    ): Promise<string[]> => {
      const ownerUserId = normalizeRequiredText(
        input.ownerUserId,
        "ownerUserId"
      );
      const service = requireProfileSpaceHistoryService(
        profileSpaceHistoryService
      );
      const activeProfileIds = (await repository.listByOwner(ownerUserId))
        .filter((profile) => profile.status === "active")
        .map((profile) => profile.profileId);

      if (activeProfileIds.length === 0) {
        return [];
      }

      return service.listAccessibleSpaceIds({
        profileIds: activeProfileIds,
        gatewayHost: input.gatewayHost,
        spaceIds: input.spaceIds,
      });
    },
    querySpaceDeletionTombstones: (
      input: QuerySpaceDeletionTombstonesInput
    ) => {
      const service = requireSpaceDeletionTombstoneService(
        spaceDeletionTombstoneService
      );
      return service.queryTombstones(input);
    },
    upsertSpaceDeletionTombstone: (
      input: UpsertSpaceDeletionTombstoneInput
    ) => {
      const service = requireSpaceDeletionTombstoneService(
        spaceDeletionTombstoneService
      );
      return service.upsertTombstone(input);
    },
    resolveProfileForOwner: async (
      input: ResolveProfileForOwnerInput
    ): Promise<OpenMeldProfileRecord> => {
      const ownerUserId = normalizeRequiredText(
        input.ownerUserId,
        "ownerUserId"
      );
      const profileId = normalizeOptionalProfileId(
        input.profileId,
        "profileId"
      );
      const requestedProfileKind = normalizeProfileKind(input.profileKind);

      if (!profileId) {
        return ensurePrimaryHumanProfile({
          userId: ownerUserId,
          userName: input.fallbackUserName,
          userEmail: input.fallbackUserEmail,
        });
      }

      return requireActiveOwnedProfile(
        await repository.findByOwnerAndProfileId(ownerUserId, profileId),
        requestedProfileKind
      );
    },
    resolvePrimaryHumanAndRequestedProfileForOwner,
    createAgentProfile: async (
      input: CreateAgentProfileInput
    ): Promise<OpenMeldProfileRecord> => {
      const ownerUserId = normalizeRequiredText(
        input.ownerUserId,
        "ownerUserId"
      );
      const profileName = normalizeRequiredText(
        input.profileName,
        "profileName"
      );
      const organizationId = normalizeRequiredText(
        input.organizationId,
        "organizationId"
      );
      const createdByUserId = normalizeOptionalText(input.createdByUserId);
      const creationIdempotencyKey =
        normalizeAgentProfileCreationIdempotencyKey(input.idempotencyKey);
      const creatorProfileId = await resolveAgentCreatorProfileId({
        ownerUserId,
        creatorProfileId: normalizeOptionalText(input.creatorProfileId),
      });
      const creationActorProfileId =
        normalizeOptionalText(input.creationActorProfileId) ?? creatorProfileId;
      const source = input.source ?? "cli_create";
      const creationIntent = {
        createdByUserId: createdByUserId ?? ownerUserId,
        creationActorProfileId,
        creatorProfileId,
        organizationId,
        profileName,
        source,
      };
      const replayedProfile = await findAgentProfileCreationReplay({
        repository,
        ownerUserId,
        creationIdempotencyKey,
        creationIntent,
      });
      if (replayedProfile) {
        return replayedProfile;
      }
      for (const _ of Array.from({ length: MAX_AGENT_PROFILE_ID_ATTEMPTS })) {
        const profileId = normalizeAgentProfileId(
          generateAgentProfileId(),
          "agentProfileId"
        );
        const profileHandle = await resolveProfileHandleForOwner({
          ownerUserId,
          profileKind: "agent",
          profileName,
        });

        await repository.insertAgentProfile({
          profileId,
          profileName,
          profileHandle,
          organizationId,
          ownerUserId,
          createdByUserId: createdByUserId ?? ownerUserId,
          creationActorProfileId,
          creatorProfileId,
          creationIdempotencyKey,
          source,
        });

        const inserted = await findCommittedAgentProfile({
          repository,
          ownerUserId,
          profileId,
          creationIdempotencyKey,
          creationIntent,
        });

        if (inserted) {
          return inserted;
        }
      }

      throw new Error("failed to create agent profile after max attempts");
    },
    ensureManagedAgentProfile: async (
      input: EnsureManagedAgentProfileInput
    ): Promise<OpenMeldProfileRecord> => {
      const ownerUserId =
        input.managedRole === "center_agent"
          ? null
          : normalizeRequiredText(input.ownerUserId ?? "", "ownerUserId");
      const profileName = normalizeRequiredText(
        input.profileName,
        "profileName"
      );
      const organizationId = normalizeRequiredText(
        input.organizationId,
        "organizationId"
      );
      const managedRole = normalizeManagedRole(input.managedRole);
      const existing = await findManagedAgentByRoleScope({
        managedRole,
        organizationId,
        ownerUserId: input.ownerUserId,
      });
      if (existing) {
        return existing;
      }

      const createdByUserId = normalizeOptionalText(input.createdByUserId);
      const creatorProfileId = ownerUserId
        ? await resolveAgentCreatorProfileId({
            ownerUserId,
            creatorProfileId: normalizeOptionalText(input.creatorProfileId),
          })
        : null;
      for (const _ of Array.from({ length: MAX_AGENT_PROFILE_ID_ATTEMPTS })) {
        const profileId = normalizeAgentProfileId(
          generateAgentProfileId(),
          "agentProfileId"
        );
        const profileHandle = ownerUserId
          ? await resolveProfileHandleForOwner({
              ownerUserId,
              profileKind: "agent",
              profileName,
            })
          : resolveAvailableProfileHandle({
              profileName,
              profileKind: "agent",
              takenHandles: [],
            });

        await repository.insertAgentProfile({
          profileId,
          profileName,
          profileHandle,
          organizationId,
          ownerUserId,
          createdByUserId: createdByUserId ?? ownerUserId,
          creatorProfileId,
          managedRole,
          source: "auth_bootstrap",
        });

        const inserted = await repository.findByProfileId(profileId);

        if (inserted) {
          return inserted;
        }

        const existingAfterConflict = await findManagedAgentByRoleScope({
          managedRole,
          organizationId,
          ownerUserId: input.ownerUserId,
        });
        if (existingAfterConflict) {
          return existingAfterConflict;
        }
      }

      throw new Error(
        "failed to ensure managed agent profile after max attempts"
      );
    },
    createHumanProfile: async (
      input: CreateHumanProfileInput
    ): Promise<OpenMeldProfileRecord> => {
      if (!additionalHumanProfileCreationEnabled) {
        throw new AdditionalHumanProfileCreationDisabledError();
      }
      const ownerUserId = normalizeRequiredText(
        input.ownerUserId,
        "ownerUserId"
      );
      const profileName = normalizeRequiredText(
        input.profileName,
        "profileName"
      );
      const createdByUserId = normalizeOptionalText(input.createdByUserId);
      const creatorProfileId = await resolveHumanCreatorProfileId({
        ownerUserId,
        creatorProfileId: normalizeOptionalText(input.creatorProfileId),
      });

      for (const _ of Array.from({ length: MAX_AGENT_PROFILE_ID_ATTEMPTS })) {
        const profileId = normalizeHumanProfileId(
          generateHumanProfileId(),
          "humanProfileId"
        );
        const profileHandle = await resolveProfileHandleForOwner({
          ownerUserId,
          profileKind: "human",
          profileName,
        });

        await repository.insertHumanProfile({
          profileId,
          profileName,
          profileHandle,
          ownerUserId,
          createdByUserId: createdByUserId ?? ownerUserId,
          creatorProfileId,
          source: "cli_create",
        });

        const inserted = await repository.findByOwnerAndProfileId(
          ownerUserId,
          profileId
        );

        if (inserted) {
          return inserted;
        }
      }

      throw new Error("failed to create human profile after max attempts");
    },
    updateProfileForOwner: async (
      input: UpdateProfileForOwnerInput
    ): Promise<OpenMeldProfileRecord> => {
      const ownerUserId = normalizeRequiredText(
        input.ownerUserId,
        "ownerUserId"
      );
      const profileId = normalizeAnyProfileId(input.profileId, "profileId");
      const profileName = normalizeOptionalText(input.profileName);
      if (!profileName) {
        throw new ProfileValidationError("profileName is required");
      }
      return await updateOwnedProfileName({
        ownerUserId,
        profileId,
        profileName,
      });
    },
    updateAgentAvatarStyleForOwner: async (input: {
      ownerUserId: string;
      profileId: string;
      avatarStyle: string;
    }): Promise<OpenMeldProfileRecord> => {
      const ownerUserId = normalizeRequiredText(
        input.ownerUserId,
        "ownerUserId"
      );
      const profileId = normalizeAgentProfileId(input.profileId, "profileId");
      const avatarStyle = agentAvatarStyleSchema.safeParse(input.avatarStyle);
      if (
        !(
          avatarStyle.success &&
          ["automatic", "fluid"].includes(avatarStyle.data)
        )
      ) {
        throw new ProfileValidationError("Choose a valid Remote Agent avatar.");
      }
      const existing = await repository.findByOwnerAndProfileId(
        ownerUserId,
        profileId
      );
      if (
        existing?.status !== "active" ||
        existing.profileKind !== "agent" ||
        existing.managedRole !== null
      ) {
        throw new ProfileNotFoundError();
      }
      if (existing.avatarStyle === avatarStyle.data) {
        return existing;
      }
      await repository.updateAgentAvatarStyle(profileId, avatarStyle.data, {
        ownerUserId,
      });
      const updated = await repository.findByOwnerAndProfileId(
        ownerUserId,
        profileId
      );
      if (!updated) {
        throw new ProfileNotFoundError();
      }
      return updated;
    },
    updateAgentProfileDefaultProjectForOwner: async (
      input: UpdateAgentProfileDefaultProjectForOwnerInput
    ): Promise<OpenMeldProfileRecord> => {
      const ownerUserId = normalizeRequiredText(
        input.ownerUserId,
        "ownerUserId"
      );
      const organizationId = normalizeRequiredText(
        input.organizationId,
        "organizationId"
      );
      const profileId = normalizeAgentProfileId(input.profileId, "profileId");
      const defaultProjectId = normalizeNullableRequiredText(
        input.defaultProjectId,
        "defaultProjectId"
      );
      const existing = await repository.findByOwnerAndProfileId(
        ownerUserId,
        profileId
      );
      if (existing?.status !== "active") {
        throw new ProfileNotFoundError();
      }
      if (existing.organizationId !== organizationId) {
        throw new ProfileValidationError(
          "This Agent Profile does not belong to this Organization.",
          "profile.organization_mismatch"
        );
      }
      if (existing.profileKind !== "agent" || existing.managedRole !== null) {
        throw new ProfileValidationError(
          "Default Project is only available for ordinary Agent Profiles."
        );
      }
      if (
        input.onlyIfUnmodified &&
        existing.defaultProjectId === defaultProjectId
      ) {
        return existing;
      }
      if (input.onlyIfUnmodified && existing.defaultProjectRevision === null) {
        throw new ProfileValidationError(
          "Confirm this Agent's working folder in Agent settings, then retry setup.",
          "profile.default_project_confirmation_required"
        );
      }
      await repository.updateAgentProfileDefaultProjectForOwner(
        ownerUserId,
        organizationId,
        profileId,
        defaultProjectId,
        input.onlyIfUnmodified
      );
      const updated = await repository.findByOwnerAndProfileId(
        ownerUserId,
        profileId
      );
      if (!updated) {
        throw new ProfileNotFoundError();
      }
      return updated;
    },
    updateProfileNameForOwner: async (
      input: UpdateProfileNameForOwnerInput
    ): Promise<OpenMeldProfileRecord> => {
      const ownerUserId = normalizeRequiredText(
        input.ownerUserId,
        "ownerUserId"
      );
      const profileId = normalizeAnyProfileId(input.profileId, "profileId");
      const profileName = normalizeRequiredText(
        input.profileName,
        "profileName"
      );

      return await updateOwnedProfileName({
        ownerUserId,
        profileId,
        profileName,
      });
    },
    updateManagedAgentProfileInOrganization: async (
      input: UpdateManagedAgentProfileInOrganizationInput
    ): Promise<OpenMeldProfileRecord> => {
      const organizationId = normalizeRequiredText(
        input.organizationId,
        "organizationId"
      );
      const profileId = normalizeAgentProfileId(input.profileId, "profileId");
      const profileName = normalizeOptionalText(input.profileName);
      const avatarStyle = input.avatarStyle;
      if (!profileName && avatarStyle === undefined) {
        throw new ProfileValidationError(
          "profileName or avatarStyle is required"
        );
      }
      if (
        avatarStyle !== undefined &&
        (avatarStyle === "automatic" ||
          !agentAvatarStyleSchema.safeParse(avatarStyle).success)
      ) {
        throw new ProfileValidationError("Choose a valid Center Agent avatar.");
      }
      const managedRole = normalizeManagedRole(input.managedRole);
      const existing = await repository.findByProfileId(profileId);

      if (
        existing?.status !== "active" ||
        existing.profileKind !== "agent" ||
        existing.organizationId !== organizationId ||
        existing.managedRole !== managedRole
      ) {
        throw new ProfileNotFoundError();
      }

      if (profileName) {
        await repository.updateManagedProfileIdentityForOrganization(
          organizationId,
          profileId,
          {
            profileName,
            profileHandle: resolveAvailableProfileHandle({
              profileName,
              profileKind: "agent",
              takenHandles: [],
            }),
          }
        );
      }
      if (avatarStyle !== undefined) {
        await repository.updateAgentAvatarStyle(profileId, avatarStyle, {
          organizationId,
          avatarOptions: input.avatarOptions ?? null,
          expectedAvatarOptions: input.expectedAvatarOptions,
        });
      }

      const updated = await repository.findByProfileId(profileId);
      if (!updated) {
        throw new ProfileNotFoundError();
      }

      return updated;
    },
    deleteProfileForOwner: async (
      input: DeleteProfileForOwnerInput
    ): Promise<OpenMeldProfileRecord> => {
      const ownerUserId = normalizeRequiredText(
        input.ownerUserId,
        "ownerUserId"
      );
      const profileId = normalizeAnyProfileId(input.profileId, "profileId");
      const existing = await repository.findByOwnerAndProfileId(
        ownerUserId,
        profileId
      );

      if (existing?.status !== "active") {
        throw new ProfileNotFoundError();
      }

      if (
        input.expectedProfileKind &&
        existing.profileKind !== input.expectedProfileKind
      ) {
        throw new ProfileValidationError(
          "Only Agent Profiles can be removed through this endpoint."
        );
      }

      if (isDefaultHumanProfile(existing, ownerUserId)) {
        throw new PrimaryHumanProfileDeleteForbiddenError();
      }

      await repository.deleteProfileForOwner(ownerUserId, profileId);
      return existing;
    },
  };
}

type AgentProfileCreationIntent = {
  createdByUserId: string;
  creationActorProfileId: string;
  creatorProfileId: string;
  organizationId: string;
  profileName: string;
  source: OpenMeldProfileSource;
};

function normalizeAgentProfileCreationIdempotencyKey(
  value: string | null | undefined
): string | null {
  const normalized = normalizeOptionalText(value);
  if (
    normalized &&
    normalized.length > AGENT_PROFILE_CREATION_IDEMPOTENCY_KEY_MAX_LENGTH
  ) {
    throw new ProfileValidationError(
      `idempotencyKey must be at most ${AGENT_PROFILE_CREATION_IDEMPOTENCY_KEY_MAX_LENGTH} characters`
    );
  }
  return normalized;
}

async function findAgentProfileCreationReplay(input: {
  repository: OpenMeldProfileRepository;
  ownerUserId: string;
  creationIdempotencyKey: string | null;
  creationIntent: AgentProfileCreationIntent;
}): Promise<OpenMeldProfileRecord | null> {
  if (!input.creationIdempotencyKey) {
    return null;
  }
  const existing =
    await input.repository.findAgentByOwnerAndCreationIdempotencyKey(
      input.ownerUserId,
      input.creationIdempotencyKey
    );
  return existing
    ? requireMatchingAgentProfileCreationReplay(existing, input.creationIntent)
    : null;
}

async function findCommittedAgentProfile(input: {
  repository: OpenMeldProfileRepository;
  ownerUserId: string;
  profileId: string;
  creationIdempotencyKey: string | null;
  creationIntent: AgentProfileCreationIntent;
}): Promise<OpenMeldProfileRecord | null> {
  if (input.creationIdempotencyKey) {
    return await findAgentProfileCreationReplay(input);
  }
  return await input.repository.findByOwnerAndProfileId(
    input.ownerUserId,
    input.profileId
  );
}

function requireMatchingAgentProfileCreationReplay(
  profile: OpenMeldProfileRecord,
  expected: AgentProfileCreationIntent
): OpenMeldProfileRecord {
  if (
    profile.profileKind !== "agent" ||
    profile.managedRole !== null ||
    profile.organizationId !== expected.organizationId ||
    profile.profileName !== expected.profileName ||
    profile.creatorProfileId !== expected.creatorProfileId ||
    profile.creationActorProfileId !== expected.creationActorProfileId ||
    profile.source !== expected.source ||
    (profile.createdByUserId ?? profile.ownerUserId) !==
      expected.createdByUserId
  ) {
    throw new ProfileCreationIdempotencyConflictError();
  }

  return profile;
}

function normalizeRequiredText(value: string, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new ProfileValidationError(`${field} is required`);
  }
  return normalized;
}

function normalizeNullableRequiredText(
  value: string | null,
  field: string
): string | null {
  return value === null ? null : normalizeRequiredText(value, field);
}

function requireProfileSpaceHistoryService(
  service: ReturnType<typeof createProfileSpaceHistoryService> | null
): ReturnType<typeof createProfileSpaceHistoryService> {
  if (!service) {
    throw new Error("profile space history service is not configured");
  }
  return service;
}

function requireSpaceDeletionTombstoneService(
  service: ReturnType<typeof createSpaceDeletionTombstoneService> | null
): ReturnType<typeof createSpaceDeletionTombstoneService> {
  if (!service) {
    throw new Error("space deletion tombstone service is not configured");
  }
  return service;
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalProfileId(
  value: string | null | undefined,
  field: string
): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }

  return normalizeAnyProfileId(normalized, field);
}

function normalizeAnyProfileId(value: string, field: string): string {
  const normalized = normalizeRequiredText(value, field).toLowerCase();
  if (isUuidProfileId(normalized) || isAgentProfileId(normalized)) {
    return normalized;
  }

  throw new ProfileValidationError(`${field} must be a UUID or agt_<UUID>`);
}

function normalizeHumanProfileId(value: string, field: string): string {
  const normalized = normalizeRequiredText(value, field).toLowerCase();
  if (isUuidProfileId(normalized)) {
    return normalized;
  }

  throw new ProfileValidationError(`${field} must be a UUID`);
}

function normalizeAgentProfileId(value: string, field: string): string {
  const normalized = normalizeRequiredText(value, field).toLowerCase();
  if (isAgentProfileId(normalized)) {
    return normalized;
  }

  throw new ProfileValidationError(`${field} must be agt_<UUID>`);
}

function normalizeProfileKind(
  value: AuthProfileKind | null | undefined
): AuthProfileKind | null {
  if (value === "human" || value === "agent" || value === "system") {
    return value;
  }
  return null;
}

function normalizeManagedRole(
  value: OpenMeldProfileManagedRole | null | undefined
): OpenMeldProfileManagedRole {
  if (value === "openmeld_assistant" || value === "center_agent") {
    return value;
  }
  throw new ProfileValidationError("managedRole is invalid");
}

function defaultGenerateAgentProfileId(): string {
  return `${DEFAULT_AGENT_ID_PREFIX}${crypto.randomUUID()}`;
}

function defaultGeneratePrimaryHumanProfileId(_userId: string): string {
  return crypto.randomUUID();
}

function defaultGenerateHumanProfileId(): string {
  return crypto.randomUUID();
}

function isUuidProfileId(value: string): boolean {
  return UUID_PROFILE_ID_REGEX.test(value);
}

function isAgentProfileId(value: string): boolean {
  return AGENT_PROFILE_ID_REGEX.test(value);
}

function buildPrimaryHumanProfileName(input: {
  userId: string;
  userName?: string | null;
  userEmail?: string | null;
}): string {
  const userName = normalizeOptionalText(input.userName);
  if (userName) {
    return userName;
  }

  const userEmail = normalizeOptionalText(input.userEmail);
  if (userEmail) {
    const local = userEmail.split("@")[0] ?? "";
    const normalizedLocal = local.trim();
    if (normalizedLocal) {
      return normalizedLocal;
    }
  }

  return `${DEFAULT_HUMAN_NAME_PREFIX}-${input.userId.slice(0, 8)}`;
}

function assertPrimaryHumanProfile(
  profile: OpenMeldProfileRecord,
  expectedOwnerUserId: string
): void {
  if (isPrimaryHumanProfile(profile, expectedOwnerUserId)) {
    return;
  }

  throw new Error("invalid primary human profile state");
}

function isPrimaryHumanProfile(
  profile: OpenMeldProfileRecord,
  ownerUserId: string
): boolean {
  const isHuman = profile.profileKind === "human";
  const ownerMatches = profile.ownerUserId === ownerUserId;
  const isDefault = profile.isDefault === true;
  const hasValidProfileId = isUuidProfileId(profile.profileId.toLowerCase());
  return isHuman && ownerMatches && isDefault && hasValidProfileId;
}

function isDefaultHumanProfile(
  profile: OpenMeldProfileRecord,
  ownerUserId: string
): boolean {
  if (profile.profileKind !== "human") {
    return false;
  }

  if (profile.ownerUserId !== ownerUserId) {
    return false;
  }

  if (profile.isDefault === true) {
    return true;
  }
  return false;
}

function filterOrdinaryOwnerProfiles(
  profiles: readonly OpenMeldProfileRecord[]
): OpenMeldProfileRecord[] {
  return profiles.filter((profile) => profile.managedRole === null);
}

function buildResolvedCreatorProfileIdByProfileId(
  profiles: readonly OpenMeldProfileRecord[]
): Map<string, string | null> {
  const resolvedCreatorProfileIdByProfileId = new Map<string, string | null>();
  const defaultHumanProfileId = resolveDefaultHumanProfileId(profiles);

  for (const profile of profiles) {
    const explicitCreatorProfileId = normalizeOptionalProfileId(
      profile.creatorProfileId,
      "creatorProfileId"
    );
    if (explicitCreatorProfileId) {
      resolvedCreatorProfileIdByProfileId.set(
        profile.profileId,
        explicitCreatorProfileId
      );
      continue;
    }

    if (profile.profileKind === "agent" && defaultHumanProfileId) {
      resolvedCreatorProfileIdByProfileId.set(
        profile.profileId,
        defaultHumanProfileId
      );
      continue;
    }

    resolvedCreatorProfileIdByProfileId.set(profile.profileId, null);
  }

  return resolvedCreatorProfileIdByProfileId;
}

function resolveDefaultHumanProfileId(
  profiles: readonly OpenMeldProfileRecord[]
): string | null {
  const defaultHumanProfile = profiles.find(
    (profile) =>
      profile.ownerUserId && isDefaultHumanProfile(profile, profile.ownerUserId)
  );
  return defaultHumanProfile
    ? normalizeAnyProfileId(defaultHumanProfile.profileId, "profileId")
    : null;
}
