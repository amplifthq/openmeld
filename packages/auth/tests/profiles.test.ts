import { describe, expect, it } from "vitest";
import {
  PrimaryHumanProfileDeleteForbiddenError,
  ProfileCreationIdempotencyConflictError,
  ProfileNotFoundError,
  ProfileValidationError,
} from "../src/profiles/profile-errors";
import type {
  OpenMeldProfileRecord,
  OpenMeldProfileRepository,
} from "../src/profiles/profile-repository";
import { createOpenMeldProfileService } from "../src/profiles/profile-service";
import type {
  ProfileSpaceHistoryRecord,
  ProfileSpaceHistoryRepository,
} from "../src/profiles/profile-space-history-repository";
import type {
  SpaceDeletionTombstoneRecord,
  SpaceDeletionTombstoneRepository,
} from "../src/profiles/space-deletion-tombstone-repository";
import { createCapturedPostgresUniqueError } from "./postgresql-errors.test-support";

const TEST_AGENT_PROFILE_ID = "agt_aaaaaaaa-0000-0000-0000-000000000000";
const TEST_HUMAN_PROFILE_ID = "11111111-2222-4333-8444-555555555555";
const TEST_ORGANIZATION_ID = "org_test_profiles";

type ProfileSeed = Omit<
  OpenMeldProfileRecord,
  | "profileHandle"
  | "creationActorProfileId"
  | "creatorProfileId"
  | "creationIdempotencyKey"
  | "defaultProjectId"
  | "defaultProjectRevision"
  | "managedRole"
  | "avatarStyle"
  | "avatarOptions"
  | "organizationId"
  | "memberAgentId"
> &
  Partial<
    Pick<
      OpenMeldProfileRecord,
      | "profileHandle"
      | "creationActorProfileId"
      | "creatorProfileId"
      | "creationIdempotencyKey"
      | "defaultProjectId"
      | "defaultProjectRevision"
      | "managedRole"
      | "avatarStyle"
      | "avatarOptions"
      | "organizationId"
      | "memberAgentId"
    >
  >;

function withProfileDefaults(profile: ProfileSeed): OpenMeldProfileRecord {
  return {
    ...profile,
    profileHandle:
      profile.profileHandle ?? buildProfileHandleBaseForTest(profile),
    organizationId:
      profile.organizationId ??
      (profile.profileKind === "agent" ? TEST_ORGANIZATION_ID : null),
    creatorProfileId: profile.creatorProfileId ?? null,
    creationActorProfileId: profile.creationActorProfileId ?? null,
    creationIdempotencyKey: profile.creationIdempotencyKey ?? null,
    defaultProjectId: profile.defaultProjectId ?? null,
    defaultProjectRevision: profile.defaultProjectRevision ?? 0,
    managedRole: profile.managedRole ?? null,
    avatarStyle: profile.avatarStyle ?? null,
    avatarOptions: profile.avatarOptions ?? null,
    memberAgentId: profile.memberAgentId ?? null,
  };
}

function buildProfileHandleBaseForTest(input: {
  profileName: string;
  profileKind: OpenMeldProfileRecord["profileKind"];
}): string {
  const normalized = input.profileName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length > 0) {
    return normalized;
  }

  switch (input.profileKind) {
    case "human":
      return "human";
    case "system":
      return "system";
    default:
      return "agent";
  }
}

