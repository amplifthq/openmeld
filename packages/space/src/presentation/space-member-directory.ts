import type {
  AgentControllerPermissionMode,
  AgentProfileBindingModelSelection,
  SpaceMemberAgentSnapshot,
  SpaceMemberHumanSnapshot,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { createSpaceTargetCatalog } from "../target-identity/target-catalog";
import { resolveSpaceProfileAccent } from "./profile-accent";
import { buildSpaceMemberAgentPublicCollaborationPresencePresentation } from "./space-member-agent-presence";
import { resolveSpaceMemberAgentOwnerWakeDiagnosticsView } from "./space-member-agent-views";

export type SpaceMemberDirectorySectionId = "agents" | "humans";

export type SpaceMemberDirectoryEntry = {
  addedByDisplayName: string | null;
  addedByProfileId: string | null;
  avatarUrl: string | null;
  agentControllerConversationId: string | null;
  agentControllerPermissionMode: AgentControllerPermissionMode | null;
  controllerDisplayName: string | null;
  agentControllerRef: string | null;
  availabilityAction: string | null;
  availabilityBadgeLabel: string | null;
  availabilityCategory: string | null;
  availabilityIsRefreshing: boolean;
  availabilityPhase: string | null;
  availabilityReasonCode: string | null;
  availabilitySummary: string | null;
  availabilityTooltip: string | null;
  id: string;
  lastSeenLabel: string | null;
  liveNow: boolean;
  manualParticipationOnly: boolean;
  mentionLabel: string | null;
  modelSelection: AgentProfileBindingModelSelection | null;
  ownerDisplay: string | null;
  ownerName: string | null;
  ownerUserId: string | null;
  presenceLabel: string | null;
  presenceStatus:
    | "live"
    | "wakeable"
    | "checking_connection"
    | "offline"
    | "unavailable"
    | null;
  profileId: string;
  profileKind: "human" | "agent";
  profileName: string;
  runtimeDeviceDisplayName: string | null;
  searchText: string;
  workingDirectory: string | null;
};

export type SpaceMemberDirectorySection = {
  entries: readonly SpaceMemberDirectoryEntry[];
  id: SpaceMemberDirectorySectionId;
  title: string;
};

export type SpaceMemberDirectory = {
  sections: readonly SpaceMemberDirectorySection[];
};

export function buildSpaceMemberDirectory(
  snapshot: SpaceMembersSnapshot
): SpaceMemberDirectory {
  const catalog = createSpaceTargetCatalog(snapshot);

  return {
    sections: [
      buildDirectorySection({
        catalog,
        members: snapshot.agents,
        sectionId: "agents",
        title: "Agents",
      }),
      buildDirectorySection({
        catalog,
        members: snapshot.humans,
        sectionId: "humans",
        title: "People",
      }),
    ].filter((section) => section.entries.length > 0),
  };
}

function buildDirectorySection(input: {
  catalog: ReturnType<typeof createSpaceTargetCatalog>;
  members: readonly (SpaceMemberHumanSnapshot | SpaceMemberAgentSnapshot)[];
  sectionId: SpaceMemberDirectorySectionId;
  title: string;
}): SpaceMemberDirectorySection {
  return {
    entries: input.members
      .filter((member) => member.status === "active")
      .map((member) => buildDirectoryEntry(member, input.catalog))
      .sort(compareDirectoryEntries),
    id: input.sectionId,
    title: input.title,
  };
}

function buildDirectoryEntry(
  member: SpaceMemberHumanSnapshot | SpaceMemberAgentSnapshot,
  catalog: ReturnType<typeof createSpaceTargetCatalog>
): SpaceMemberDirectoryEntry {
  const catalogEntry = catalog.byProfileId.get(member.profileId) ?? null;
  const accent = resolveSpaceProfileAccent({
    agentControllerRef: catalogEntry?.agentControllerRef ?? null,
    ownerName: catalogEntry?.ownerName ?? null,
    ownerUserId: catalogEntry?.ownerUserId ?? null,
    profileId: member.profileId,
    profileKind: member.profileKind,
    profileName: member.profileName,
  });

  if (member.profileKind === "agent") {
    const presence =
      buildSpaceMemberAgentPublicCollaborationPresencePresentation(member);
    return {
      addedByDisplayName: normalizeText(member.addedByDisplayName),
      addedByProfileId: normalizeText(member.addedByProfileId),
      avatarUrl: normalizeText(member.avatarUrl),
      agentControllerConversationId: normalizeText(
        member.agentControllerConversationId
      ),
      agentControllerPermissionMode:
        member.agentControllerPermissionMode ?? null,
      controllerDisplayName:
        accent.controllerDisplayName ?? catalogEntry?.controllerDisplay ?? null,
      agentControllerRef: normalizeText(member.agentControllerRef),
      availabilityAction: presence.availabilityAction,
      availabilityBadgeLabel: presence.availabilityBadgeLabel,
      availabilityCategory: presence.availabilityCategory,
      availabilityIsRefreshing: presence.availabilityIsRefreshing,
      availabilityPhase: presence.availabilityPhase,
      availabilityReasonCode: presence.availabilityReasonCode,
      availabilitySummary: presence.availabilitySummary,
      availabilityTooltip: presence.availabilityTooltip,
      id: member.profileId,
      lastSeenLabel: normalizeText(member.lastSeenLabel),
      liveNow: member.liveNow,
      manualParticipationOnly: isManualParticipationOnlyAgent(member),
      mentionLabel: catalogEntry?.mentionAlias
        ? `@${catalogEntry.mentionAlias}(wake)`
        : null,
      modelSelection: member.modelSelection ?? null,
      ownerDisplay: catalogEntry?.ownerDisplay ?? null,
      ownerName: catalogEntry?.ownerName ?? null,
      ownerUserId: catalogEntry?.ownerUserId ?? null,
      presenceLabel: presence.shortLabel,
      presenceStatus: presence.status,
      profileId: member.profileId,
      profileKind: member.profileKind,
      profileName: member.profileName,
      runtimeDeviceDisplayName:
        normalizeText(member.runtimeDeviceDisplayName) ??
        catalogEntry?.runtimeDeviceDisplayName ??
        null,
      searchText: buildSearchText(member, catalogEntry),
      workingDirectory: member.workingDirectory ?? null,
    };
  }

  return {
    addedByDisplayName: normalizeText(member.addedByDisplayName),
    addedByProfileId: normalizeText(member.addedByProfileId),
    avatarUrl: normalizeText(member.avatarUrl),
    agentControllerConversationId: null,
    agentControllerPermissionMode: null,
    controllerDisplayName: null,
    agentControllerRef: null,
    availabilityAction: null,
    availabilityBadgeLabel: null,
    availabilityCategory: null,
    availabilityIsRefreshing: false,
    availabilityPhase: null,
    availabilityReasonCode: null,
    availabilitySummary: null,
    availabilityTooltip: null,
    id: member.profileId,
    lastSeenLabel: normalizeText(member.lastSeenLabel),
    liveNow: member.liveNow,
    manualParticipationOnly: false,
    mentionLabel: null,
    modelSelection: null,
    ownerDisplay: catalogEntry?.ownerDisplay ?? null,
    ownerName: catalogEntry?.ownerName ?? null,
    ownerUserId: catalogEntry?.ownerUserId ?? null,
    presenceLabel: member.liveNow
      ? "live now"
      : normalizeText(member.lastSeenLabel),
    presenceStatus: member.liveNow ? "live" : null,
    profileId: member.profileId,
    profileKind: member.profileKind,
    profileName: member.profileName,
    runtimeDeviceDisplayName: null,
    searchText: buildSearchText(member, catalogEntry),
    workingDirectory: null,
  };
}

function compareDirectoryEntries(
  left: SpaceMemberDirectoryEntry,
  right: SpaceMemberDirectoryEntry
): number {
  if (left.liveNow !== right.liveNow) {
    return left.liveNow ? -1 : 1;
  }

  const nameComparison = left.profileName.localeCompare(
    right.profileName,
    "en",
    {
      sensitivity: "base",
    }
  );
  if (nameComparison !== 0) {
    return nameComparison;
  }

  return left.profileId.localeCompare(right.profileId);
}

function buildSearchText(
  member: SpaceMemberHumanSnapshot | SpaceMemberAgentSnapshot,
  catalogEntry:
    | ReturnType<typeof createSpaceTargetCatalog>["entries"][number]
    | null
): string {
  return [
    member.profileName,
    member.profileId,
    catalogEntry?.ownerDisplay ?? null,
    catalogEntry?.ownerUserId ?? null,
    catalogEntry?.runtimeDeviceDisplayName ?? null,
    ...(catalogEntry?.exactMentionLabels ?? []),
  ]
    .map((value) => normalizeText(value))
    .filter((value): value is string => value !== null)
    .join(" ")
    .toLowerCase();
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function isManualParticipationOnlyAgent(
  member: SpaceMemberAgentSnapshot
): boolean {
  const readiness =
    resolveSpaceMemberAgentOwnerWakeDiagnosticsView(member)
      .agentExecutionReadiness ?? null;
  if (readiness) {
    return (
      readiness.displayState !== "ready" &&
      readiness.reasonCodes.some(isUnboundReasonCode)
    );
  }

  return false;
}

function isUnboundReasonCode(reasonCode: string): boolean {
  return (
    reasonCode === "profile.unbound" ||
    reasonCode === "agent_profile_binding.missing"
  );
}
