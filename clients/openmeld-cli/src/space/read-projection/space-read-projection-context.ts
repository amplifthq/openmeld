import type {
  OpenMeldRequestContext,
  SpaceIdentityDirectory,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { buildSignalIndex, type SpaceSignalIndex } from "@openmeld/space";
import type { SpaceApi } from "../cli-space-api";

export function withResolvedSpacePassword(spacePassword: string | undefined) {
  return spacePassword === undefined ? {} : { spacePassword };
}

export function buildIdentityOnlyMembersSnapshotForReadProjection(
  identityDirectory: SpaceIdentityDirectory | null
): SpaceMembersSnapshot | null {
  if (!identityDirectory) {
    return null;
  }

  const humans = identityDirectory.entries
    .filter((entry) => entry.profileKind === "human")
    .map((entry) => ({
      profileId: entry.profileId,
      profileName: entry.profileName,
      profileKind: "human" as const,
      status: "active" as const,
      memberSource: "backfilled" as const,
      memberSourceLabel: "Member",
      addedAt: identityDirectory.generatedAt,
      removedAt: null,
      createdAt: identityDirectory.generatedAt,
      updatedAt: identityDirectory.generatedAt,
      addedByProfileId: null,
      addedByOwnerUserId: null,
      addedByDisplayName: null,
      removedByProfileId: null,
      removedByOwnerUserId: null,
      removalReason: null,
      firstEnteredAt: null,
      lastEnteredAt: null,
      lastSeenAt: null,
      lastSeenLabel: null,
      liveNow: false,
      mentionAlias: entry.mentionAlias,
      ownerUserId: entry.ownerUserId,
      ownerName: entry.ownerName,
    }));
  const agents = identityDirectory.entries
    .filter((entry) => entry.profileKind === "agent")
    .map((entry) => ({
      profileId: entry.profileId,
      profileName: entry.profileName,
      profileKind: "agent" as const,
      status: "active" as const,
      memberSource: "backfilled" as const,
      memberSourceLabel: "Member",
      addedAt: identityDirectory.generatedAt,
      removedAt: null,
      createdAt: identityDirectory.generatedAt,
      updatedAt: identityDirectory.generatedAt,
      addedByProfileId: null,
      addedByOwnerUserId: null,
      addedByDisplayName: null,
      removedByProfileId: null,
      removedByOwnerUserId: null,
      removalReason: null,
      firstEnteredAt: null,
      lastEnteredAt: null,
      lastSeenAt: null,
      lastSeenLabel: null,
      liveNow: false,
      mentionAlias: entry.mentionAlias,
      ownerUserId: entry.ownerUserId,
      ownerName: entry.ownerName,
      agentControllerRef: entry.agentControllerRef,
      agentControllerConversationId: null,
    }));

  return {
    spaceId: identityDirectory.spaceId,
    generatedAt: identityDirectory.generatedAt,
    summary: {
      totalCount: humans.length + agents.length,
      humanCount: humans.length,
      agentCount: agents.length,
      liveNowCount: 0,
    },
    humans,
    agents,
  };
}

export async function loadSpaceMembersSnapshotOrNull(input: {
  spaceApi: SpaceApi;
  spaceId: string;
  requestContext: OpenMeldRequestContext;
  resolvedPassword: string | undefined;
  required?: boolean;
  skip?: boolean;
}): Promise<SpaceMembersSnapshot | null> {
  if (input.skip === true) {
    return null;
  }

  try {
    return await input.spaceApi.getMembersSnapshot({
      spaceId: input.spaceId,
      requestContext: input.requestContext,
      ...withResolvedSpacePassword(input.resolvedPassword),
    });
  } catch (error) {
    if (input.required) {
      throw error;
    }
    return null;
  }
}

export async function loadSpaceIdentityDirectoryOrNull(input: {
  spaceApi: SpaceApi;
  spaceId: string;
  requestContext: OpenMeldRequestContext;
  resolvedPassword: string | undefined;
  required?: boolean;
  skip?: boolean;
}): Promise<SpaceIdentityDirectory | null> {
  if (input.skip === true) {
    return null;
  }

  try {
    return await input.spaceApi.getIdentityDirectory({
      spaceId: input.spaceId,
      requestContext: input.requestContext,
      ...withResolvedSpacePassword(input.resolvedPassword),
    });
  } catch (error) {
    if (input.required) {
      throw error;
    }
    return null;
  }
}

export async function loadSpaceSignalIndexOrNull(input: {
  spaceApi: SpaceApi;
  spaceId: string;
  requestContext: OpenMeldRequestContext;
  resolvedPassword: string | undefined;
  required?: boolean;
  skip?: boolean;
}): Promise<SpaceSignalIndex | null> {
  if (input.skip === true) {
    return null;
  }

  try {
    const signalEnvelopeResponse = await input.spaceApi.listSignalEnvelopes({
      spaceId: input.spaceId,
      requestContext: input.requestContext,
      ...withResolvedSpacePassword(input.resolvedPassword),
    });
    return buildSignalIndex(signalEnvelopeResponse.envelopes);
  } catch (error) {
    if (input.required) {
      throw error;
    }
    return null;
  }
}