function createInMemoryRepository(
  initial: ProfileSeed[] = []
): OpenMeldProfileRepository & { profiles: OpenMeldProfileRecord[] } {
  const profiles = initial.map(withProfileDefaults);

  const repository: OpenMeldProfileRepository = {
    findFactsByProfileIds(profileIds) {
      return Promise.resolve(
        profiles.filter((profile) => profileIds.includes(profile.profileId))
      );
    },
    findByProfileId(profileId) {
      return Promise.resolve(
        profiles.find((profile) => profile.profileId === profileId) ?? null
      );
    },
    findByOwnerAndProfileId(ownerUserId, profileId) {
      return Promise.resolve(
        profiles.find(
          (profile) =>
            profile.ownerUserId === ownerUserId &&
            profile.profileId === profileId
        ) ?? null
      );
    },
    findAgentByOwnerAndCreationIdempotencyKey(
      ownerUserId,
      creationIdempotencyKey
    ) {
      return Promise.resolve(
        profiles.find(
          (profile) =>
            profile.ownerUserId === ownerUserId &&
            profile.profileKind === "agent" &&
            profile.creationIdempotencyKey === creationIdempotencyKey
        ) ?? null
      );
    },
    findDefaultHumanByOwner(ownerUserId) {
      return Promise.resolve(
        profiles.find(
          (profile) =>
            profile.ownerUserId === ownerUserId &&
            profile.profileKind === "human" &&
            profile.isDefault === true &&
            profile.status === "active"
        ) ?? null
      );
    },
    findDefaultHumanAndOwnedProfile(ownerUserId, profileId) {
      return Promise.resolve({
        defaultHumanProfile:
          profiles.find(
            (profile) =>
              profile.ownerUserId === ownerUserId &&
              profile.profileKind === "human" &&
              profile.isDefault === true &&
              profile.status === "active"
          ) ?? null,
        ownedProfile:
          profiles.find(
            (profile) =>
              profile.ownerUserId === ownerUserId &&
              profile.profileId === profileId
          ) ?? null,
      });
    },
    findManagedAgentByOwnerAndRole(ownerUserId, managedRole) {
      return Promise.resolve(
        profiles.find(
          (profile) =>
            profile.ownerUserId === ownerUserId &&
            profile.profileKind === "agent" &&
            profile.managedRole === managedRole &&
            profile.status === "active"
        ) ?? null
      );
    },
    isMemberAgentDefaultProfile() {
      return Promise.resolve(false);
    },
    findManagedAgentByOrganizationAndRole(organizationId, managedRole) {
      return Promise.resolve(
        profiles.find(
          (profile) =>
            profile.organizationId === organizationId &&
            profile.profileKind === "agent" &&
            profile.managedRole === managedRole &&
            profile.status === "active"
        ) ?? null
      );
    },
    listByOwner(ownerUserId) {
      return Promise.resolve(
        profiles.filter((profile) => profile.ownerUserId === ownerUserId)
      );
    },
    insertPrimaryHumanProfile(input) {
      const existing = profiles.find(
        (profile) => profile.profileId === input.profileId
      );
      if (existing) {
        return Promise.resolve();
      }

      const now = new Date("2026-02-19T00:00:00.000Z");
      profiles.push({
        profileId: input.profileId,
        profileName: input.profileName,
        profileHandle: input.profileHandle,
        profileKind: "human",
        organizationId: null,
        isDefault: true,
        status: "active",
        ownerUserId: input.ownerUserId,
        createdByUserId: input.createdByUserId ?? null,
        creationActorProfileId: null,
        creatorProfileId: input.creatorProfileId ?? null,
        creationIdempotencyKey: null,
        memberAgentId: null,
        defaultProjectId: null,
        defaultProjectRevision: 0,
        avatarStyle: null,
        avatarOptions: null,
        managedRole: null,
        source: input.source ?? "auth_bootstrap",
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      return Promise.resolve();
    },
    activateProfile(profileId) {
      const target = profiles.find(
        (profile) => profile.profileId === profileId
      );
      if (!target) {
        return Promise.resolve(false);
      }

      target.status = "active";
      target.isDefault = true;
      target.updatedAt = new Date("2026-02-19T00:00:00.000Z");

      return Promise.resolve(true);
    },
    insertAgentProfile(input) {
      const existing = profiles.find(
        (profile) =>
          profile.profileId === input.profileId ||
          (input.creationIdempotencyKey !== null &&
            input.creationIdempotencyKey !== undefined &&
            profile.ownerUserId === input.ownerUserId &&
            profile.creationIdempotencyKey === input.creationIdempotencyKey)
      );
      if (existing) {
        return Promise.resolve();
      }

      const now = new Date("2026-02-19T00:00:00.000Z");
      profiles.push({
        profileId: input.profileId,
        profileName: input.profileName,
        profileHandle: input.profileHandle,
        profileKind: "agent",
        organizationId: input.organizationId,
        isDefault: false,
        status: "active",
        ownerUserId: input.ownerUserId,
        createdByUserId: input.createdByUserId ?? null,
        creationActorProfileId: input.creationActorProfileId ?? null,
        creatorProfileId: input.creatorProfileId ?? null,
        creationIdempotencyKey: input.creationIdempotencyKey ?? null,
        memberAgentId: null,
        defaultProjectId: null,
        defaultProjectRevision: 0,
        avatarStyle: null,
        avatarOptions: null,
        managedRole: input.managedRole ?? null,
        source: input.source ?? "cli_create",
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      return Promise.resolve();
    },
    insertHumanProfile(input) {
      const existing = profiles.find(
        (profile) => profile.profileId === input.profileId
      );
      if (existing) {
        return Promise.resolve();
      }

      const now = new Date("2026-02-19T00:00:00.000Z");
      profiles.push({
        profileId: input.profileId,
        profileName: input.profileName,
        profileHandle: input.profileHandle,
        profileKind: "human",
        organizationId: null,
        isDefault: false,
        status: "active",
        ownerUserId: input.ownerUserId,
        createdByUserId: input.createdByUserId ?? null,
        creationActorProfileId: null,
        creatorProfileId: input.creatorProfileId ?? null,
        creationIdempotencyKey: null,
        memberAgentId: null,
        defaultProjectId: null,
        defaultProjectRevision: 0,
        avatarStyle: null,
        avatarOptions: null,
        managedRole: null,
        source: input.source ?? "cli_create",
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      return Promise.resolve();
    },
    updateManagedProfileIdentityForOrganization(
      organizationId,
      profileId,
      input
    ) {
      const target = profiles.find(
        (profile) =>
          profile.organizationId === organizationId &&
          profile.profileId === profileId &&
          profile.managedRole === "center_agent"
      );
      if (target) {
        target.profileName = input.profileName;
        target.profileHandle = input.profileHandle;
      }
      return Promise.resolve();
    },
    updateAgentAvatarStyle(profileId, avatarStyle, scope) {
      const profile = profiles.find(
        (item) =>
          item.profileId === profileId &&
          ("organizationId" in scope
            ? item.organizationId === scope.organizationId
            : item.ownerUserId === scope.ownerUserId)
      );
      if (profile) {
        profile.avatarStyle = avatarStyle;
        if ("avatarOptions" in scope) {
          profile.avatarOptions = scope.avatarOptions ?? null;
        }
      }
      return Promise.resolve();
    },
    updateProfileIdentityForOwner(ownerUserId, profileId, input) {
      const target = profiles.find(
        (profile) =>
          profile.ownerUserId === ownerUserId && profile.profileId === profileId
      );
      if (!target) {
        return Promise.resolve();
      }

      target.profileName = input.profileName;
      target.profileHandle = input.profileHandle;
      target.updatedAt = new Date("2026-02-19T00:00:00.000Z");
      return Promise.resolve();
    },
    updateAgentProfileDefaultProjectForOwner(
      ownerUserId,
      organizationId,
      profileId,
      defaultProjectId,
      onlyIfUnmodified
    ) {
      const profile = profiles.find(
        (candidate) =>
          candidate.ownerUserId === ownerUserId &&
          candidate.organizationId === organizationId &&
          candidate.profileId === profileId &&
          candidate.profileKind === "agent"
      );
      if (
        profile &&
        (!onlyIfUnmodified || profile.defaultProjectRevision === 0)
      ) {
        profile.defaultProjectId = defaultProjectId;
        profile.defaultProjectRevision =
          (profile.defaultProjectRevision ?? 0) + 1;
        profile.updatedAt = new Date(profile.updatedAt.getTime() + 1);
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    },
    deleteProfileForOwner(ownerUserId, profileId) {
      const index = profiles.findIndex(
        (profile) =>
          profile.ownerUserId === ownerUserId && profile.profileId === profileId
      );
      if (index < 0) {
        return Promise.resolve();
      }

      profiles.splice(index, 1);
      return Promise.resolve();
    },
  };

  return Object.assign(repository, { profiles });
}

function createInMemoryProfileSpaceHistoryRepository(
  initial: ProfileSpaceHistoryRecord[] = []
): ProfileSpaceHistoryRepository {
  const records = [...initial];

  const findRecord = (input: {
    profileId: string;
    gatewayHost: string;
    spaceId: string;
  }): ProfileSpaceHistoryRecord | undefined => {
    return records.find(
      (record) =>
        record.profileId === input.profileId &&
        record.gatewayHost === input.gatewayHost &&
        record.spaceId === input.spaceId
    );
  };

  return {
    listByProfileAndGateway(input) {
      const statuses = input.statuses ?? [];
      return Promise.resolve(
        records
          .filter((record) => {
            if (
              record.profileId !== input.profileId ||
              record.gatewayHost !== input.gatewayHost
            ) {
              return false;
            }
            if (statuses.length > 0 && !statuses.includes(record.status)) {
              return false;
            }
            if (input.pinned === true) {
              return record.pinnedAt !== null;
            }
            if (input.pinned === false) {
              return record.pinnedAt === null;
            }
            return true;
          })
          .sort((a, b) => {
            if (input.pinned === true) {
              const pinnedDiff =
                (b.pinnedAt?.getTime() ?? 0) - (a.pinnedAt?.getTime() ?? 0);
              if (pinnedDiff !== 0) {
                return pinnedDiff;
              }
            }
            const joinedDiff =
              b.lastJoinedAt.getTime() - a.lastJoinedAt.getTime();
            if (joinedDiff !== 0) {
              return joinedDiff;
            }
            return b.updatedAt.getTime() - a.updatedAt.getTime();
          })
          .slice(0, input.limit)
      );
    },
    listByProfilesAndGateway(input) {
      const profileIds = new Set(input.profileIds);
      const statuses = input.statuses ?? [];
      if (profileIds.size === 0) {
        return Promise.resolve([]);
      }

      return Promise.resolve(
        records
          .filter((record) => {
            if (
              !profileIds.has(record.profileId) ||
              record.gatewayHost !== input.gatewayHost
            ) {
              return false;
            }
            return statuses.length === 0 || statuses.includes(record.status);
          })
          .sort((a, b) => {
            const joinedDiff =
              b.lastJoinedAt.getTime() - a.lastJoinedAt.getTime();
            if (joinedDiff !== 0) {
              return joinedDiff;
            }
            return b.updatedAt.getTime() - a.updatedAt.getTime();
          })
          .slice(0, input.limit)
      );
    },
    listAccessibleSpaceIds(input) {
      if (input.profileIds.length === 0 || input.spaceIds.length === 0) {
        return Promise.resolve([]);
      }

      const matchedSpaceIds = records
        .filter(
          (record) =>
            input.profileIds.includes(record.profileId) &&
            record.gatewayHost === input.gatewayHost &&
            input.spaceIds.includes(record.spaceId)
        )
        .map((record) => record.spaceId);

      return Promise.resolve(Array.from(new Set(matchedSpaceIds)));
    },
    upsert(input) {
      const existing = findRecord(input);
      const now = new Date("2026-02-24T00:00:00.000Z");

      if (existing) {
        const updated: ProfileSpaceHistoryRecord = {
          ...existing,
          spaceName: input.spaceName ?? existing.spaceName,
          creatorProfileId: input.creatorProfileId ?? existing.creatorProfileId,
          creatorKind: input.creatorKind ?? existing.creatorKind,
          spaceCreatedAt: input.spaceCreatedAt ?? existing.spaceCreatedAt,
          spaceUpdatedAt: input.spaceUpdatedAt ?? existing.spaceUpdatedAt,
          lastJoinedAt: input.lastJoinedAt ?? existing.lastJoinedAt,
          lastSeenTs: input.lastSeenTs ?? existing.lastSeenTs,
          pinnedAt:
            input.pinnedAt === undefined ? existing.pinnedAt : input.pinnedAt,
          status: input.status ?? existing.status,
          updatedAt: now,
        };

        const index = records.findIndex(
          (record) =>
            record.profileId === updated.profileId &&
            record.gatewayHost === updated.gatewayHost &&
            record.spaceId === updated.spaceId
        );
        records[index] = updated;
        return Promise.resolve(updated);
      }

      const created: ProfileSpaceHistoryRecord = {
        profileId: input.profileId,
        gatewayHost: input.gatewayHost,
        spaceId: input.spaceId,
        spaceName: input.spaceName ?? null,
        creatorProfileId: input.creatorProfileId ?? null,
        creatorKind: input.creatorKind ?? null,
        spaceCreatedAt: input.spaceCreatedAt ?? null,
        spaceUpdatedAt: input.spaceUpdatedAt ?? null,
        lastJoinedAt: input.lastJoinedAt ?? now,
        lastSeenTs: input.lastSeenTs ?? null,
        pinnedAt: input.pinnedAt ?? null,
        status: input.status ?? "active",
        createdAt: now,
        updatedAt: now,
      };
      records.push(created);
      return Promise.resolve(created);
    },
    updateStatus(input) {
      const existing = findRecord(input);
      if (!existing) {
        return Promise.resolve(null);
      }

      existing.status = input.status;
      existing.updatedAt = new Date("2026-02-24T00:00:00.000Z");
      return Promise.resolve(existing);
    },
  };
}

function createInMemorySpaceDeletionTombstoneRepository(
  initial: SpaceDeletionTombstoneRecord[] = []
): SpaceDeletionTombstoneRepository {
  const records = [...initial];

  const findRecord = (input: {
    gatewayHost: string;
    spaceId: string;
  }): SpaceDeletionTombstoneRecord | undefined => {
    return records.find(
      (record) =>
        record.gatewayHost === input.gatewayHost &&
        record.spaceId === input.spaceId
    );
  };

  return {
    queryByGatewayAndSpaceIds(input) {
      const requested = new Set(input.spaceIds);
      return Promise.resolve(
        records.filter(
          (record) =>
            record.gatewayHost === input.gatewayHost &&
            requested.has(record.spaceId)
        )
      );
    },
    upsert(input) {
      const existing = findRecord(input);
      const now = new Date("2026-03-12T00:00:00.000Z");

      if (existing) {
        const updated: SpaceDeletionTombstoneRecord = {
          ...existing,
          spaceName:
            input.spaceName === undefined
              ? existing.spaceName
              : input.spaceName,
          creatorProfileId:
            input.creatorProfileId === undefined
              ? existing.creatorProfileId
              : input.creatorProfileId,
          creatorKind:
            input.creatorKind === undefined
              ? existing.creatorKind
              : input.creatorKind,
          deletedByProfileId:
            input.deletedByProfileId ?? existing.deletedByProfileId,
          deletedByProfileName:
            input.deletedByProfileName ?? existing.deletedByProfileName,
          deletedByOwnerUserId:
            input.deletedByOwnerUserId ?? existing.deletedByOwnerUserId,
          deletedAt: input.deletedAt ?? existing.deletedAt,
          updatedAt: now,
        };
        const index = records.findIndex(
          (record) =>
            record.gatewayHost === updated.gatewayHost &&
            record.spaceId === updated.spaceId
        );
        records[index] = updated;
        return Promise.resolve(updated);
      }

      const created: SpaceDeletionTombstoneRecord = {
        gatewayHost: input.gatewayHost,
        spaceId: input.spaceId,
        spaceName: input.spaceName ?? null,
        creatorProfileId: input.creatorProfileId ?? null,
        creatorKind: input.creatorKind ?? null,
        deletedByProfileId: input.deletedByProfileId ?? null,
        deletedByProfileName: input.deletedByProfileName ?? null,
        deletedByOwnerUserId: input.deletedByOwnerUserId ?? null,
        deletedAt: input.deletedAt ?? now,
        createdAt: now,
        updatedAt: now,
      };
      records.push(created);
      return Promise.resolve(created);
    },
  };
}

describe("OpenMeld profile service", () => {
  it("creates primary human profile when missing", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
    });

    const profile = await service.ensurePrimaryHumanProfile({
      userId: "user_1",
      userName: "Felix",
      userEmail: "felix@openmeld.invalid",
    });

    expect(profile.profileId).toMatch(UUID_REGEX);
    expect(profile.profileKind).toBe("human");
    expect(profile.isDefault).toBe(true);
    expect(profile.ownerUserId).toBe("user_1");
    expect(profile.profileName).toBe("Felix");
    expect(profile.profileHandle).toBe("felix");

    const listed = await service.listProfilesForOwner("user_1");
    expect(listed).toHaveLength(1);
  });

  it("is idempotent when ensuring primary human profile", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
    });

    const first = await service.ensurePrimaryHumanProfile({
      userId: "user_1",
      userName: "Felix",
      userEmail: "felix@openmeld.invalid",
    });
    await service.ensurePrimaryHumanProfile({
      userId: "user_1",
      userName: "Felix v2",
      userEmail: "felix@openmeld.invalid",
    });

    const listed = await service.listProfilesForOwner("user_1");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.profileId).toBe(first.profileId);
    expect(listed[0]?.profileKind).toBe("human");
    expect(listed[0]?.isDefault).toBe(true);
  });

  it("ensures the primary human profile before listing profiles for an owner", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
    });

    const listed =
      await service.listProfilesForOwnerEnsuringPrimaryHumanProfile({
        ownerUserId: "user_1",
        userName: "Felix",
        userEmail: "felix@openmeld.invalid",
      });

    expect(listed).toHaveLength(1);
    expect(listed[0]?.profileKind).toBe("human");
    expect(listed[0]?.isDefault).toBe(true);
    expect(listed[0]?.profileName).toBe("Felix");
  });

  it("does not create a second default human profile when listing an owner that already has one", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
    });

    const first = await service.ensurePrimaryHumanProfile({
      userId: "user_1",
      userName: "Felix",
      userEmail: "felix@openmeld.invalid",
    });

    const listed =
      await service.listProfilesForOwnerEnsuringPrimaryHumanProfile({
        ownerUserId: "user_1",
        userName: "Felix",
        userEmail: "felix@openmeld.invalid",
      });

    expect(listed).toHaveLength(1);
    expect(listed[0]?.profileId).toBe(first.profileId);
    expect(listed[0]?.isDefault).toBe(true);
  });

  it("retries primary human creation when another profile claims the first handle", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      generatePrimaryHumanProfileId: () =>
        "99999999-1111-2222-3333-444444444444",
    });
    const insertPrimaryHumanProfile =
      repository.insertPrimaryHumanProfile.bind(repository);
    let conflictInjected = false;

    repository.insertPrimaryHumanProfile = (input) => {
      if (!conflictInjected) {
        conflictInjected = true;
        repository.profiles.push(
          withProfileDefaults({
            profileId: "88888888-1111-2222-3333-444444444444",
            profileName: input.profileName,
            profileHandle: input.profileHandle,
            profileKind: "human",
            isDefault: false,
            status: "active",
            ownerUserId: input.ownerUserId,
            createdByUserId: input.createdByUserId ?? input.ownerUserId,
            source: "cli_create",
            lastUsedAt: null,
            createdAt: new Date("2026-02-19T00:00:00.000Z"),
            updatedAt: new Date("2026-02-19T00:00:00.000Z"),
          })
        );
        return Promise.resolve();
      }

      return insertPrimaryHumanProfile(input);
    };

    const profile = await service.ensurePrimaryHumanProfile({
      userId: "user_1",
      userName: "Felix",
      userEmail: "felix@openmeld.invalid",
    });

    expect(conflictInjected).toBe(true);
    expect(profile.profileId).toBe("99999999-1111-2222-3333-444444444444");
    expect(profile.profileHandle).toBe("felix-2");
    expect(profile.isDefault).toBe(true);
  });

  it("creates a new default profile when only non-default human profile exists", async () => {
    const now = new Date("2026-02-19T00:00:00.000Z");
    const repository = createInMemoryRepository([
      {
        profileId: "99999999-1111-2222-3333-444444444444",
        profileName: "Felix",
        profileKind: "human",
        isDefault: false,
        status: "active",
        ownerUserId: "user_1",
        createdByUserId: "user_1",
        source: "auth_bootstrap",
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
    });

    const ensured = await service.ensurePrimaryHumanProfile({
      userId: "user_1",
      userName: "Felix",
      userEmail: "felix@openmeld.invalid",
    });

    expect(ensured.isDefault).toBe(true);
  });

  it("resolves explicit profile only when owner matches and profile exists", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
    });

    const primary = await service.ensurePrimaryHumanProfile({
      userId: "user_1",
      userName: "Felix",
      userEmail: "felix@openmeld.invalid",
    });

    await expect(
      service.resolveProfileForOwner({
        ownerUserId: "user_2",
        profileId: primary.profileId,
      })
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it("creates agent profile with agt_ prefix", async () => {
    const repository = createInMemoryRepository();
    const generatedAgentProfileId = "agt_12345678-1111-2222-3333-444444444444";
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => generatedAgentProfileId,
    });

    const created = await service.createAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Research Bot",
    });

    expect(created.profileId).toBe(generatedAgentProfileId);
    expect(created.organizationId).toBe(TEST_ORGANIZATION_ID);
    expect(created.profileKind).toBe("agent");
    expect(created.isDefault).toBe(false);
    expect(created.ownerUserId).toBe("user_1");
    expect(created.source).toBe("cli_create");
    expect(created.managedRole).toBeNull();
    expect(created.profileHandle).toBe("research-bot");
    expect(created.creatorProfileId).toBeTruthy();
  });

  it("preserves the creation entry point and actor separately from profile lineage", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
    });
    const ownerProfile = await service.ensurePrimaryHumanProfile({
      userId: "user_1",
      userName: "Felix",
      userEmail: "felix@openmeld.invalid",
    });

    const created = await service.createAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      creationActorProfileId: "agt_center-agent",
      creatorProfileId: ownerProfile.profileId,
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Research Bot",
      source: "center_agent_create",
    });

    expect(created.creatorProfileId).toBe(ownerProfile.profileId);
    expect(created.creationActorProfileId).toBe("agt_center-agent");
    expect(created.source).toBe("center_agent_create");
  });

  it("returns the committed Agent Profile when creation is replayed with the same idempotency key", async () => {
    const repository = createInMemoryRepository();
    const generatedAgentProfileIds = [
      "agt_12345678-1111-2222-3333-444444444444",
      "agt_22345678-1111-2222-3333-444444444444",
    ];
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => {
        const next = generatedAgentProfileIds.shift();
        if (!next) {
          throw new Error("missing generated agent profile id");
        }
        return next;
      },
    });
    const input = {
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Research Bot",
      idempotencyKey: "agent-profile-create:request-123",
    };

    const created = await service.createAgentProfile(input);
    const replayed = await service.createAgentProfile(input);

    expect(replayed.profileId).toBe(created.profileId);
    expect(
      repository.profiles.filter(
        (profile) =>
          profile.profileKind === "agent" &&
          profile.creationIdempotencyKey === input.idempotencyKey
      )
    ).toHaveLength(1);
    expect(generatedAgentProfileIds).toHaveLength(1);
  });

  it("commits one Agent Profile when concurrent creations use the same idempotency key", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository);
    const input = {
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Research Bot",
      idempotencyKey: "agent-profile-create:concurrent-request-123",
    };

    const createdProfiles = await Promise.all([
      service.createAgentProfile(input),
      service.createAgentProfile(input),
    ]);

    expect(
      new Set(createdProfiles.map((profile) => profile.profileId))
    ).toEqual(new Set([createdProfiles[0]?.profileId]));
    expect(
      repository.profiles.filter(
        (profile) =>
          profile.profileKind === "agent" &&
          profile.creationIdempotencyKey === input.idempotencyKey
      )
    ).toHaveLength(1);
  });

  it("rejects reuse of an Agent Profile creation idempotency key for another intent", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository);
    const sharedInput = {
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      idempotencyKey: "agent-profile-create:request-123",
    };

    await service.createAgentProfile({
      ...sharedInput,
      profileName: "Research Bot",
    });

    await expect(
      service.createAgentProfile({
        ...sharedInput,
        profileName: "Release Bot",
      })
    ).rejects.toBeInstanceOf(ProfileCreationIdempotencyConflictError);
  });

  it("rejects reuse of an idempotency key from another creation actor", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository);
    const sharedInput = {
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Research Bot",
      idempotencyKey: "agent-profile-create:request-actor-123",
      source: "center_agent_create" as const,
    };

    await service.createAgentProfile({
      ...sharedInput,
      creationActorProfileId: "agt_center-agent-a",
    });

    await expect(
      service.createAgentProfile({
        ...sharedInput,
        creationActorProfileId: "agt_center-agent-b",
      })
    ).rejects.toBeInstanceOf(ProfileCreationIdempotencyConflictError);
  });

  it("ensures one managed OpenMeld assistant profile by role instead of display name", async () => {
    const repository = createInMemoryRepository([
      {
        profileId: "agt_99999999-0000-0000-0000-000000000000",
        profileName: "Felix's OpenMeld Assistant",
        profileKind: "agent",
        isDefault: false,
        status: "active",
        ownerUserId: "user_1",
        createdByUserId: "user_1",
        source: "cli_create",
        lastUsedAt: null,
        createdAt: new Date("2026-02-19T00:00:00.000Z"),
        updatedAt: new Date("2026-02-19T00:00:00.000Z"),
      },
    ]);
    const generatedAgentProfileId = "agt_12345678-1111-2222-3333-444444444444";
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => generatedAgentProfileId,
    });

    const created = await service.ensureManagedAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      managedRole: "openmeld_assistant",
      profileName: "Felix's OpenMeld Assistant",
    });
    const ensuredAgain = await service.ensureManagedAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      managedRole: "openmeld_assistant",
      profileName: "Felix's Welcoming Assistant",
    });

    expect(created.profileId).toBe(generatedAgentProfileId);
    expect(created.profileKind).toBe("agent");
    expect(created.managedRole).toBe("openmeld_assistant");
    expect(created.source).toBe("auth_bootstrap");
    expect(created.profileHandle).toBe("felix-s-openmeld-assistant-2");
    expect(ensuredAgain.profileId).toBe(created.profileId);
    expect(ensuredAgain.profileName).toBe("Felix's OpenMeld Assistant");
    expect(repository.profiles).toHaveLength(3);
  });

  it("ensures one managed Center Agent profile per organization", async () => {
    const repository = createInMemoryRepository();
    const generatedAgentProfileIds = [
      "agt_12345678-1111-2222-3333-444444444444",
      "agt_22345678-1111-2222-3333-444444444444",
    ];
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => {
        const next = generatedAgentProfileIds.shift();
        if (!next) {
          throw new Error("missing generated agent profile id");
        }
        return next;
      },
    });

    const createdForFirstOrg = await service.ensureManagedAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      managedRole: "center_agent",
      profileName: "Center Agent",
    });
    const ensuredAgainForFirstOrg = await service.ensureManagedAgentProfile({
      ownerUserId: "user_2",
      createdByUserId: "user_2",
      organizationId: TEST_ORGANIZATION_ID,
      managedRole: "center_agent",
      profileName: "Renamed Center Agent",
    });
    const createdForSecondOrg = await service.ensureManagedAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: "org_second",
      managedRole: "center_agent",
      profileName: "Center Agent",
    });

    expect(ensuredAgainForFirstOrg.profileId).toBe(
      createdForFirstOrg.profileId
    );
    expect(createdForSecondOrg.profileId).not.toBe(
      createdForFirstOrg.profileId
    );
    expect(createdForFirstOrg.managedRole).toBe("center_agent");
    expect(createdForFirstOrg.ownerUserId).toBeNull();
    expect(createdForFirstOrg.createdByUserId).toBe("user_1");
    expect(createdForFirstOrg.organizationId).toBe(TEST_ORGANIZATION_ID);
    expect(createdForSecondOrg.managedRole).toBe("center_agent");
    const renamed = await service.updateManagedAgentProfileInOrganization({
      organizationId: TEST_ORGANIZATION_ID,
      profileId: createdForFirstOrg.profileId,
      managedRole: "center_agent",
      profileName: "Organization Coordinator",
    });
    expect(renamed.profileId).toBe(createdForFirstOrg.profileId);
    expect(renamed.ownerUserId).toBeNull();
    expect(renamed.profileHandle).toBe("organization-coordinator");
    expect(
      repository.profiles.filter(
        (profile) =>
          profile.profileKind === "agent" &&
          profile.managedRole === "center_agent" &&
          profile.status === "active"
      )
    ).toHaveLength(2);
  });

  it("keeps managed profiles out of ordinary owner profile lists", async () => {
    const repository = createInMemoryRepository();
    const generatedAgentProfileIds = [
      "agt_12345678-1111-2222-3333-444444444444",
      "agt_22345678-1111-2222-3333-444444444444",
      "agt_32345678-1111-2222-3333-444444444444",
    ];
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => {
        const next = generatedAgentProfileIds.shift();
        if (!next) {
          throw new Error("missing generated agent profile id");
        }
        return next;
      },
    });

    await service.ensurePrimaryHumanProfile({
      userId: "user_1",
      userName: "Felix",
      userEmail: "felix@openmeld.invalid",
    });
    const ordinaryAgent = await service.createAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Scout",
    });
    const centerAgent = await service.ensureManagedAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      managedRole: "center_agent",
      profileName: "Center Agent",
    });
    const welcomingAssistant = await service.ensureManagedAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      managedRole: "openmeld_assistant",
      profileName: "Felix's Welcoming Assistant",
    });

    const listed = await service.listProfilesForOwner("user_1");

    expect(listed.map((profile) => profile.profileId)).toContain(
      ordinaryAgent.profileId
    );
    expect(listed.map((profile) => profile.profileId)).not.toContain(
      centerAgent.profileId
    );
    expect(listed.map((profile) => profile.profileId)).not.toContain(
      welcomingAssistant.profileId
    );
    expect(
      repository.profiles.some(
        (profile) =>
          profile.profileId === centerAgent.profileId &&
          profile.managedRole === "center_agent"
      )
    ).toBe(true);
    expect(
      repository.profiles.some(
        (profile) =>
          profile.profileId === welcomingAssistant.profileId &&
          profile.managedRole === "openmeld_assistant"
      )
    ).toBe(true);
  });

  it("keeps Remote Agent avatar overrides owner-scoped and Center Agent avatars organization-scoped", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: (() => {
        const ids = [
          "agt_12345678-1111-2222-3333-444444444444",
          "agt_22345678-1111-2222-3333-444444444444",
        ];
        return () => ids.shift() ?? "agt_32345678-1111-2222-3333-444444444444";
      })(),
    });
    const remote = await service.createAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Remote",
    });
    const center = await service.ensureManagedAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      managedRole: "center_agent",
      profileName: "Center Agent",
    });
    await expect(
      service.updateAgentAvatarStyleForOwner({
        ownerUserId: "user_2",
        profileId: remote.profileId,
        avatarStyle: "fluid",
      })
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
    await expect(
      service.updateAgentAvatarStyleForOwner({
        ownerUserId: "user_1",
        profileId: center.profileId,
        avatarStyle: "fluid",
      })
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
    const remoteUpdated = await service.updateAgentAvatarStyleForOwner({
      ownerUserId: "user_1",
      profileId: remote.profileId,
      avatarStyle: "fluid",
    });
    expect(remoteUpdated.avatarStyle).toBe("fluid");
    const centerUpdated = await service.updateManagedAgentProfileInOrganization(
      {
        organizationId: TEST_ORGANIZATION_ID,
        profileId: center.profileId,
        managedRole: "center_agent",
        avatarStyle: "ghost",
        avatarOptions: { palette: "balanced" },
      }
    );
    expect(centerUpdated.avatarStyle).toBe("ghost");
    expect(centerUpdated.avatarOptions).toEqual({ palette: "balanced" });
    await expect(
      service.updateManagedAgentProfileInOrganization({
        organizationId: "org_other",
        profileId: center.profileId,
        managedRole: "center_agent",
        avatarStyle: "star",
      })
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it("still allows multiple ordinary Agent Profiles in the same organization", async () => {
    const repository = createInMemoryRepository();
    const generatedAgentProfileIds = [
      "agt_12345678-1111-2222-3333-444444444444",
      "agt_22345678-1111-2222-3333-444444444444",
    ];
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => {
        const next = generatedAgentProfileIds.shift();
        if (!next) {
          throw new Error("missing generated agent profile id");
        }
        return next;
      },
    });

    const first = await service.createAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Research Bot",
    });
    const second = await service.createAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Shipping Bot",
    });

    expect(first.managedRole).toBeNull();
    expect(second.managedRole).toBeNull();
    expect(first.profileId).not.toBe(second.profileId);
    expect(
      repository.profiles.filter(
        (profile) =>
          profile.organizationId === TEST_ORGANIZATION_ID &&
          profile.profileKind === "agent" &&
          profile.managedRole === null
      )
    ).toHaveLength(2);
  });

  it("returns the active managed profile when a concurrent insert wins the race", async () => {
    const repository = createInMemoryRepository();
    const concurrentProfile = withProfileDefaults({
      profileId: "agt_22222222-1111-2222-3333-444444444444",
      profileName: "Felix's OpenMeld Assistant",
      profileKind: "agent",
      isDefault: false,
      status: "active",
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      managedRole: "openmeld_assistant",
      source: "auth_bootstrap",
      lastUsedAt: null,
      createdAt: new Date("2026-02-19T00:00:00.000Z"),
      updatedAt: new Date("2026-02-19T00:00:00.000Z"),
    });
    let insertCalls = 0;
    const racingRepository: OpenMeldProfileRepository = {
      ...repository,
      insertAgentProfile(input) {
        insertCalls += 1;
        if (input.managedRole === "openmeld_assistant") {
          repository.profiles.push(concurrentProfile);
          return Promise.resolve();
        }

        return repository.insertAgentProfile(input);
      },
    };
    const service = createOpenMeldProfileService(racingRepository, {
      generateAgentProfileId: () => "agt_12345678-1111-2222-3333-444444444444",
    });

    const ensured = await service.ensureManagedAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      managedRole: "openmeld_assistant",
      profileName: "Felix's OpenMeld Assistant",
    });

    expect(ensured.profileId).toBe(concurrentProfile.profileId);
    expect(insertCalls).toBe(1);
    expect(
      repository.profiles.filter(
        (profile) =>
          profile.profileKind === "agent" &&
          profile.managedRole === "openmeld_assistant" &&
          profile.status === "active"
      )
    ).toHaveLength(1);
  });

  it("rejects additional Human Profile creation when the capability is disabled", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository);

    expect(service.getProfileCapabilities()).toEqual({
      additionalHumanProfileCreationEnabled: false,
    });

    await expect(
      service.createHumanProfile({
        ownerUserId: "user_1",
        createdByUserId: "user_1",
        profileName: "Felix Secondary",
      })
    ).rejects.toMatchObject({
      code: "profile.additional_human_profile_creation_disabled",
      message:
        "Creating additional profiles for people is currently unavailable. Use your default profile, or create an Agent.",
    });
    expect(repository.profiles).toEqual([]);
  });

  it("creates non-default human profile", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      additionalHumanProfileCreationEnabled: true,
      generateHumanProfileId: () => TEST_HUMAN_PROFILE_ID,
    });

    expect(service.getProfileCapabilities()).toEqual({
      additionalHumanProfileCreationEnabled: true,
    });

    const created = await service.createHumanProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      profileName: "Felix Secondary",
    });

    expect(created.profileId).toBe(TEST_HUMAN_PROFILE_ID);
    expect(created.profileKind).toBe("human");
    expect(created.isDefault).toBe(false);
    expect(created.ownerUserId).toBe("user_1");
    expect(created.source).toBe("cli_create");
    expect(created.profileHandle).toBe("felix-secondary");
  });

  it("requires creatorProfileId for non-root human profiles", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      additionalHumanProfileCreationEnabled: true,
      generateHumanProfileId: (() => {
        const ids = [
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
        ];
        let index = 0;
        return () => ids[index++] ?? TEST_HUMAN_PROFILE_ID;
      })(),
    });

    await service.createHumanProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      profileName: "Root Human",
    });

    await expect(
      service.createHumanProfile({
        ownerUserId: "user_1",
        createdByUserId: "user_1",
        profileName: "Child Human",
      })
    ).rejects.toMatchObject({
      code: "profile.invalid_input",
      message: "creatorProfileId is required for non-root human profiles",
    });
  });

  it("treats the first human as root even when the owner already has agent profiles", async () => {
    const repository = createInMemoryRepository([
      {
        profileId: TEST_AGENT_PROFILE_ID,
        profileName: "Agent First",
        profileKind: "agent",
        isDefault: false,
        status: "active",
        ownerUserId: "user_1",
        createdByUserId: "user_1",
        creatorProfileId: null,
        source: "cli_create",
        lastUsedAt: null,
        createdAt: new Date("2026-02-19T00:00:00.000Z"),
        updatedAt: new Date("2026-02-19T00:00:00.000Z"),
      },
    ]);
    const service = createOpenMeldProfileService(repository, {
      additionalHumanProfileCreationEnabled: true,
      generateHumanProfileId: () => TEST_HUMAN_PROFILE_ID,
    });

    const created = await service.createHumanProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      profileName: "First Human",
    });

    expect(created.profileKind).toBe("human");
    expect(created.creatorProfileId).toBeNull();
    expect(created.isDefault).toBe(false);
  });

  it("canonicalizes creatorProfileId before looking up the active creator", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      additionalHumanProfileCreationEnabled: true,
      generateHumanProfileId: (() => {
        const ids = [
          TEST_HUMAN_PROFILE_ID,
          "22222222-2222-4222-8222-222222222222",
        ];
        let index = 0;
        return () => ids[index++] ?? TEST_HUMAN_PROFILE_ID;
      })(),
    });

    const rootHuman = await service.createHumanProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      profileName: "Root Human",
    });

    const created = await service.createHumanProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      profileName: "Child Human",
      creatorProfileId: rootHuman.profileId.toUpperCase(),
    });

    expect(created.creatorProfileId).toBe(rootHuman.profileId);
  });

  it("allows deleting non-default human profile", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      additionalHumanProfileCreationEnabled: true,
      generateHumanProfileId: () => TEST_HUMAN_PROFILE_ID,
    });

    const created = await service.createHumanProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      profileName: "Human Extra",
    });

    await service.deleteProfileForOwner({
      ownerUserId: "user_1",
      profileId: created.profileId,
    });

    await expect(
      service.resolveProfileForOwner({
        ownerUserId: "user_1",
        profileId: created.profileId,
      })
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it("updates profile name for owned profile", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
    });

    await service.createAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Old Name",
    });

    const updated = await service.updateProfileNameForOwner({
      ownerUserId: "user_1",
      profileId: TEST_AGENT_PROFILE_ID,
      profileName: "New Name",
    });

    expect(updated.profileName).toBe("New Name");
    expect(updated.profileHandle).toBe("new-name");
  });

  it("sets and clears the Default Project for an ordinary Agent Profile", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
    });
    await service.createAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Project Agent",
    });

    const defaultProjectService = service as typeof service & {
      updateAgentProfileDefaultProjectForOwner(input: {
        defaultProjectId: string | null;
        organizationId: string;
        ownerUserId: string;
        profileId: string;
      }): Promise<OpenMeldProfileRecord & { defaultProjectId: string | null }>;
    };
    const updated =
      await defaultProjectService.updateAgentProfileDefaultProjectForOwner({
        defaultProjectId: "project_alpha",
        organizationId: TEST_ORGANIZATION_ID,
        ownerUserId: "user_1",
        profileId: TEST_AGENT_PROFILE_ID,
      });
    expect(updated.defaultProjectId).toBe("project_alpha");

    const cleared =
      await defaultProjectService.updateAgentProfileDefaultProjectForOwner({
        defaultProjectId: null,
        organizationId: TEST_ORGANIZATION_ID,
        ownerUserId: "user_1",
        profileId: TEST_AGENT_PROFILE_ID,
      });
    expect(cleared.defaultProjectId).toBeNull();
  });

  it("reports an Organization mismatch instead of misclassifying a local Agent Profile", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
    });
    await service.createAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Project Agent",
    });

    await expect(
      service.updateAgentProfileDefaultProjectForOwner({
        defaultProjectId: "project_alpha",
        organizationId: "organization-other",
        ownerUserId: "user_1",
        profileId: TEST_AGENT_PROFILE_ID,
      })
    ).rejects.toMatchObject({
      code: "profile.organization_mismatch",
      message: "This Agent Profile does not belong to this Organization.",
    });
  });

  it("rejects Default Project writes for managed and human profiles", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
    });
    const human = await service.ensurePrimaryHumanProfile({
      userId: "user_1",
      userName: "Human",
    });
    const centerAgent = await service.ensureManagedAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      creatorProfileId: human.profileId,
      organizationId: TEST_ORGANIZATION_ID,
      managedRole: "center_agent",
      profileName: "Center Agent",
    });
    const defaultProjectService = service as typeof service & {
      updateAgentProfileDefaultProjectForOwner(input: {
        defaultProjectId: string | null;
        organizationId: string;
        ownerUserId: string;
        profileId: string;
      }): Promise<OpenMeldProfileRecord>;
    };

    for (const profileId of [centerAgent.profileId, human.profileId]) {
      await expect(
        defaultProjectService.updateAgentProfileDefaultProjectForOwner({
          defaultProjectId: "project_alpha",
          organizationId: TEST_ORGANIZATION_ID,
          ownerUserId: "user_1",
          profileId,
        })
      ).rejects.toBeInstanceOf(
        profileId === centerAgent.profileId
          ? ProfileNotFoundError
          : ProfileValidationError
      );
    }
  });

  it("appends numeric suffixes when profile handles conflict for the same owner", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: (() => {
        const ids = [
          "agt_aaaaaaaa-0000-0000-0000-000000000000",
          "agt_bbbbbbbb-0000-0000-0000-000000000000",
        ];
        let index = 0;
        return () => ids[index++] ?? "agt_cccccccc-0000-0000-0000-000000000000";
      })(),
    });

    const first = await service.createAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Claude Code",
    });
    const second = await service.createAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Claude Code",
    });

    expect(first.profileHandle).toBe("claude-code");
    expect(second.profileHandle).toBe("claude-code-2");
  });

  it("recomputes profileHandle on rename with owner-scoped collisions", async () => {
    const repository = createInMemoryRepository([
      {
        profileId: "agt_11111111-0000-0000-0000-000000000000",
        profileName: "Claude Code",
        profileHandle: "claude-code",
        profileKind: "agent",
        isDefault: false,
        status: "active",
        ownerUserId: "user_1",
        createdByUserId: "user_1",
        source: "cli_create",
        lastUsedAt: null,
        createdAt: new Date("2026-02-19T00:00:00.000Z"),
        updatedAt: new Date("2026-02-19T00:00:00.000Z"),
      },
    ]);
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
    });

    await service.createAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Helper",
    });

    const updated = await service.updateProfileNameForOwner({
      ownerUserId: "user_1",
      profileId: TEST_AGENT_PROFILE_ID,
      profileName: "Claude Code",
    });

    expect(updated.profileName).toBe("Claude Code");
    expect(updated.profileHandle).toBe("claude-code-2");
  });

  it("retries profileHandle resolution when rename hits owner handle conflict", async () => {
    const repository = createInMemoryRepository([
      {
        profileId: TEST_AGENT_PROFILE_ID,
        profileName: "Helper",
        profileHandle: "helper",
        profileKind: "agent",
        isDefault: false,
        status: "active",
        ownerUserId: "user_1",
        createdByUserId: "user_1",
        source: "cli_create",
        lastUsedAt: null,
        createdAt: new Date("2026-02-19T00:00:00.000Z"),
        updatedAt: new Date("2026-02-19T00:00:00.000Z"),
      },
    ]);
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
    });
    const updateProfileIdentityForOwner =
      repository.updateProfileIdentityForOwner.bind(repository);
    let conflictInjected = false;

    repository.updateProfileIdentityForOwner = (
      ownerUserId,
      profileId,
      input
    ) => {
      if (!conflictInjected) {
        conflictInjected = true;
        repository.profiles.push(
          withProfileDefaults({
            profileId: "agt_conflict-0000-0000-0000-000000000000",
            profileName: "Claude Code",
            profileHandle: input.profileHandle,
            profileKind: "agent",
            isDefault: false,
            status: "active",
            ownerUserId,
            createdByUserId: ownerUserId,
            source: "cli_create",
            lastUsedAt: null,
            createdAt: new Date("2026-02-19T00:00:00.000Z"),
            updatedAt: new Date("2026-02-19T00:00:00.000Z"),
          })
        );
        throw createCapturedPostgresUniqueError("profileOwnerHandle");
      }

      return updateProfileIdentityForOwner(ownerUserId, profileId, input);
    };

    const updated = await service.updateProfileNameForOwner({
      ownerUserId: "user_1",
      profileId: TEST_AGENT_PROFILE_ID,
      profileName: "Claude Code",
    });

    expect(conflictInjected).toBe(true);
    expect(updated.profileName).toBe("Claude Code");
    expect(updated.profileHandle).toBe("claude-code-2");
  });

  it("rejects profile update for non-owner", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
    });

    await service.createAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Agent",
    });

    await expect(
      service.updateProfileNameForOwner({
        ownerUserId: "user_2",
        profileId: TEST_AGENT_PROFILE_ID,
        profileName: "Changed",
      })
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it("deletes owned non-primary profile", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
    });

    await service.createAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Agent",
    });

    await service.deleteProfileForOwner({
      ownerUserId: "user_1",
      profileId: TEST_AGENT_PROFILE_ID,
    });

    await expect(
      service.resolveProfileForOwner({
        ownerUserId: "user_1",
        profileId: TEST_AGENT_PROFILE_ID,
      })
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it.each([
    "human",
    "primary",
    "other-account",
  ] as const)("Agent-only deletion preserves %s before mutation", async (kind) => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      additionalHumanProfileCreationEnabled: true,
      generateHumanProfileId: () => TEST_HUMAN_PROFILE_ID,
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
    });
    const primary = await service.ensurePrimaryHumanProfile({
      userId: "user_1",
      userName: "Owner",
      userEmail: "owner@example.com",
    });
    let profile = primary;
    if (kind === "human") {
      profile = await service.createHumanProfile({
        ownerUserId: "user_1",
        createdByUserId: "user_1",
        creatorProfileId: primary.profileId,
        profileName: "Human",
      });
    } else if (kind === "other-account") {
      profile = await service.createAgentProfile({
        ownerUserId: "user_1",
        createdByUserId: "user_1",
        organizationId: TEST_ORGANIZATION_ID,
        profileName: "Agent",
      });
    }
    await expect(
      service.deleteProfileForOwner({
        ownerUserId: kind === "other-account" ? "user_2" : "user_1",
        profileId: profile.profileId,
        expectedProfileKind: "agent",
      })
    ).rejects.toThrow();
    await expect(
      repository.findByOwnerAndProfileId("user_1", profile.profileId)
    ).resolves.toMatchObject({ status: "active" });
    if (kind === "human") {
      await service.deleteProfileForOwner({
        ownerUserId: "user_1",
        profileId: profile.profileId,
      });
      await expect(
        repository.findByOwnerAndProfileId("user_1", profile.profileId)
      ).resolves.toBeNull();
    }
  });

  it("rejects plain text profileId in resolve/update/delete paths", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
    });

    await expect(
      service.resolveProfileForOwner({
        ownerUserId: "user_1",
        profileId: "default",
      })
    ).rejects.toBeInstanceOf(ProfileValidationError);

    await expect(
      service.updateProfileNameForOwner({
        ownerUserId: "user_1",
        profileId: "default",
        profileName: "New Name",
      })
    ).rejects.toBeInstanceOf(ProfileValidationError);

    await expect(
      service.deleteProfileForOwner({
        ownerUserId: "user_1",
        profileId: "default",
      })
    ).rejects.toBeInstanceOf(ProfileValidationError);
  });

  it("rejects invalid generated profile IDs", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      additionalHumanProfileCreationEnabled: true,
      generateAgentProfileId: () => "agt_invalid",
      generateHumanProfileId: () => "default",
      generatePrimaryHumanProfileId: () => "owner_user_1",
    });

    await expect(
      service.createAgentProfile({
        ownerUserId: "user_1",
        createdByUserId: "user_1",
        organizationId: TEST_ORGANIZATION_ID,
        profileName: "Agent",
      })
    ).rejects.toBeInstanceOf(ProfileValidationError);

    await expect(
      service.createHumanProfile({
        ownerUserId: "user_1",
        createdByUserId: "user_1",
        profileName: "Human",
      })
    ).rejects.toBeInstanceOf(ProfileValidationError);

    await expect(
      service.ensurePrimaryHumanProfile({
        userId: "user_1",
        userName: "Felix",
        userEmail: "felix@openmeld.invalid",
      })
    ).rejects.toBeInstanceOf(ProfileValidationError);
  });

  it("forbids deleting primary human profile", async () => {
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
    });

    const primary = await service.ensurePrimaryHumanProfile({
      userId: "user_1",
      userName: "Felix",
      userEmail: "felix@openmeld.invalid",
    });

    await expect(
      service.deleteProfileForOwner({
        ownerUserId: "user_1",
        profileId: primary.profileId,
      })
    ).rejects.toBeInstanceOf(PrimaryHumanProfileDeleteForbiddenError);
  });
});

