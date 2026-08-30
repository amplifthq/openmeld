import {
  formatCanonicalMentionLiteral,
  type MessageMentionType,
} from "@openmeld/schemas";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import {
  listRecentMentionProfileIdsFromText,
  type SpaceMentionProfileIndex,
} from "../target-identity/mention-resolution";
import type { SpaceTargetCatalogEntry } from "../target-identity/target-catalog";
import {
  listSpaceSendTargets,
  type SpaceSendTargetAllowedRelations,
  type SpaceSendTargetProjectionEntry,
  type SpaceSendTargetWakeAvailability,
} from "./send-target-projection";
import { formatBlockedWakeAvailabilityLabel } from "./wake-availability-copy";

const MAX_RECENT_MENTION_PROFILE_IDS = 20;
const MENTION_PREFIX_PATTERN = /^@+/;
const MULTI_SPACE_PATTERN = /\s+/g;

const MENTION_RELATION_ORDER: readonly MessageMentionType[] = [
  "wake",
  "reference",
  "mention",
];

const RELATION_LABELS: Record<MessageMentionType, string> = {
  wake: "Wake",
  reference: "Reference",
  mention: "Mention",
};

const RELATION_DESCRIPTIONS: Record<MessageMentionType, string> = {
  wake: "Ask this agent to reply.",
  reference: "Add context without asking for a reply.",
  mention: "Notify this person about the message.",
};

export type SpaceMentionSuggestion = {
  allowedRelations: SpaceSendTargetAllowedRelations;
  controllerDisplay: string | null;
  agentControllerRef: string | null;
  description: string;
  exactMentionLabels: string[];
  labelSource: SpaceSendTargetProjectionEntry["labelSource"];
  liveNow: boolean;
  ownerDisplay: string | null;
  primaryMentionLabel: string;
  profileId: string;
  profileKind: "human" | "agent";
  profileName: string;
  wakeAvailability: SpaceSendTargetWakeAvailability;
};

export type SpaceMentionRelationChoice = {
  canonicalLiteral: string;
  description: string;
  label: string;
  relation: MessageMentionType;
};

type SpaceMentionSuggestionRecord = SpaceMentionSuggestion & {
  searchTerms: string[];
};

export function listSpaceMentionSuggestions(input: {
  query: string;
  snapshot: SpaceMembersSnapshot | null;
  recentProfileIds?: readonly string[] | null;
}): SpaceMentionSuggestion[] {
  const snapshot = input.snapshot;
  if (!snapshot) {
    return [];
  }

  const query = normalizeMentionQuery(input.query);
  const recentRankByProfileId = buildRecentMentionRankByProfileId(
    input.recentProfileIds
  );
  const suggestions = listSpaceSendTargets(snapshot).map((target) =>
    buildMentionSuggestionRecord(target)
  );

  return suggestions
    .filter((suggestion) => matchesMentionQuery(suggestion.searchTerms, query))
    .sort((left, right) =>
      compareMentionSuggestions(left, right, recentRankByProfileId)
    )
    .map(({ searchTerms: _searchTerms, ...suggestion }) => suggestion);
}

export function listSpaceMentionRelationChoices(input: {
  allowedRelations: SpaceSendTargetAllowedRelations;
  primaryMentionLabel: string;
  wakeAvailability: SpaceSendTargetWakeAvailability;
}): SpaceMentionRelationChoice[] {
  const choices: SpaceMentionRelationChoice[] = [];

  for (const relation of MENTION_RELATION_ORDER) {
    if (!input.allowedRelations[relation]) {
      continue;
    }

    choices.push({
      canonicalLiteral: formatCanonicalMentionLiteral({
        name: input.primaryMentionLabel,
        type: relation,
      }),
      description: RELATION_DESCRIPTIONS[relation],
      label: RELATION_LABELS[relation],
      relation,
    });
  }

  return choices;
}

export function normalizeRecentMentionProfileIds(input: {
  profileIds: readonly (string | null | undefined)[] | null | undefined;
  maxRecentProfileIds?: number;
  allowedProfileIds?: readonly string[] | ReadonlySet<string> | null;
}): string[] {
  const maxRecentProfileIds = resolveMaxRecentProfileIds(
    input.maxRecentProfileIds
  );
  const allowedProfileIds = toAllowedProfileIdSet(input.allowedProfileIds);
  const normalizedProfileIds: string[] = [];
  const seenProfileIds = new Set<string>();

  for (const rawProfileId of input.profileIds ?? []) {
    const profileId = normalizeRecentMentionProfileId(rawProfileId);
    if (!profileId) {
      continue;
    }
    if (allowedProfileIds && !allowedProfileIds.has(profileId)) {
      continue;
    }
    if (seenProfileIds.has(profileId)) {
      continue;
    }
    seenProfileIds.add(profileId);
    normalizedProfileIds.push(profileId);
    if (normalizedProfileIds.length >= maxRecentProfileIds) {
      break;
    }
  }

  return normalizedProfileIds;
}

