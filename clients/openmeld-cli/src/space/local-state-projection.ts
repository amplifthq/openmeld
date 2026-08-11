import type { SpaceCreator } from "@openmeld/protocol";
import type { SpaceConfig } from "./local-state";

export type SpaceFactsProjection = {
  baseUrl: string;
  spaceId: string;
  name: string | null;
  creator: SpaceCreator | null;
  passwordProtected: boolean | null;
  spaceCreatedAt: string | null;
  spaceUpdatedAt: string | null;
  syncedAt: string;
  staleAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SpaceProfileCacheProjection = {
  openMeldProfileId: string;
  profileHandle: string | null;
  profileName: string;
  role: string | null;
  mentionAlias: string | null;
  lastSeenTs: number | null;
  recentMentionProfileIds: string[];
};

export function projectSpaceFacts(
  spaceConfig: SpaceConfig
): SpaceFactsProjection {
  return {
    baseUrl: spaceConfig.baseUrl,
    spaceId: spaceConfig.space,
    name: spaceConfig.name ?? null,
    creator: spaceConfig.creator ?? null,
    passwordProtected:
      typeof spaceConfig.passwordProtected === "boolean"
        ? spaceConfig.passwordProtected
        : null,
    spaceCreatedAt: spaceConfig.spaceCreatedAt ?? null,
    spaceUpdatedAt: spaceConfig.spaceUpdatedAt ?? null,
    syncedAt: spaceConfig.syncedAt,
    staleAt: spaceConfig.staleAt ?? null,
    createdAt: spaceConfig.createdAt,
    updatedAt: spaceConfig.updatedAt,
  };
}

export function projectSpaceProfileCache(
  spaceConfig: SpaceConfig
): SpaceProfileCacheProjection {
  return {
    openMeldProfileId: spaceConfig.openMeldProfileId,
    profileHandle: spaceConfig.profileHandle ?? null,
    profileName: spaceConfig.profileName,
    role: spaceConfig.role ?? null,
    mentionAlias: spaceConfig.mentionAlias ?? null,
    lastSeenTs:
      typeof spaceConfig.lastSeenTs === "number"
        ? spaceConfig.lastSeenTs
        : null,
    recentMentionProfileIds: [...(spaceConfig.recentMentionProfileIds ?? [])],
  };
}
