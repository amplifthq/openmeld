import type { Profile, SignalEnvelope } from "@openmeld/protocol";
import { normalizeOptionalWorkingDirectory } from "@openmeld/schemas";
import { normalizeOwnerUserId } from "../access/space-creator-identity";

export type AgentOriginLineageScope = {
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  creatorProfileIdByProfileId?:
    | ReadonlyMap<string, string | null>
    | Readonly<Record<string, string | null | undefined>>;
};

export function isViewerSelfOrAncestorOfTargetProfile(input: {
  viewerProfileId?: string;
  targetProfileId?: string;
  creatorProfileIdByProfileId?:
    | ReadonlyMap<string, string | null>
    | Readonly<Record<string, string | null | undefined>>;
}): boolean {
  const viewerProfileId = normalizeOptionalText(input.viewerProfileId);
  const targetProfileId = normalizeOptionalText(input.targetProfileId);
  if (!(viewerProfileId && targetProfileId)) {
    return false;
  }
  if (viewerProfileId === targetProfileId) {
    return true;
  }

  const creatorProfileIdByProfileId = input.creatorProfileIdByProfileId;
  if (!creatorProfileIdByProfileId) {
    return false;
  }

  const seenProfileIds = new Set<string>();
  let currentProfileId: string | null = targetProfileId;
  while (currentProfileId) {
    if (seenProfileIds.has(currentProfileId)) {
      return false;
    }
    seenProfileIds.add(currentProfileId);

    const creatorProfileId = readCreatorProfileId({
      creatorProfileIdByProfileId,
      profileId: currentProfileId,
    });
    if (!creatorProfileId) {
      return false;
    }
    if (creatorProfileId === viewerProfileId) {
      return true;
    }
    currentProfileId = creatorProfileId;
  }

  return false;
}

export function isViewerAncestorOfTargetProfile(input: {
  viewerProfileId?: string;
  targetProfileId?: string;
  creatorProfileIdByProfileId?:
    | ReadonlyMap<string, string | null>
    | Readonly<Record<string, string | null | undefined>>;
}): boolean {
  const viewerProfileId = normalizeOptionalText(input.viewerProfileId);
  const targetProfileId = normalizeOptionalText(input.targetProfileId);
  if (!(viewerProfileId && targetProfileId)) {
    return false;
  }
  if (viewerProfileId === targetProfileId) {
    return false;
  }
  return isViewerSelfOrAncestorOfTargetProfile(input);
}

export function canViewAgentLocalOriginFacts(input: {
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  targetOwnerUserId?: string | null;
  targetProfileId?: string | null;
  creatorProfileIdByProfileId?:
    | ReadonlyMap<string, string | null>
    | Readonly<Record<string, string | null | undefined>>;
}): boolean {
  const targetOwnerUserId = normalizeOwnerUserId(input.targetOwnerUserId);
  const viewerOwnerUserId = normalizeOwnerUserId(input.viewerOwnerUserId);
  if (!(targetOwnerUserId && viewerOwnerUserId)) {
    return false;
  }
  if (targetOwnerUserId !== viewerOwnerUserId) {
    return false;
  }

  const viewerProfileId = normalizeOptionalText(input.viewerProfileId);
  const targetProfileId = normalizeOptionalText(input.targetProfileId);
  if (!(viewerProfileId && targetProfileId)) {
    return false;
  }

  return isViewerSelfOrAncestorOfTargetProfile({
    viewerProfileId,
    targetProfileId,
    creatorProfileIdByProfileId: input.creatorProfileIdByProfileId,
  });
}

function shouldHideAgentOrigin(input: {
  profile: Profile;
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  creatorProfileIdByProfileId?:
    | ReadonlyMap<string, string | null>
    | Readonly<Record<string, string | null | undefined>>;
}): boolean {
  if (input.profile.kind !== "agent") {
    return false;
  }

  const hasVisibleOriginFacts =
    String(input.profile.agentControllerConversationId ?? "").trim().length >
      0 ||
    normalizeOptionalWorkingDirectory(input.profile.workingDirectory) !==
      undefined;
  if (!hasVisibleOriginFacts) {
    return false;
  }

  return !canViewAgentLocalOriginFacts({
    viewerOwnerUserId: input.viewerOwnerUserId,
    viewerProfileId: input.viewerProfileId,
    targetProfileId: input.profile.profileId,
    targetOwnerUserId: input.profile.owner,
    creatorProfileIdByProfileId: input.creatorProfileIdByProfileId,
  });
}

export function redactProfileForViewer(input: {
  profile: Profile;
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  creatorProfileIdByProfileId?:
    | ReadonlyMap<string, string | null>
    | Readonly<Record<string, string | null | undefined>>;
}): Profile {
  if (!shouldHideAgentOrigin(input)) {
    return input.profile;
  }

  const {
    agentControllerConversationId: _agentControllerConversationId,
    workingDirectory: _workingDirectory,
    ...redactedProfile
  } = input.profile;
  return redactedProfile;
}

export function redactSignalForViewer(input: {
  signal: SignalEnvelope;
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  creatorProfileIdByProfileId?:
    | ReadonlyMap<string, string | null>
    | Readonly<Record<string, string | null | undefined>>;
}): SignalEnvelope {
  const redactedProfile = redactProfileForViewer({
    profile: input.signal.profile,
    viewerOwnerUserId: input.viewerOwnerUserId,
    viewerProfileId: input.viewerProfileId,
    creatorProfileIdByProfileId: input.creatorProfileIdByProfileId,
  });
  if (redactedProfile === input.signal.profile) {
    return input.signal;
  }

  return {
    ...input.signal,
    profile: redactedProfile,
  };
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function readCreatorProfileId(input: {
  creatorProfileIdByProfileId:
    | ReadonlyMap<string, string | null>
    | Readonly<Record<string, string | null | undefined>>;
  profileId: string;
}): string | null {
  if (input.creatorProfileIdByProfileId instanceof Map) {
    return normalizeOptionalText(
      input.creatorProfileIdByProfileId.get(input.profileId) ?? null
    );
  }
  return normalizeOptionalText(
    (
      input.creatorProfileIdByProfileId as Readonly<
        Record<string, string | null | undefined>
      >
    )[input.profileId] ?? null
  );
}