export function mergeRecentMentionProfileIds(input: {
  currentRecentProfileIds:
    | readonly (string | null | undefined)[]
    | null
    | undefined;
  usedProfileIds: readonly (string | null | undefined)[] | null | undefined;
  maxRecentProfileIds?: number;
  allowedProfileIds?: readonly string[] | ReadonlySet<string> | null;
}): string[] {
  return normalizeRecentMentionProfileIds({
    profileIds: [
      ...(input.usedProfileIds ?? []),
      ...(input.currentRecentProfileIds ?? []),
    ],
    maxRecentProfileIds: input.maxRecentProfileIds,
    allowedProfileIds: input.allowedProfileIds,
  });
}

export function buildRecentMentionRankByProfileId(
  recentProfileIds: readonly (string | null | undefined)[] | null | undefined
): ReadonlyMap<string, number> {
  return new Map(
    normalizeRecentMentionProfileIds({
      profileIds: recentProfileIds,
    }).map((profileId, index) => [profileId, index])
  );
}

export function resolveNextRecentMentionProfileIdsForQueuedText(input: {
  currentRecentProfileIds:
    | readonly (string | null | undefined)[]
    | null
    | undefined;
  submittedText: string;
  structuredMentionProfileIdsInTextOrder?:
    | readonly (string | null | undefined)[]
    | null
    | undefined;
  canonicalMentionsInTextOrder?:
    | readonly { profileId: string }[]
    | null
    | undefined;
  mentionProfileIndex: SpaceMentionProfileIndex | null | undefined;
  maxRecentProfileIds?: number;
  allowedProfileIds?: readonly string[] | ReadonlySet<string> | null;
}): string[] | null {
  const structuredUsedProfileIds = normalizeRecentMentionProfileIds({
    profileIds: [
      ...(input.structuredMentionProfileIdsInTextOrder ?? []),
    ].toReversed(),
    maxRecentProfileIds: Number.MAX_SAFE_INTEGER,
  });
  const allowedStructuredUsedProfileIds = normalizeRecentMentionProfileIds({
    profileIds: structuredUsedProfileIds,
    maxRecentProfileIds: Number.MAX_SAFE_INTEGER,
    allowedProfileIds: input.allowedProfileIds,
  });
  if (allowedStructuredUsedProfileIds.length > 0) {
    return mergeRecentMentionProfileIds({
      currentRecentProfileIds: input.currentRecentProfileIds,
      usedProfileIds: allowedStructuredUsedProfileIds,
      maxRecentProfileIds: input.maxRecentProfileIds,
      allowedProfileIds: input.allowedProfileIds,
    });
  }

  const canonicalUsedProfileIds =
    resolveRecentMentionProfileIdsFromCanonicalMentions(
      input.canonicalMentionsInTextOrder
    );
  if (canonicalUsedProfileIds.length > 0) {
    return mergeRecentMentionProfileIds({
      currentRecentProfileIds: input.currentRecentProfileIds,
      usedProfileIds: canonicalUsedProfileIds,
      maxRecentProfileIds: input.maxRecentProfileIds,
      allowedProfileIds: input.allowedProfileIds,
    });
  }

  if (!(input.mentionProfileIndex && input.submittedText.length > 0)) {
    return null;
  }

  const usedProfileIds = listRecentMentionProfileIdsFromText({
    index: input.mentionProfileIndex,
    text: input.submittedText,
  });
  if (usedProfileIds.length === 0) {
    return null;
  }

  return mergeRecentMentionProfileIds({
    currentRecentProfileIds: input.currentRecentProfileIds,
    usedProfileIds,
    maxRecentProfileIds: input.maxRecentProfileIds,
    allowedProfileIds: input.allowedProfileIds,
  });
}