describe("OpenMeld request-auth primary and requested Profile resolution", () => {
  const OTHER_OWNER_AGENT_PROFILE_ID =
    "agt_bbbbbbbb-0000-0000-0000-000000000000";
  const primaryInput = {
    userId: "user_1",
    userName: "Felix",
    userEmail: "felix@openmeld.invalid",
  };

  async function seededService() {
    const repository = createInMemoryRepository();
    let nextAgentProfileId = TEST_AGENT_PROFILE_ID;
    const service = createOpenMeldProfileService(repository, {
      generateAgentProfileId: () => nextAgentProfileId,
    });
    const primary = await service.ensurePrimaryHumanProfile(primaryInput);
    await service.createAgentProfile({
      ownerUserId: "user_1",
      createdByUserId: "user_1",
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Agent",
    });
    nextAgentProfileId = OTHER_OWNER_AGENT_PROFILE_ID;
    await service.ensurePrimaryHumanProfile({
      userId: "user_2",
      userName: "Other",
      userEmail: "other@openmeld.invalid",
    });
    await service.createAgentProfile({
      ownerUserId: "user_2",
      createdByUserId: "user_2",
      organizationId: TEST_ORGANIZATION_ID,
      profileName: "Other Agent",
    });
    const calls = {
      findDefaultHumanAndOwnedProfile: 0,
      findDefaultHumanByOwner: 0,
      findByOwnerAndProfileId: 0,
    };
    for (const method of Object.keys(calls) as (keyof typeof calls)[]) {
      const original = repository[method].bind(repository) as (
        ...args: unknown[]
      ) => Promise<unknown>;
      (repository as Record<string, unknown>)[method] = (
        ...args: unknown[]
      ) => {
        calls[method] += 1;
        return original(...args);
      };
    }
    return { calls, primary, repository, service };
  }

  function summarizeOutcome(outcome: {
    primaryHumanProfile: OpenMeldProfileRecord;
    requestedProfile:
      | { ok: true; profile: OpenMeldProfileRecord }
      | { ok: false; error: unknown };
  }) {
    return {
      primaryHumanProfile: outcome.primaryHumanProfile,
      requestedProfile: outcome.requestedProfile.ok
        ? outcome.requestedProfile
        : {
            ok: false,
            errorType: (outcome.requestedProfile.error as Error).constructor,
          },
    };
  }

  // Resolves the selector through the combined read and through the
  // separate ensure + resolve calls it replaces.
  async function resolveBothWays(
    service: ReturnType<typeof createOpenMeldProfileService>,
    selector: {
      profileId?: string | null;
      profileKind?: "human" | "agent" | "system" | null;
    }
  ) {
    const combined =
      await service.resolvePrimaryHumanAndRequestedProfileForOwner({
        ...primaryInput,
        ...selector,
      });
    const primaryHumanProfile =
      await service.ensurePrimaryHumanProfile(primaryInput);
    const requestedProfile = await service
      .resolveProfileForOwner({
        ownerUserId: primaryInput.userId,
        ...selector,
      })
      .then(
        (profile) => ({ ok: true as const, profile }),
        (error: unknown) => ({ ok: false as const, error })
      );
    return {
      combined,
      combinedSummary: summarizeOutcome(combined),
      sequentialSummary: summarizeOutcome({
        primaryHumanProfile,
        requestedProfile,
      }),
    };
  }

  it("returns the primary Human Profile as the requested Profile without a profile id", async () => {
    const { calls, primary, service } = await seededService();

    const {
      combined: result,
      combinedSummary,
      sequentialSummary,
    } = await resolveBothWays(service, {});

    expect(combinedSummary).toEqual(sequentialSummary);
    expect(result.requestedProfile).toEqual({ ok: true, profile: primary });
    expect(calls.findDefaultHumanAndOwnedProfile).toBe(0);
  });

  it("reads the primary and an owned active Profile in one repository read", async () => {
    const { calls, primary, service } = await seededService();

    const result = await service.resolvePrimaryHumanAndRequestedProfileForOwner(
      {
        ...primaryInput,
        profileId: TEST_AGENT_PROFILE_ID,
        profileKind: "agent",
      }
    );

    expect(result.primaryHumanProfile).toEqual(primary);
    expect(result.requestedProfile).toMatchObject({
      ok: true,
      profile: { profileId: TEST_AGENT_PROFILE_ID, ownerUserId: "user_1" },
    });
    expect(calls).toEqual({
      findDefaultHumanAndOwnedProfile: 1,
      findDefaultHumanByOwner: 0,
      findByOwnerAndProfileId: 0,
    });
    const { combinedSummary, sequentialSummary } = await resolveBothWays(
      service,
      {
        profileId: TEST_AGENT_PROFILE_ID,
        profileKind: "agent",
      }
    );
    expect(combinedSummary).toEqual(sequentialSummary);
  });

  it("resolves the primary Human Profile when it is the requested Profile", async () => {
    const { primary, service } = await seededService();

    const {
      combined: result,
      combinedSummary,
      sequentialSummary,
    } = await resolveBothWays(service, {
      profileId: primary.profileId,
    });

    expect(combinedSummary).toEqual(sequentialSummary);

    expect(result.requestedProfile).toEqual({ ok: true, profile: primary });
  });

  it("rejects another owner's Profile without failing the primary Profile", async () => {
    const { primary, service } = await seededService();

    const {
      combined: result,
      combinedSummary,
      sequentialSummary,
    } = await resolveBothWays(service, {
      profileId: OTHER_OWNER_AGENT_PROFILE_ID,
    });

    expect(combinedSummary).toEqual(sequentialSummary);

    expect(result.primaryHumanProfile).toEqual(primary);
    expect(result.requestedProfile.ok).toBe(false);
    expect(
      result.requestedProfile.ok ? null : result.requestedProfile.error
    ).toBeInstanceOf(ProfileNotFoundError);
  });

  it("rejects a disabled owned Profile", async () => {
    const { repository, service } = await seededService();
    const agent = repository.profiles.find(
      (profile) => profile.profileId === TEST_AGENT_PROFILE_ID
    );
    if (!agent) {
      throw new Error("seeded Agent Profile is missing");
    }
    agent.status = "disabled";

    const {
      combined: result,
      combinedSummary,
      sequentialSummary,
    } = await resolveBothWays(service, {
      profileId: TEST_AGENT_PROFILE_ID,
    });

    expect(combinedSummary).toEqual(sequentialSummary);

    expect(
      result.requestedProfile.ok ? null : result.requestedProfile.error
    ).toBeInstanceOf(ProfileNotFoundError);
  });

  it("rejects an owned Profile of another kind", async () => {
    const { service } = await seededService();

    const {
      combined: result,
      combinedSummary,
      sequentialSummary,
    } = await resolveBothWays(service, {
      profileId: TEST_AGENT_PROFILE_ID,
      profileKind: "human",
    });

    expect(combinedSummary).toEqual(sequentialSummary);

    expect(
      result.requestedProfile.ok ? null : result.requestedProfile.error
    ).toBeInstanceOf(ProfileNotFoundError);
  });

  it("rejects a missing Profile id", async () => {
    const { service } = await seededService();

    const {
      combined: result,
      combinedSummary,
      sequentialSummary,
    } = await resolveBothWays(service, {
      profileId: "agt_cccccccc-0000-0000-0000-000000000000",
    });

    expect(combinedSummary).toEqual(sequentialSummary);

    expect(
      result.requestedProfile.ok ? null : result.requestedProfile.error
    ).toBeInstanceOf(ProfileNotFoundError);
  });

  it("reports an invalid Profile id as a requested Profile failure", async () => {
    const { calls, primary, service } = await seededService();

    const {
      combined: result,
      combinedSummary,
      sequentialSummary,
    } = await resolveBothWays(service, {
      profileId: "not-a-profile-id",
    });

    expect(combinedSummary).toEqual(sequentialSummary);

    expect(result.primaryHumanProfile).toEqual(primary);
    expect(
      result.requestedProfile.ok ? null : result.requestedProfile.error
    ).toBeInstanceOf(ProfileValidationError);
    expect(calls.findDefaultHumanAndOwnedProfile).toBe(0);
  });

  it("reads the requested Profile after first-login primary bootstrap", async () => {
    const primaryProfileId = "99999999-1111-2222-3333-444444444444";
    const repository = createInMemoryRepository();
    const service = createOpenMeldProfileService(repository, {
      generatePrimaryHumanProfileId: () => primaryProfileId,
    });

    const result = await service.resolvePrimaryHumanAndRequestedProfileForOwner(
      {
        ...primaryInput,
        profileId: primaryProfileId,
      }
    );

    expect(result.primaryHumanProfile.profileId).toBe(primaryProfileId);
    expect(result.requestedProfile).toMatchObject({
      ok: true,
      profile: { profileId: primaryProfileId, isDefault: true },
    });
  });

  it("fails the whole resolution when the primary Human Profile fails", async () => {
    const { repository, service } = await seededService();
    repository.findDefaultHumanAndOwnedProfile = () =>
      Promise.reject(new Error("database unavailable"));

    await expect(
      service.resolvePrimaryHumanAndRequestedProfileForOwner({
        ...primaryInput,
        profileId: TEST_AGENT_PROFILE_ID,
      })
    ).rejects.toThrow("database unavailable");
  });
});

