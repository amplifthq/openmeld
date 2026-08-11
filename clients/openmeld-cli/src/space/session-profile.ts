import type { Profile } from "@openmeld/protocol";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import type { TranscriptSessionProfileIdentity } from "./transcript/transcript-item-builder";
import type { SpaceSessionContext } from "./view/space-session-view-state";

export type SpaceSessionProfileIdentity = TranscriptSessionProfileIdentity & {
  openMeldProfileId: string;
  profileHandle?: string;
  profileName: string;
  agentControllerRef?: string;
  agentControllerConversationId?: string;
};

export function buildSpaceSessionProfileIdentity(input: {
  openMeldProfile: OpenMeldProfile;
  agentControllerConversationId?: string | null;
}): SpaceSessionProfileIdentity {
  const { openMeldProfile } = input;
  const agentControllerConversationId = String(
    input.agentControllerConversationId ?? ""
  ).trim();

  return {
    kind: openMeldProfile.profileKind === "agent" ? "agent" : "human",
    openMeldProfileId: openMeldProfile.openMeldProfileId,
    profileHandle: openMeldProfile.profileHandle,
    profileName: openMeldProfile.profileName,
    ...(openMeldProfile.ownerUserId
      ? { ownerUserId: String(openMeldProfile.ownerUserId).trim() }
      : {}),
    ...(openMeldProfile.ownerName
      ? { ownerName: String(openMeldProfile.ownerName).trim() }
      : {}),
    ...(agentControllerConversationId ? { agentControllerConversationId } : {}),
  };
}

export function buildSpaceSessionProfileContext(
  openMeldProfile: OpenMeldProfile
): SpaceSessionContext["profile"] {
  return {
    profileId: openMeldProfile.openMeldProfileId,
    profileName: openMeldProfile.profileName,
    kind: openMeldProfile.profileKind === "agent" ? "agent" : "human",
    ownerUserId: openMeldProfile.ownerUserId ?? null,
    ownerName: openMeldProfile.ownerName ?? null,
  };
}

export function buildSpaceSessionProfileContextFromIdentity(input: {
  kind: "human" | "agent";
  ownerName?: string | null;
  ownerUserId?: string | null;
  openMeldProfileId: string;
  profileName: string;
}): SpaceSessionContext["profile"] {
  return {
    profileId: input.openMeldProfileId,
    profileName: input.profileName,
    kind: input.kind,
    ownerUserId: input.ownerUserId ?? null,
    ownerName: input.ownerName ?? null,
  };
}

export function toProtocolProfile(
  identity: SpaceSessionProfileIdentity
): Profile {
  return {
    kind: identity.kind,
    profileId: identity.openMeldProfileId,
    ...(identity.profileHandle
      ? { profileHandle: identity.profileHandle }
      : {}),
    profileName: identity.profileName,
    ...(identity.ownerUserId ? { owner: identity.ownerUserId } : {}),
    ...(identity.ownerName ? { ownerName: identity.ownerName } : {}),
    ...(identity.agentControllerRef
      ? { agentControllerRef: identity.agentControllerRef }
      : {}),
    ...(identity.agentControllerConversationId
      ? {
          agentControllerConversationId: identity.agentControllerConversationId,
        }
      : {}),
  };
}

export function buildActiveSpaceSessionContext(input: {
  profile: SpaceSessionContext["profile"];
  baseUrl: string;
  connectionMode: SpaceSessionContext["connectionMode"];
  session: SpaceSessionContext["session"];
}): SpaceSessionContext {
  return {
    surface: "active-session",
    connectionMode: input.connectionMode,
    gatewayUrl: input.baseUrl,
    profile: input.profile,
    session: input.session,
  };
}

export function rememberSessionOwnerDisplayName(
  ownerDisplayNameByUserId: Map<string, string>,
  openMeldProfile: OpenMeldProfile
): void {
  rememberOwnerDisplayName(
    ownerDisplayNameByUserId,
    openMeldProfile.ownerUserId,
    openMeldProfile.ownerName
  );
  if (openMeldProfile.profileKind === "human") {
    rememberOwnerDisplayName(
      ownerDisplayNameByUserId,
      openMeldProfile.ownerUserId,
      openMeldProfile.profileName,
      { overwrite: false }
    );
  }
}

export function rememberOwnerDisplayName(
  ownerDisplayNameByUserId: Map<string, string>,
  ownerUserIdRaw: string | null | undefined,
  ownerDisplayRaw: string | null | undefined,
  options?: {
    overwrite?: boolean;
  }
): void {
  const ownerUserId = String(ownerUserIdRaw ?? "").trim();
  const ownerDisplay = String(ownerDisplayRaw ?? "").trim();
  if (!(ownerUserId && ownerDisplay)) {
    return;
  }
  if (
    options?.overwrite === false &&
    ownerDisplayNameByUserId.has(ownerUserId)
  ) {
    return;
  }
  ownerDisplayNameByUserId.set(ownerUserId, ownerDisplay);
}

export function rememberMembersSnapshotOwnerDisplayNames(
  ownerDisplayNameByUserId: Map<string, string>,
  membersSnapshot: SpaceMembersSnapshot | null | undefined
): void {
  for (const human of membersSnapshot?.humans ?? []) {
    rememberOwnerDisplayName(
      ownerDisplayNameByUserId,
      human.ownerUserId,
      human.ownerName ?? human.profileName
    );
  }
  for (const agent of membersSnapshot?.agents ?? []) {
    rememberOwnerDisplayName(
      ownerDisplayNameByUserId,
      agent.ownerUserId,
      agent.ownerName
    );
  }
}