function buildMentionSuggestionRecord(
  target: SpaceTargetCatalogEntry
): SpaceMentionSuggestionRecord {
  return {
    allowedRelations: target.allowedRelations,
    controllerDisplay: target.controllerDisplay,
    agentControllerRef: target.agentControllerRef,
    description: buildMentionSuggestionDescription(target),
    exactMentionLabels: [...target.exactMentionLabels],
    labelSource: target.labelSource,
    liveNow: target.liveNow,
    ownerDisplay: target.ownerDisplay,
    primaryMentionLabel: target.primaryMentionLabel,
    profileId: target.profileId,
    profileKind: target.profileKind,
    profileName: target.profileName,
    wakeAvailability: target.wakeAvailability,
    searchTerms: [
      target.primaryMentionLabel,
      target.profileName,
      target.profileId,
      ...target.exactMentionLabels,
      target.preferredLookupToken,
      ...target.lookupTokens,
    ].flatMap((value) => {
      const normalizedValue = normalizeSearchTerm(value);
      return normalizedValue ? [normalizedValue] : [];
    }),
  };
}

function buildMentionSuggestionDescription(
  target: SpaceTargetCatalogEntry
): string {
  const segments: string[] = [];

  if (
    target.profileKind === "agent" &&
    target.controllerDisplay &&
    !areCaseInsensitiveMatches(
      target.controllerDisplay,
      target.primaryMentionLabel
    )
  ) {
    segments.push(target.controllerDisplay);
  }

  if (target.ownerDisplay) {
    segments.push(
      target.profileKind === "agent"
        ? `by ${target.ownerDisplay}`
        : target.ownerDisplay
    );
  }

  if (
    target.profileKind === "agent" &&
    target.wakeAvailability.status === "blocked"
  ) {
    segments.push(formatBlockedWakeAvailabilityLabel(target.wakeAvailability));
  }

  return segments.join(" · ");
}

function matchesMentionQuery(
  searchTerms: readonly string[],
  query: string
): boolean {
  if (!query) {
    return true;
  }

  return searchTerms.some((value) => value.includes(query));
}

function compareMentionSuggestions(
  left: SpaceMentionSuggestion,
  right: SpaceMentionSuggestion,
  recentRankByProfileId: ReadonlyMap<string, number>
): number {
  if (left.profileKind !== right.profileKind) {
    return left.profileKind === "agent" ? -1 : 1;
  }

  const leftRecentRank =
    recentRankByProfileId.get(left.profileId) ?? Number.MAX_SAFE_INTEGER;
  const rightRecentRank =
    recentRankByProfileId.get(right.profileId) ?? Number.MAX_SAFE_INTEGER;
  if (leftRecentRank !== rightRecentRank) {
    return leftRecentRank - rightRecentRank;
  }

  if (left.liveNow !== right.liveNow) {
    return left.liveNow ? -1 : 1;
  }

  return left.primaryMentionLabel.localeCompare(
    right.primaryMentionLabel,
    "en",
    {
      sensitivity: "base",
    }
  );
}

function normalizeMentionQuery(value: string): string {
  return value
    .trim()
    .replace(MENTION_PREFIX_PATTERN, "")
    .replace(MULTI_SPACE_PATTERN, " ")
    .toLowerCase();
}

function normalizeSearchTerm(value: string | null | undefined): string | null {
  const normalized = String(value ?? "")
    .trim()
    .replace(MENTION_PREFIX_PATTERN, "")
    .replace(MULTI_SPACE_PATTERN, " ")
    .toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function areCaseInsensitiveMatches(left: string, right: string): boolean {
  return left.localeCompare(right, "en", { sensitivity: "accent" }) === 0;
}

function resolveRecentMentionProfileIdsFromCanonicalMentions(
  canonicalMentionsInTextOrder:
    | readonly { profileId: string }[]
    | null
    | undefined
): string[] {
  if (
    !(canonicalMentionsInTextOrder && canonicalMentionsInTextOrder.length > 0)
  ) {
    return [];
  }

  return canonicalMentionsInTextOrder
    .toReversed()
    .map((mention) => mention.profileId);
}

function resolveMaxRecentProfileIds(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return MAX_RECENT_MENTION_PROFILE_IDS;
  }
  return value;
}

function normalizeRecentMentionProfileId(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toAllowedProfileIdSet(
  value: readonly string[] | ReadonlySet<string> | null | undefined
): ReadonlySet<string> | null {
  if (!value) {
    return null;
  }

  const normalizedProfileIds = normalizeRecentMentionProfileIds({
    profileIds: Array.isArray(value) ? value : [...value],
    maxRecentProfileIds: Number.MAX_SAFE_INTEGER,
  });
  return new Set(normalizedProfileIds);
}