describe("OpenMeld profile space history service integration", () => {
  it("lists active history by default", async () => {
    const profileRepository = createInMemoryRepository();
    const historyRepository = createInMemoryProfileSpaceHistoryRepository([
      {
        profileId: TEST_AGENT_PROFILE_ID,
        gatewayHost: "localhost:8080",
        spaceId: "space-active",
        spaceName: "active-space",
        creatorProfileId: TEST_AGENT_PROFILE_ID,
        creatorKind: "agent",
        spaceCreatedAt: new Date("2026-02-24T00:00:00.000Z"),
        spaceUpdatedAt: new Date("2026-02-24T00:00:01.000Z"),
        lastJoinedAt: new Date("2026-02-24T00:00:02.000Z"),
        lastSeenTs: 10,
        pinnedAt: null,
        status: "active",
        createdAt: new Date("2026-02-24T00:00:00.000Z"),
        updatedAt: new Date("2026-02-24T00:00:03.000Z"),
      },
      {
        profileId: TEST_AGENT_PROFILE_ID,
        gatewayHost: "localhost:8080",
        spaceId: "space-removed",
        spaceName: "removed-space",
        creatorProfileId: TEST_AGENT_PROFILE_ID,
        creatorKind: "agent",
        spaceCreatedAt: new Date("2026-02-24T00:00:00.000Z"),
        spaceUpdatedAt: new Date("2026-02-24T00:00:01.000Z"),
        lastJoinedAt: new Date("2026-02-24T00:00:02.000Z"),
        lastSeenTs: 10,
        pinnedAt: null,
        status: "removed",
        createdAt: new Date("2026-02-24T00:00:00.000Z"),
        updatedAt: new Date("2026-02-24T00:00:03.000Z"),
      },
    ]);
    const service = createOpenMeldProfileService(profileRepository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
      profileSpaceHistoryRepository: historyRepository,
    });

    const items = await service.listProfileSpaceHistory({
      profileId: TEST_AGENT_PROFILE_ID,
      gatewayHost: "localhost:8080",
    });
    expect(items.map((item) => item.spaceId)).toEqual(["space-active"]);
  });

  it("normalizes gatewayHost for list lookup", async () => {
    const profileRepository = createInMemoryRepository();
    const historyRepository = createInMemoryProfileSpaceHistoryRepository([
      {
        profileId: TEST_AGENT_PROFILE_ID,
        gatewayHost: "localhost:8080",
        spaceId: "space-active",
        spaceName: "active-space",
        creatorProfileId: TEST_AGENT_PROFILE_ID,
        creatorKind: "agent",
        spaceCreatedAt: new Date("2026-02-24T00:00:00.000Z"),
        spaceUpdatedAt: new Date("2026-02-24T00:00:01.000Z"),
        lastJoinedAt: new Date("2026-02-24T00:00:02.000Z"),
        lastSeenTs: 10,
        pinnedAt: null,
        status: "active",
        createdAt: new Date("2026-02-24T00:00:00.000Z"),
        updatedAt: new Date("2026-02-24T00:00:03.000Z"),
      },
    ]);
    const service = createOpenMeldProfileService(profileRepository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
      profileSpaceHistoryRepository: historyRepository,
    });

    const items = await service.listProfileSpaceHistory({
      profileId: TEST_AGENT_PROFILE_ID,
      gatewayHost: "HTTP://LOCALHOST:8080",
    });
    expect(items.map((item) => item.spaceId)).toEqual(["space-active"]);
  });

  it("upserts profile space history and keeps normalized values", async () => {
    const profileRepository = createInMemoryRepository();
    const historyRepository = createInMemoryProfileSpaceHistoryRepository();
    const service = createOpenMeldProfileService(profileRepository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
      profileSpaceHistoryRepository: historyRepository,
    });

    const item = await service.upsertProfileSpaceHistory({
      profileId: TEST_AGENT_PROFILE_ID,
      gatewayHost: "localhost:8080",
      spaceId: "space-a",
      spaceName: "  ops-room  ",
      creatorProfileId: "  agt_owner  ",
      creatorKind: "agent",
      lastSeenTs: 12,
      pinnedAt: new Date("2026-02-24T00:00:04.000Z"),
      status: "active",
    });

    expect(item.spaceName).toBe("ops-room");
    expect(item.creatorProfileId).toBe("agt_owner");
    expect(item.pinnedAt?.toISOString()).toBe("2026-02-24T00:00:04.000Z");
    expect(item.status).toBe("active");
  });

  it("filters pinned history and clears pinnedAt", async () => {
    const profileRepository = createInMemoryRepository();
    const historyRepository = createInMemoryProfileSpaceHistoryRepository([
      {
        profileId: TEST_AGENT_PROFILE_ID,
        gatewayHost: "localhost:8080",
        spaceId: "space-pinned",
        spaceName: "pinned-space",
        creatorProfileId: TEST_AGENT_PROFILE_ID,
        creatorKind: "agent",
        spaceCreatedAt: new Date("2026-02-24T00:00:00.000Z"),
        spaceUpdatedAt: new Date("2026-02-24T00:00:01.000Z"),
        lastJoinedAt: new Date("2026-02-24T00:00:02.000Z"),
        lastSeenTs: 10,
        pinnedAt: new Date("2026-02-24T00:00:04.000Z"),
        status: "active",
        createdAt: new Date("2026-02-24T00:00:00.000Z"),
        updatedAt: new Date("2026-02-24T00:00:03.000Z"),
      },
      {
        profileId: TEST_AGENT_PROFILE_ID,
        gatewayHost: "localhost:8080",
        spaceId: "space-unpinned",
        spaceName: "unpinned-space",
        creatorProfileId: TEST_AGENT_PROFILE_ID,
        creatorKind: "agent",
        spaceCreatedAt: new Date("2026-02-24T00:00:00.000Z"),
        spaceUpdatedAt: new Date("2026-02-24T00:00:01.000Z"),
        lastJoinedAt: new Date("2026-02-24T00:00:05.000Z"),
        lastSeenTs: 10,
        pinnedAt: null,
        status: "active",
        createdAt: new Date("2026-02-24T00:00:00.000Z"),
        updatedAt: new Date("2026-02-24T00:00:03.000Z"),
      },
    ]);
    const service = createOpenMeldProfileService(profileRepository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
      profileSpaceHistoryRepository: historyRepository,
    });

    const pinnedItems = await service.listProfileSpaceHistory({
      profileId: TEST_AGENT_PROFILE_ID,
      gatewayHost: "localhost:8080",
      pinned: true,
    });
    expect(pinnedItems.map((item) => item.spaceId)).toEqual(["space-pinned"]);

    const cleared = await service.upsertProfileSpaceHistory({
      profileId: TEST_AGENT_PROFILE_ID,
      gatewayHost: "localhost:8080",
      spaceId: "space-pinned",
      pinnedAt: null,
    });
    expect(cleared.pinnedAt).toBeNull();

    const unpinnedItems = await service.listProfileSpaceHistory({
      profileId: TEST_AGENT_PROFILE_ID,
      gatewayHost: "localhost:8080",
      pinned: false,
    });
    expect(unpinnedItems.map((item) => item.spaceId)).toEqual([
      "space-unpinned",
      "space-pinned",
    ]);
  });

  it("normalizes gatewayHost on upsert", async () => {
    const profileRepository = createInMemoryRepository();
    const historyRepository = createInMemoryProfileSpaceHistoryRepository();
    const service = createOpenMeldProfileService(profileRepository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
      profileSpaceHistoryRepository: historyRepository,
    });

    const item = await service.upsertProfileSpaceHistory({
      profileId: TEST_AGENT_PROFILE_ID,
      gatewayHost: "HTTP://LOCALHOST:8080",
      spaceId: "space-normalized",
      status: "active",
    });

    expect(item.gatewayHost).toBe("localhost:8080");
  });

  it("updates status and creates fallback record when missing", async () => {
    const profileRepository = createInMemoryRepository();
    const historyRepository = createInMemoryProfileSpaceHistoryRepository();
    const service = createOpenMeldProfileService(profileRepository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
      profileSpaceHistoryRepository: historyRepository,
    });

    const item = await service.updateProfileSpaceHistoryStatus({
      profileId: TEST_AGENT_PROFILE_ID,
      gatewayHost: "localhost:8080",
      spaceId: "space-new",
      status: "inaccessible",
      reason: "forbidden",
    });

    expect(item.profileId).toBe(TEST_AGENT_PROFILE_ID);
    expect(item.spaceId).toBe("space-new");
    expect(item.status).toBe("inaccessible");
  });

  it("lists only owner-accessible space ids across active profiles", async () => {
    const profileRepository = createInMemoryRepository([
      {
        profileId: TEST_HUMAN_PROFILE_ID,
        profileName: "Felix",
        profileKind: "human",
        isDefault: true,
        status: "active",
        ownerUserId: "owner-1",
        createdByUserId: "owner-1",
        source: "auth_bootstrap",
        lastUsedAt: null,
        createdAt: new Date("2026-02-24T00:00:00.000Z"),
        updatedAt: new Date("2026-02-24T00:00:00.000Z"),
      },
      {
        profileId: TEST_AGENT_PROFILE_ID,
        profileName: "Ops Bot",
        profileKind: "agent",
        isDefault: false,
        status: "active",
        ownerUserId: "owner-1",
        createdByUserId: "owner-1",
        source: "cli_create",
        lastUsedAt: null,
        createdAt: new Date("2026-02-24T00:00:00.000Z"),
        updatedAt: new Date("2026-02-24T00:00:00.000Z"),
      },
      {
        profileId: "agt_bbbbbbbb-0000-0000-0000-000000000000",
        profileName: "Inactive Bot",
        profileKind: "agent",
        isDefault: false,
        status: "disabled",
        ownerUserId: "owner-1",
        createdByUserId: "owner-1",
        source: "cli_create",
        lastUsedAt: null,
        createdAt: new Date("2026-02-24T00:00:00.000Z"),
        updatedAt: new Date("2026-02-24T00:00:00.000Z"),
      },
    ]);
    const historyRepository = createInMemoryProfileSpaceHistoryRepository([
      {
        profileId: TEST_HUMAN_PROFILE_ID,
        gatewayHost: "localhost:8080",
        spaceId: "space-human",
        spaceName: "human-space",
        creatorProfileId: TEST_HUMAN_PROFILE_ID,
        creatorKind: "human",
        spaceCreatedAt: new Date("2026-02-24T00:00:00.000Z"),
        spaceUpdatedAt: new Date("2026-02-24T00:00:01.000Z"),
        lastJoinedAt: new Date("2026-02-24T00:00:02.000Z"),
        lastSeenTs: 10,
        pinnedAt: null,
        status: "removed",
        createdAt: new Date("2026-02-24T00:00:00.000Z"),
        updatedAt: new Date("2026-02-24T00:00:03.000Z"),
      },
      {
        profileId: TEST_AGENT_PROFILE_ID,
        gatewayHost: "localhost:8080",
        spaceId: "space-agent",
        spaceName: "agent-space",
        creatorProfileId: TEST_AGENT_PROFILE_ID,
        creatorKind: "agent",
        spaceCreatedAt: new Date("2026-02-24T00:00:00.000Z"),
        spaceUpdatedAt: new Date("2026-02-24T00:00:01.000Z"),
        lastJoinedAt: new Date("2026-02-24T00:00:02.000Z"),
        lastSeenTs: 10,
        pinnedAt: null,
        status: "active",
        createdAt: new Date("2026-02-24T00:00:00.000Z"),
        updatedAt: new Date("2026-02-24T00:00:03.000Z"),
      },
      {
        profileId: "agt_bbbbbbbb-0000-0000-0000-000000000000",
        gatewayHost: "localhost:8080",
        spaceId: "space-inactive",
        spaceName: "inactive-space",
        creatorProfileId: "agt_bbbbbbbb-0000-0000-0000-000000000000",
        creatorKind: "agent",
        spaceCreatedAt: new Date("2026-02-24T00:00:00.000Z"),
        spaceUpdatedAt: new Date("2026-02-24T00:00:01.000Z"),
        lastJoinedAt: new Date("2026-02-24T00:00:02.000Z"),
        lastSeenTs: 10,
        pinnedAt: null,
        status: "active",
        createdAt: new Date("2026-02-24T00:00:00.000Z"),
        updatedAt: new Date("2026-02-24T00:00:03.000Z"),
      },
    ]);
    const service = createOpenMeldProfileService(profileRepository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
      profileSpaceHistoryRepository: historyRepository,
    });

    const spaceIds = await service.listOwnerAccessibleSpaceIds({
      ownerUserId: "owner-1",
      gatewayHost: "HTTP://LOCALHOST:8080",
      spaceIds: [
        "space-agent",
        "space-human",
        "space-foreign",
        "space-inactive",
      ],
    });

    expect(spaceIds).toEqual(["space-agent", "space-human"]);
  });

  it("normalizes gatewayHost on updateStatus", async () => {
    const profileRepository = createInMemoryRepository();
    const historyRepository = createInMemoryProfileSpaceHistoryRepository([
      {
        profileId: TEST_AGENT_PROFILE_ID,
        gatewayHost: "localhost:8080",
        spaceId: "space-status",
        spaceName: "status-space",
        creatorProfileId: TEST_AGENT_PROFILE_ID,
        creatorKind: "agent",
        spaceCreatedAt: new Date("2026-02-24T00:00:00.000Z"),
        spaceUpdatedAt: new Date("2026-02-24T00:00:01.000Z"),
        lastJoinedAt: new Date("2026-02-24T00:00:02.000Z"),
        lastSeenTs: 10,
        pinnedAt: null,
        status: "active",
        createdAt: new Date("2026-02-24T00:00:00.000Z"),
        updatedAt: new Date("2026-02-24T00:00:03.000Z"),
      },
    ]);
    const service = createOpenMeldProfileService(profileRepository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
      profileSpaceHistoryRepository: historyRepository,
    });

    const item = await service.updateProfileSpaceHistoryStatus({
      profileId: TEST_AGENT_PROFILE_ID,
      gatewayHost: "HTTP://LOCALHOST:8080",
      spaceId: "space-status",
      status: "removed",
      reason: "space not found",
    });

    expect(item.gatewayHost).toBe("localhost:8080");
    expect(item.status).toBe("removed");
  });

  it("rejects invalid list limit", async () => {
    const profileRepository = createInMemoryRepository();
    const historyRepository = createInMemoryProfileSpaceHistoryRepository();
    const service = createOpenMeldProfileService(profileRepository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
      profileSpaceHistoryRepository: historyRepository,
    });

    await expect(
      Promise.resolve().then(() =>
        service.listProfileSpaceHistory({
          profileId: TEST_AGENT_PROFILE_ID,
          gatewayHost: "localhost:8080",
          limit: 0,
        })
      )
    ).rejects.toBeInstanceOf(ProfileValidationError);
  });
});

