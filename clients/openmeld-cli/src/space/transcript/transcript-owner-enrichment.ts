import type { HelloAck, SignalEnvelope } from "@openmeld/protocol";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { resolveNormalizedOwnerFields } from "../agent-output-contract";

type TranscriptOwnerEnrichmentSessionProfileIdentity = {
  kind: "human" | "agent";
  openMeldProfileId: string;
  ownerUserId?: string;
  ownerName?: string;
};

type ResolvedOwnerDisplay = {
  ownerUserId: string;
  ownerName: string;
};

export function resolveEnrichedTextRenderEvent(input: {
  event: SignalEnvelope | HelloAck;
  ownerDisplayNameByUserId: Map<string, string>;
  sessionProfileIdentity: TranscriptOwnerEnrichmentSessionProfileIdentity;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): SignalEnvelope | HelloAck {
  if (!isOwnerEnrichmentCandidate(input.event)) {
    return input.event;
  }

  const profile = input.event.profile;
  const currentOwner = resolveProfileOwnerDisplay(profile);
  cacheOwnerDisplayName(input.ownerDisplayNameByUserId, currentOwner);

  const mergedOwner = resolveMergedOwnerDisplay({
    currentOwner,
    ownerDisplayNameByUserId: input.ownerDisplayNameByUserId,
    sessionOwner: resolveSessionOwnerDisplay({
      profile,
      sessionProfileIdentity: input.sessionProfileIdentity,
    }),
    snapshotOwner: resolveSnapshotOwnerDisplay({
      profile,
      spaceMembersSnapshot: input.spaceMembersSnapshot,
    }),
  });
  cacheOwnerDisplayName(input.ownerDisplayNameByUserId, mergedOwner);

  if (
    mergedOwner.ownerUserId === currentOwner.ownerUserId &&
    (!mergedOwner.ownerName || mergedOwner.ownerName === currentOwner.ownerName)
  ) {
    return input.event;
  }

  return {
    ...input.event,
    profile: {
      ...profile,
      ...(mergedOwner.ownerUserId
        ? { ownerUserId: mergedOwner.ownerUserId }
        : {}),
      ...(mergedOwner.ownerName ? { ownerName: mergedOwner.ownerName } : {}),
      ...("owner" in profile ? { owner: undefined } : {}),
    },
  };
}

function isSignalEnvelope(
  event: SignalEnvelope | HelloAck
): event is SignalEnvelope {
  return "id" in event && typeof event.id === "string";
}

function isOwnerEnrichmentCandidate(
  event: SignalEnvelope | HelloAck
): event is SignalEnvelope & {
  profile: NonNullable<SignalEnvelope["profile"]> & {
    kind: "human" | "agent";
  };
} {
  return (
    isSignalEnvelope(event) &&
    (event.profile?.kind === "human" || event.profile?.kind === "agent")
  );
}

function resolveProfileOwnerDisplay(
  profile: NonNullable<SignalEnvelope["profile"]>
): ResolvedOwnerDisplay {
  const { ownerUserId, ownerName } = resolveNormalizedOwnerFields({
    ownerUserId: (profile as { ownerUserId?: unknown }).ownerUserId,
    ownerName: profile.ownerName,
    owner: (profile as { owner?: unknown }).owner,
  });
  return {
    ownerUserId: ownerUserId ?? "",
    ownerName: ownerName ?? "",
  };
}

function cacheOwnerDisplayName(
  ownerDisplayNameByUserId: Map<string, string>,
  ownerDisplay: ResolvedOwnerDisplay
): void {
  if (!(ownerDisplay.ownerUserId && ownerDisplay.ownerName)) {
    return;
  }

  ownerDisplayNameByUserId.set(
    ownerDisplay.ownerUserId,
    ownerDisplay.ownerName
  );
}

function resolveSessionOwnerDisplay(input: {
  profile: NonNullable<SignalEnvelope["profile"]> & {
    kind: "human" | "agent";
  };
  sessionProfileIdentity: TranscriptOwnerEnrichmentSessionProfileIdentity;
}): ResolvedOwnerDisplay {
  if (
    input.profile.kind !== input.sessionProfileIdentity.kind ||
    input.profile.profileId !== input.sessionProfileIdentity.openMeldProfileId
  ) {
    return {
      ownerUserId: "",
      ownerName: "",
    };
  }

  return {
    ownerUserId: String(input.sessionProfileIdentity.ownerUserId ?? "").trim(),
    ownerName: String(input.sessionProfileIdentity.ownerName ?? "").trim(),
  };
}

function resolveSnapshotOwnerDisplay(input: {
  profile: NonNullable<SignalEnvelope["profile"]> & {
    kind: "human" | "agent";
  };
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): ResolvedOwnerDisplay {
  const snapshot = input.spaceMembersSnapshot ?? null;
  const matchedSnapshot =
    input.profile.kind === "human"
      ? findMatchingHumanMemberSnapshot({
          profileId: input.profile.profileId,
          profileName: input.profile.profileName,
          snapshot,
        })
      : findMatchingAgentMemberSnapshot({
          profileId: input.profile.profileId,
          profileName: input.profile.profileName,
          snapshot,
        });

  return {
    ownerUserId: String(matchedSnapshot?.ownerUserId ?? "").trim(),
    ownerName: String(matchedSnapshot?.ownerName ?? "").trim(),
  };
}

function resolveMergedOwnerDisplay(input: {
  currentOwner: ResolvedOwnerDisplay;
  ownerDisplayNameByUserId: Map<string, string>;
  sessionOwner: ResolvedOwnerDisplay;
  snapshotOwner: ResolvedOwnerDisplay;
}): ResolvedOwnerDisplay {
  const ownerUserId =
    input.currentOwner.ownerUserId ||
    input.sessionOwner.ownerUserId ||
    input.snapshotOwner.ownerUserId;
  const ownerName =
    input.currentOwner.ownerName ||
    input.sessionOwner.ownerName ||
    input.snapshotOwner.ownerName ||
    (ownerUserId
      ? String(input.ownerDisplayNameByUserId.get(ownerUserId) ?? "").trim()
      : "");

  return {
    ownerUserId,
    ownerName,
  };
}

function findMatchingHumanMemberSnapshot(input: {
  profileId?: string;
  profileName?: string;
  snapshot: SpaceMembersSnapshot | null;
}) {
  if (!input.snapshot) {
    return null;
  }

  const profileId = String(input.profileId ?? "").trim();
  if (profileId) {
    const profileIdMatch = input.snapshot.humans.find(
      (member) => member.status === "active" && member.profileId === profileId
    );
    if (profileIdMatch) {
      return profileIdMatch;
    }
  }

  const profileName = String(input.profileName ?? "")
    .trim()
    .toLowerCase();
  if (!profileName) {
    return null;
  }

  return (
    input.snapshot.humans.find(
      (member) =>
        member.status === "active" &&
        String(member.profileName).trim().toLowerCase() === profileName
    ) ?? null
  );
}

function findMatchingAgentMemberSnapshot(input: {
  profileId?: string;
  profileName?: string;
  snapshot: SpaceMembersSnapshot | null;
}) {
  if (!input.snapshot) {
    return null;
  }

  const profileId = String(input.profileId ?? "").trim();
  if (profileId) {
    const profileIdMatch = input.snapshot.agents.find(
      (member) => member.status === "active" && member.profileId === profileId
    );
    if (profileIdMatch) {
      return profileIdMatch;
    }
  }

  const profileName = String(input.profileName ?? "")
    .trim()
    .toLowerCase();
  if (!profileName) {
    return null;
  }

  return (
    input.snapshot.agents.find(
      (member) =>
        member.status === "active" &&
        String(member.profileName).trim().toLowerCase() === profileName
    ) ?? null
  );
}
