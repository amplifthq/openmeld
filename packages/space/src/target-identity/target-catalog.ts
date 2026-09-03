import {
  getSpaceMessageAddressingRelationSupportForTargetKind,
  type MessageMentionType,
  openMeldRuntimeProfileIdSchema,
  resolveSpaceMentionLabels,
  type SpaceMentionLabelSource,
} from "@openmeld/schemas";
import type {
  SpaceMemberAgentSnapshot,
  SpaceMemberHumanSnapshot,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { resolveSpaceMemberAgentPublicCollaborationView } from "../presentation/space-member-agent-views";
import { normalizeControllerDisplayLabel } from "./controller-display";

const MENTION_SEARCH_MULTI_SPACE_PATTERN = /\s+/g;

export type SpaceTargetRelationSupport = Record<MessageMentionType, boolean>;

export type SpaceTargetWakeAvailability =
  | {
      status: "unsupported";
      reasonCodes: readonly [];
      reasonText: null;
    }
  | {
      status: "ready" | "blocked";
      reasonCodes: readonly string[];
      reasonText: string | null;
    };

export type SpaceTargetCatalogEntry = {
  allowedRelations: SpaceTargetRelationSupport;
  controllerDisplay: string | null;
  agentControllerRef: string | null;
  exactMentionLabels: readonly string[];
  labelSource: SpaceMentionLabelSource;
  liveNow: boolean;
  lookupTokens: readonly string[];
  mentionAlias: string | null;
  ownerDisplay: string | null;
  ownerName: string | null;
  ownerUserId: string | null;
  preferredLookupToken: string;
  primaryMentionLabel: string;
  profileId: string;
  profileIdShort: string;
  profileKind: "human" | "agent";
  profileName: string;
  runtimeDeviceDisplayName: string | null;
  wakeAvailability: SpaceTargetWakeAvailability;
};

export type SpaceTargetCatalog = {
  byExactMentionLabel: ReadonlyMap<string, SpaceTargetCatalogEntry>;
  byLookupToken: ReadonlyMap<string, SpaceTargetCatalogEntry | null>;
  byProfileId: ReadonlyMap<string, SpaceTargetCatalogEntry>;
  entries: readonly SpaceTargetCatalogEntry[];
};

type ActiveSpaceMember = SpaceMemberHumanSnapshot | SpaceMemberAgentSnapshot;

type ActiveSpaceMemberInput =
  | {
      expectedProfileKind: "agent";
      member: SpaceMemberAgentSnapshot;
    }
  | {
      expectedProfileKind: "human";
      member: SpaceMemberHumanSnapshot;
    };

type ProjectableTarget = {
  allowedRelations: SpaceTargetRelationSupport;
  controllerDisplay: string | null;
  agentControllerRef: string | null;
  liveNow: boolean;
  mentionAlias: string | null;
  ownerDisplay: string | null;
  ownerName: string | null;
  ownerUserId: string | null;
  profileId: string;
  profileIdShort: string;
  profileKind: "human" | "agent";
  profileName: string;
  runtimeDeviceDisplayName: string | null;
  wakeAvailability: SpaceTargetWakeAvailability;
};

export function createSpaceTargetCatalog(
  snapshot: SpaceMembersSnapshot
): SpaceTargetCatalog {
  const activeMembers = buildActiveSpaceMemberInputs(snapshot);
  const ownerProfileNameByOwnerUserId =
    buildOwnerProfileNameByOwnerUserId(snapshot);
  const labelByProfileId = resolveSpaceMentionLabels(
    activeMembers.map(({ member }) => ({
      mentionAlias: member.mentionAlias,
      profileId: member.profileId,
      profileName: member.profileName,
    }))
  );
  const projectableTargets = activeMembers.map((memberInput) =>
    buildProjectableTarget({
      memberInput,
      ownerProfileNameByOwnerUserId,
    })
  );
  const lookupTokenCounts = buildLookupTokenCounts(projectableTargets, {
    labelByProfileId,
  });
  const entries = projectableTargets.map((target) =>
    buildCatalogEntry({
      labelByProfileId,
      lookupTokenCounts,
      target,
    })
  );

  return {
    byExactMentionLabel: buildExactMentionLabelMap(entries),
    byLookupToken: buildLookupTokenMap(entries),
    byProfileId: new Map(entries.map((entry) => [entry.profileId, entry])),
    entries,
  };
}

export function listSpaceTargetCatalog(
  snapshot: SpaceMembersSnapshot
): readonly SpaceTargetCatalogEntry[] {
  return createSpaceTargetCatalog(snapshot).entries;
}

export function normalizeReadableMentionLookupToken(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "")
    .trim()
    .replaceAll(/['’]/g, "")
    .replaceAll(/[^A-Za-z0-9_\-\s]+/g, " ")
    .replace(MENTION_SEARCH_MULTI_SPACE_PATTERN, " ")
    .trim()
    .toLowerCase();

  return normalized.length > 0 ? normalized : null;
}

function buildCatalogEntry(input: {
  labelByProfileId: ReadonlyMap<
    string,
    {
      exactMentionLabels: readonly string[];
      labelSource: SpaceMentionLabelSource;
      primaryMentionLabel: string;
    }
  >;
  lookupTokenCounts: ReadonlyMap<string, number>;
  target: ProjectableTarget;
}): SpaceTargetCatalogEntry {
  const mentionLabels = input.labelByProfileId.get(input.target.profileId);
  if (!mentionLabels) {
    throw new Error(
      `Missing shared mention labels for profile ${input.target.profileId}.`
    );
  }

  return {
    allowedRelations: input.target.allowedRelations,
    controllerDisplay: input.target.controllerDisplay,
    agentControllerRef: input.target.agentControllerRef,
    exactMentionLabels: mentionLabels.exactMentionLabels,
    labelSource: mentionLabels.labelSource,
    liveNow: input.target.liveNow,
    lookupTokens: buildLookupTokens({
      exactMentionLabels: mentionLabels.exactMentionLabels,
      mentionAlias: input.target.mentionAlias,
      profileId: input.target.profileId,
      profileName: input.target.profileName,
    }),
    mentionAlias: input.target.mentionAlias,
    ownerDisplay: input.target.ownerDisplay,
    ownerName: input.target.ownerName,
    ownerUserId: input.target.ownerUserId,
    preferredLookupToken: resolvePreferredLookupToken({
      exactMentionLabels: mentionLabels.exactMentionLabels,
      lookupTokenCounts: input.lookupTokenCounts,
      profileId: input.target.profileId,
      profileName: input.target.profileName,
    }),
    primaryMentionLabel: mentionLabels.primaryMentionLabel,
    profileId: input.target.profileId,
    profileIdShort: input.target.profileIdShort,
    profileKind: input.target.profileKind,
    profileName: input.target.profileName,
    runtimeDeviceDisplayName: input.target.runtimeDeviceDisplayName,
    wakeAvailability: input.target.wakeAvailability,
  };
}

function buildProjectableTarget(input: {
  memberInput: ActiveSpaceMemberInput;
  ownerProfileNameByOwnerUserId: ReadonlyMap<string, string>;
}): ProjectableTarget {
  const { member } = input.memberInput;
  const profileKind = resolveCatalogMemberProfileKind(input.memberInput);
  const agentMember =
    input.memberInput.expectedProfileKind === "agent"
      ? input.memberInput.member
      : null;
  const profileId = parseRuntimeProfileId(member.profileId);
  const profileIdShort = buildProfileIdShort(profileId);
  const ownerName = normalizeOptionalText(member.ownerName);
  const ownerUserId = normalizeOptionalText(member.ownerUserId);

  return {
    allowedRelations: buildAllowedRelations(profileKind),
    controllerDisplay: agentMember
      ? resolveControllerDisplayLabel(agentMember.agentControllerRef)
      : null,
    agentControllerRef: agentMember
      ? normalizeOptionalText(agentMember.agentControllerRef)
      : null,
    liveNow: member.liveNow,
    mentionAlias: normalizeOptionalText(member.mentionAlias),
    ownerDisplay: resolveOwnerDisplayName({
      member,
      ownerProfileNameByOwnerUserId: input.ownerProfileNameByOwnerUserId,
    }),
    ownerName,
    ownerUserId,
    profileId,
    profileIdShort,
    profileKind,
    profileName: member.profileName,
    runtimeDeviceDisplayName: agentMember
      ? normalizeOptionalText(agentMember.runtimeDeviceDisplayName)
      : null,
    wakeAvailability: resolveWakeAvailability({
      agentMember,
      profileKind,
    }),
  };
}

function buildAllowedRelations(
  profileKind: "human" | "agent"
): SpaceTargetRelationSupport {
  return getSpaceMessageAddressingRelationSupportForTargetKind(
    profileKind === "agent" ? "agent_profile" : "human_profile"
  );
}

function resolveWakeAvailability(input: {
  agentMember: SpaceMemberAgentSnapshot | null;
  profileKind: "human" | "agent";
}): SpaceTargetWakeAvailability {
  if (input.profileKind !== "agent") {
    return {
      status: "unsupported",
      reasonCodes: [],
      reasonText: null,
    };
  }

  if (!input.agentMember) {
    throw new Error("Agent Space Message Addressing target is missing.");
  }

  return (
    resolvePublicWakeAvailability(input.agentMember) ?? {
      status: "blocked",
      reasonCodes: [],
      reasonText:
        "OpenMeld is still checking whether this agent can reply from this computer.",
    }
  );
}

function resolvePublicWakeAvailability(
  agentMember: SpaceMemberAgentSnapshot
): SpaceTargetWakeAvailability | null {
  const { agentWakeAvailability } =
    resolveSpaceMemberAgentPublicCollaborationView(agentMember);
  if (!agentWakeAvailability) {
    return null;
  }

  const refreshingAvailable =
    agentWakeAvailability.status === "available_for_wake" &&
    agentWakeAvailability.isRefreshing;
  return {
    status:
      agentWakeAvailability.status === "available_for_wake" &&
      !refreshingAvailable
        ? "ready"
        : "blocked",
    reasonCodes:
      !refreshingAvailable && agentWakeAvailability.reasonCode
        ? [agentWakeAvailability.reasonCode]
        : [],
    // Summary is the canonical explanatory sentence; tooltip is the shorter
    // hover label and would discard recovery context in mention clients.
    reasonText: refreshingAvailable
      ? "Checking whether this agent can reply."
      : agentWakeAvailability.summary,
  };
}

function buildActiveSpaceMemberInputs(
  snapshot: SpaceMembersSnapshot
): ActiveSpaceMemberInput[] {
  return [
    ...snapshot.agents.map((member) => ({
      expectedProfileKind: "agent" as const,
      member,
    })),
    ...snapshot.humans.map((member) => ({
      expectedProfileKind: "human" as const,
      member,
    })),
  ].filter((input) => input.member.status === "active");
}

function resolveCatalogMemberProfileKind(
  input: ActiveSpaceMemberInput
): "human" | "agent" {
  if (input.member.profileKind === input.expectedProfileKind) {
    return input.member.profileKind;
  }

  throw new Error(
    `Cannot resolve Space Message Addressing target kind for profile ${input.member.profileId}.`
  );
}

function buildExactMentionLabelMap(
  entries: readonly SpaceTargetCatalogEntry[]
): Map<string, SpaceTargetCatalogEntry> {
  const byExactMentionLabel = new Map<string, SpaceTargetCatalogEntry>();

  for (const entry of entries) {
    for (const exactMentionLabel of entry.exactMentionLabels) {
      const existingEntry = byExactMentionLabel.get(exactMentionLabel);
      if (existingEntry && existingEntry.profileId !== entry.profileId) {
        throw new Error(
          `Invariant violation: duplicate exact mention label "${exactMentionLabel}" in target catalog.`
        );
      }
      byExactMentionLabel.set(exactMentionLabel, entry);
    }
  }

  return byExactMentionLabel;
}

function buildLookupTokenMap(
  entries: readonly SpaceTargetCatalogEntry[]
): Map<string, SpaceTargetCatalogEntry | null> {
  const byLookupToken = new Map<string, SpaceTargetCatalogEntry | null>();

  for (const entry of entries) {
    for (const lookupToken of entry.lookupTokens) {
      const existingEntry = byLookupToken.get(lookupToken);
      if (existingEntry === undefined) {
        byLookupToken.set(lookupToken, entry);
        continue;
      }
      if (
        existingEntry === null ||
        existingEntry.profileId !== entry.profileId
      ) {
        byLookupToken.set(lookupToken, null);
      }
    }
  }

  return byLookupToken;
}

function buildLookupTokens(input: {
  exactMentionLabels: readonly string[];
  mentionAlias: string | null;
  profileId: string;
  profileName: string;
}): readonly string[] {
  const tokens = new Set<string>();

  addLookupToken(tokens, input.profileId);
  addLookupToken(tokens, input.profileName);
  addLookupToken(tokens, input.mentionAlias);
  for (const exactMentionLabel of input.exactMentionLabels) {
    addLookupToken(tokens, exactMentionLabel);
  }

  return [...tokens];
}

function buildLookupTokenCounts(
  targets: readonly ProjectableTarget[],
  input: {
    labelByProfileId: ReadonlyMap<
      string,
      {
        exactMentionLabels: readonly string[];
        primaryMentionLabel: string;
      }
    >;
  }
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const target of targets) {
    const mentionLabels = input.labelByProfileId.get(target.profileId);
    if (!mentionLabels) {
      continue;
    }

    const uniqueLookupTokens = new Set<string>();
    addLookupToken(uniqueLookupTokens, target.profileId);
    addLookupToken(uniqueLookupTokens, target.profileName);
    addLookupToken(uniqueLookupTokens, target.mentionAlias);
    addLookupToken(uniqueLookupTokens, mentionLabels.primaryMentionLabel);
    for (const exactMentionLabel of mentionLabels.exactMentionLabels) {
      addLookupToken(uniqueLookupTokens, exactMentionLabel);
    }

    for (const lookupToken of uniqueLookupTokens) {
      counts.set(lookupToken, (counts.get(lookupToken) ?? 0) + 1);
    }
  }

  return counts;
}

function resolvePreferredLookupToken(input: {
  exactMentionLabels: readonly string[];
  lookupTokenCounts: ReadonlyMap<string, number>;
  profileId: string;
  profileName: string;
}): string {
  for (const candidate of [input.exactMentionLabels[0], input.profileName]) {
    const normalizedCandidate = normalizeLookupToken(candidate);
    if (
      normalizedCandidate &&
      isUniquelyOwnedLookupToken(input.lookupTokenCounts, normalizedCandidate)
    ) {
      return normalizedCandidate;
    }
  }

  return input.profileId;
}

function isUniquelyOwnedLookupToken(
  counts: ReadonlyMap<string, number>,
  token: string | null
): token is string {
  return Boolean(token && counts.get(token) === 1);
}

function addLookupToken(tokens: Set<string>, value: string | null | undefined) {
  const normalizedToken = normalizeLookupToken(value);
  if (normalizedToken) {
    tokens.add(normalizedToken);
  }
}

function normalizeLookupToken(value: string | null | undefined): string | null {
  return normalizeReadableMentionLookupToken(value);
}

function buildOwnerProfileNameByOwnerUserId(
  snapshot: SpaceMembersSnapshot
): Map<string, string> {
  const ownerProfileStateByUserId = new Map<
    string,
    { priority: number; profileName: string }
  >();

  for (const human of snapshot.humans) {
    if (human.status !== "active") {
      continue;
    }

    const ownerUserId = normalizeOptionalText(human.ownerUserId);
    const profileName = normalizeOptionalText(human.profileName);
    if (!(ownerUserId && profileName)) {
      continue;
    }

    const nextPriority = human.liveNow ? 1 : 0;
    const existing = ownerProfileStateByUserId.get(ownerUserId);
    if (existing && existing.priority > nextPriority) {
      continue;
    }

    ownerProfileStateByUserId.set(ownerUserId, {
      priority: nextPriority,
      profileName,
    });
  }

  return new Map(
    [...ownerProfileStateByUserId.entries()].map(([ownerUserId, state]) => [
      ownerUserId,
      state.profileName,
    ])
  );
}

function resolveOwnerDisplayName(input: {
  member: ActiveSpaceMember;
  ownerProfileNameByOwnerUserId: ReadonlyMap<string, string>;
}): string | null {
  if (input.member.profileKind === "human") {
    return (
      normalizeOptionalText(input.member.profileName) ??
      normalizeOptionalText(input.member.ownerName)
    );
  }

  const ownerName = normalizeOptionalText(input.member.ownerName);
  if (ownerName) {
    return ownerName;
  }

  const ownerUserId = normalizeOptionalText(input.member.ownerUserId);
  if (!ownerUserId) {
    return null;
  }

  return input.ownerProfileNameByOwnerUserId.get(ownerUserId) ?? null;
}

function buildProfileIdShort(profileId: string): string {
  if (profileId.startsWith("agt_")) {
    return `agt_${profileId.slice("agt_".length, "agt_".length + 5)}`;
  }

  return profileId.slice(0, 5);
}

function parseRuntimeProfileId(profileId: string): string {
  const parsed = openMeldRuntimeProfileIdSchema.safeParse(profileId);
  if (!parsed.success) {
    throw new Error(`Invalid OpenMeld runtime profile ID: ${profileId}`);
  }
  return parsed.data;
}

function resolveControllerDisplayLabel(
  agentControllerRef: string | null | undefined
): string | null {
  return normalizeControllerDisplayLabel(agentControllerRef);
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