describe("OpenMeld profile lineage fallback", () => {
  it("treats legacy agents without creatorProfileId as descendants of the default human", async () => {
    const defaultHumanProfileId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
    const siblingHumanProfileId = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
    const legacyAgentProfileId = "agt_cccccccc-3333-4333-8333-cccccccccccc";
    const repository = createInMemoryRepository([
      {
        profileId: defaultHumanProfileId,
        profileName: "Main Human",
        profileKind: "human",
        isDefault: true,
        status: "active",
        ownerUserId: "owner-1",
        createdByUserId: "owner-1",
        source: "auth_bootstrap",
        lastUsedAt: null,
        createdAt: new Date("2026-03-20T00:00:00.000Z"),
        updatedAt: new Date("2026-03-20T00:00:00.000Z"),
      },
      {
        profileId: siblingHumanProfileId,
        profileName: "Sibling Human",
        profileKind: "human",
        isDefault: false,
        status: "active",
        ownerUserId: "owner-1",
        createdByUserId: "owner-1",
        source: "cli_create",
        lastUsedAt: null,
        createdAt: new Date("2026-03-20T00:00:00.000Z"),
        updatedAt: new Date("2026-03-20T00:00:00.000Z"),
      },
      {
        profileId: legacyAgentProfileId,
        profileName: "Legacy Agent",
        profileKind: "agent",
        isDefault: false,
        status: "active",
        ownerUserId: "owner-1",
        createdByUserId: "owner-1",
        source: "cli_create",
        lastUsedAt: null,
        createdAt: new Date("2026-03-20T00:00:00.000Z"),
        updatedAt: new Date("2026-03-20T00:00:00.000Z"),
      },
    ]);
    const service = createOpenMeldProfileService(repository);

    const lineage = await service.listResolvedProfileLineageForOwner("owner-1");
    expect(lineage).toContainEqual({
      profileId: legacyAgentProfileId,
      creatorProfileId: defaultHumanProfileId,
    });

    await expect(
      service.canViewerAccessProfileOrigin({
        viewerProfileId: defaultHumanProfileId,
        targetProfileId: legacyAgentProfileId,
      })
    ).resolves.toBe(true);
    await expect(
      service.canViewerAccessProfileOrigin({
        viewerProfileId: siblingHumanProfileId,
        targetProfileId: legacyAgentProfileId,
      })
    ).resolves.toBe(false);
  });
});

describe("OpenMeld space deletion tombstone service integration", () => {
  it("queries tombstones in request order with normalized gatewayHost", async () => {
    const profileRepository = createInMemoryRepository();
    const tombstoneRepository = createInMemorySpaceDeletionTombstoneRepository([
      {
        gatewayHost: "localhost:8080",
        spaceId: "space-b",
        spaceName: "beta",
        creatorProfileId: TEST_AGENT_PROFILE_ID,
        creatorKind: "agent",
        deletedByProfileId: TEST_HUMAN_PROFILE_ID,
        deletedByProfileName: "Felix",
        deletedByOwnerUserId: "owner-1",
        deletedAt: new Date("2026-03-12T00:00:00.000Z"),
        createdAt: new Date("2026-03-12T00:00:00.000Z"),
        updatedAt: new Date("2026-03-12T00:00:00.000Z"),
      },
      {
        gatewayHost: "localhost:8080",
        spaceId: "space-a",
        spaceName: "alpha",
        creatorProfileId: TEST_AGENT_PROFILE_ID,
        creatorKind: "agent",
        deletedByProfileId: null,
        deletedByProfileName: null,
        deletedByOwnerUserId: null,
        deletedAt: new Date("2026-03-11T00:00:00.000Z"),
        createdAt: new Date("2026-03-11T00:00:00.000Z"),
        updatedAt: new Date("2026-03-11T00:00:00.000Z"),
      },
    ]);
    const service = createOpenMeldProfileService(profileRepository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
      spaceDeletionTombstoneRepository: tombstoneRepository,
    });

    const items = await service.querySpaceDeletionTombstones({
      gatewayHost: "HTTP://LOCALHOST:8080",
      spaceIds: ["space-a", "space-b"],
    });

    expect(items.map((item) => item.spaceId)).toEqual(["space-a", "space-b"]);
  });

  it("upserts tombstones and preserves existing delete actor on passive updates", async () => {
    const profileRepository = createInMemoryRepository();
    const tombstoneRepository =
      createInMemorySpaceDeletionTombstoneRepository();
    const service = createOpenMeldProfileService(profileRepository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
      spaceDeletionTombstoneRepository: tombstoneRepository,
    });

    const first = await service.upsertSpaceDeletionTombstone({
      gatewayHost: "localhost:8080",
      spaceId: "space-a",
      spaceName: "ops-room",
      creatorProfileId: TEST_AGENT_PROFILE_ID,
      creatorKind: "agent",
      deletedByProfileId: TEST_HUMAN_PROFILE_ID,
      deletedByProfileName: "  Felix  ",
      deletedByOwnerUserId: "owner-1",
    });

    const second = await service.upsertSpaceDeletionTombstone({
      gatewayHost: "localhost:8080",
      spaceId: "space-a",
      deletedAt: "2026-03-12T01:00:00.000Z",
    });

    expect(first.deletedByProfileName).toBe("Felix");
    expect(second.deletedByProfileId).toBe(TEST_HUMAN_PROFILE_ID);
    expect(second.deletedByProfileName).toBe("Felix");
    expect(second.deletedByOwnerUserId).toBe("owner-1");
  });

  it("rejects empty tombstone spaceIds query input", async () => {
    const profileRepository = createInMemoryRepository();
    const tombstoneRepository =
      createInMemorySpaceDeletionTombstoneRepository();
    const service = createOpenMeldProfileService(profileRepository, {
      generateAgentProfileId: () => TEST_AGENT_PROFILE_ID,
      spaceDeletionTombstoneRepository: tombstoneRepository,
    });

    await expect(
      Promise.resolve().then(() =>
        service.querySpaceDeletionTombstones({
          gatewayHost: "localhost:8080",
          spaceIds: [],
        })
      )
    ).rejects.toBeInstanceOf(ProfileValidationError);
  });
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
