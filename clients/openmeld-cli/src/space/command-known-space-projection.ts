import type { SpaceCreator } from "@openmeld/protocol";
import type { AccountSpaceIndexItem } from "@openmeld/schemas/types";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { normalizeOptionalString } from "./command-http-errors";
import {
  normalizeDisplayValue,
  resolveGatewayHost,
} from "./command-input-normalizers";
import type { SpaceConfig } from "./local-state";
import {
  buildSpaceDisplayProjection,
  buildSpaceMetadataFields,
  resolveSpaceDisplayName,
} from "./space-display-projection";

type KnownSpaceSource = "cloud" | "local";
const LEGACY_WELCOMING_SPACE_PURPOSE = "openmeld_welcoming_space";

export type KnownSpaceOption = {
  source: KnownSpaceSource;
  space: string;
  baseUrl?: string;
  name?: string | null;
  creatorProfileName?: string | null;
  creatorProfileId?: string | null;
  creatorOwnerUserId?: string | null;
  creatorKind?: string | null;
  availableViaProfileName?: string | null;
  availableViaProfileId?: string | null;
  spaceCreatedAt?: string | null;
  spaceUpdatedAt?: string | null;
  lastJoinedAt?: string | null;
  lastSeenTs?: number | null;
  passwordProtected?: boolean | null;
  status?: string | null;
  updatedAt?: string | null;
  gatewayHost?: string | null;
  spacePurpose?: string | null;
  activeAgentCount?: number | null;
  activeHumanCount?: number | null;
  activeMemberCount?: number | null;
};

export type KnownSpaceVisibilityScope = "profile" | "owner";

export type KnownSpaceDeletedNotice = {
  gatewayHost: string;
  spaceId: string;
  spaceName: string | null;
  deletedAt: string;
  deletedByProfileName: string | null;
  deletedByProfileId: string | null;
};

type KnownSpaceDetailVariant = "full" | "delete_confirmation";

export function toKnownSpaceOptionFromAccountIndex(
  item: AccountSpaceIndexItem,
  baseUrl: string
): KnownSpaceOption {
  return {
    source: "cloud",
    space: item.spaceId,
    baseUrl,
    name: item.spaceName,
    creatorProfileName: item.creatorProfileName,
    creatorProfileId: item.creatorProfileId,
    creatorOwnerUserId: item.creatorOwnerUserId,
    creatorKind: item.creatorKind,
    availableViaProfileName: item.openProfileName,
    availableViaProfileId: item.openProfileId,
    spaceCreatedAt: item.spaceCreatedAt,
    spaceUpdatedAt: item.spaceUpdatedAt,
    lastJoinedAt: item.lastJoinedAt,
    lastSeenTs: item.lastSeenTs,
    status: item.status,
    updatedAt: item.updatedAt,
    gatewayHost: item.gatewayHost,
    spacePurpose: item.spacePurpose,
    activeAgentCount: item.activeAgentCount,
    activeHumanCount: item.activeHumanCount,
    activeMemberCount: item.activeMemberCount,
  };
}

export function resolveKnownSpaceVisibilityScope(input: {
  openMeldProfile: OpenMeldProfile;
  command:
    | "join"
    | "watch"
    | "guide"
    | "delete"
    | "password"
    | "add_members"
    | "remove_members"
    | "leave";
}): KnownSpaceVisibilityScope {
  if (
    input.openMeldProfile.profileKind === "human" &&
    input.openMeldProfile.isDefault === true &&
    (input.command === "join" ||
      input.command === "watch" ||
      input.command === "guide" ||
      input.command === "delete")
  ) {
    return "owner";
  }
  return "profile";
}

export function shouldLoadCloudKnownSpaces(input: {
  command:
    | "join"
    | "watch"
    | "guide"
    | "delete"
    | "password"
    | "add_members"
    | "remove_members"
    | "leave";
  visibilityScope: KnownSpaceVisibilityScope;
}): boolean {
  if (
    input.command === "join" ||
    input.command === "watch" ||
    input.command === "guide" ||
    input.command === "delete" ||
    input.command === "password" ||
    input.command === "add_members" ||
    input.command === "remove_members" ||
    input.command === "leave"
  ) {
    return true;
  }
  return input.visibilityScope === "owner";
}

export function filterKnownSpacesForSelection(
  spaces: KnownSpaceOption[]
): KnownSpaceOption[] {
  return spaces.filter((space) => !isHiddenKnownSpaceForSelection(space));
}

function isHiddenKnownSpaceForSelection(space: KnownSpaceOption): boolean {
  return (
    normalizeOptionalString(space.spacePurpose) ===
    LEGACY_WELCOMING_SPACE_PURPOSE
  );
}

export function sortKnownSpacesForSelection(
  spaces: KnownSpaceOption[]
): KnownSpaceOption[] {
  return [...spaces].sort((left, right) => {
    const leftSortKey = resolveKnownSpaceSortKey(left);
    const rightSortKey = resolveKnownSpaceSortKey(right);
    if (leftSortKey.rank !== rightSortKey.rank) {
      return rightSortKey.rank - leftSortKey.rank;
    }
    if (leftSortKey.timestamp !== rightSortKey.timestamp) {
      return rightSortKey.timestamp - leftSortKey.timestamp;
    }
    if (leftSortKey.name !== rightSortKey.name) {
      return leftSortKey.name.localeCompare(rightSortKey.name);
    }
    return leftSortKey.space.localeCompare(rightSortKey.space);
  });
}

function resolveKnownSpaceSortKey(space: KnownSpaceOption): {
  rank: number;
  timestamp: number;
  name: string;
  space: string;
} {
  const joinedAt = parseKnownSpaceTimestamp(space.lastJoinedAt);
  if (joinedAt !== null) {
    return {
      rank: 3,
      timestamp: joinedAt,
      name: normalizeKnownSpaceSortName(space.name),
      space: space.space,
    };
  }

  const lastSeenTs =
    typeof space.lastSeenTs === "number" && Number.isFinite(space.lastSeenTs)
      ? space.lastSeenTs
      : null;
  if (lastSeenTs !== null) {
    return {
      rank: 2,
      timestamp: lastSeenTs,
      name: normalizeKnownSpaceSortName(space.name),
      space: space.space,
    };
  }

  const updatedAt =
    parseKnownSpaceTimestamp(space.updatedAt) ??
    parseKnownSpaceTimestamp(space.spaceUpdatedAt) ??
    parseKnownSpaceTimestamp(space.spaceCreatedAt) ??
    0;
  return {
    rank: updatedAt > 0 ? 1 : 0,
    timestamp: updatedAt,
    name: normalizeKnownSpaceSortName(space.name),
    space: space.space,
  };
}

function parseKnownSpaceTimestamp(
  value: string | null | undefined
): number | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeKnownSpaceSortName(value: string | null | undefined): string {
  return normalizeOptionalString(value)?.toLowerCase() ?? "untitled-space";
}

export function normalizeKnownSpaceVisibilityScope(
  visibilityScope?: KnownSpaceVisibilityScope
): KnownSpaceVisibilityScope {
  return visibilityScope === "owner" ? "owner" : "profile";
}

export function formatKnownSpaceName(input: {
  space: KnownSpaceOption;
  resolvedView: "human" | "agent";
  currentProfileId: string;
  currentOwnerUserId?: string;
  command?:
    | "join"
    | "watch"
    | "guide"
    | "delete"
    | "password"
    | "add_members"
    | "remove_members"
    | "leave";
}): string {
  const projection = buildKnownSpaceDisplayProjection({
    space: input.space,
    currentProfileId: input.currentProfileId,
  });
  const name = resolveSpaceDisplayName(projection.spaceName, "untitled-space");
  if (input.command === "password") {
    return input.space.passwordProtected === true ? `🔒 ${name}` : name;
  }
  const nameWithProtectionMarker =
    input.resolvedView === "human" && input.space.passwordProtected === true
      ? `🔒 - ${name}`
      : name;
  return nameWithProtectionMarker;
}

export function formatKnownSpaceOptionLabel(input: {
  space: KnownSpaceOption;
  resolvedView: "human" | "agent";
  currentProfileId: string;
  currentProfileName?: string;
  currentOwnerUserId?: string;
  command?:
    | "join"
    | "watch"
    | "guide"
    | "delete"
    | "password"
    | "add_members"
    | "remove_members"
    | "leave";
}): string {
  const lines = formatKnownSpaceDetailLines(input);
  const label = formatKnownSpaceName({
    space: input.space,
    resolvedView: input.resolvedView,
    currentProfileId: input.currentProfileId,
    currentOwnerUserId: input.currentOwnerUserId,
    command: input.command,
  });
  if (lines.length === 0) {
    return label;
  }
  return [label, ...lines.map((line) => `   - ${line}`)].join("\n");
}

export function formatKnownSpaceListLine(input: {
  index: number;
  space: KnownSpaceOption;
  resolvedView: "human" | "agent";
  currentProfileId: string;
  currentProfileName?: string;
  currentOwnerUserId?: string;
  command?:
    | "join"
    | "watch"
    | "guide"
    | "delete"
    | "password"
    | "add_members"
    | "remove_members"
    | "leave";
}): string {
  const title = `${String(input.index)}. ${formatKnownSpaceName({
    space: input.space,
    resolvedView: input.resolvedView,
    currentProfileId: input.currentProfileId,
    currentOwnerUserId: input.currentOwnerUserId,
    command: input.command,
  })}`;
  const lines = formatKnownSpaceDetailLines({
    space: input.space,
    resolvedView: input.resolvedView,
    currentProfileId: input.currentProfileId,
    ...(input.currentProfileName
      ? { currentProfileName: input.currentProfileName }
      : {}),
    ...(input.command ? { command: input.command } : {}),
  });
  return [title, ...lines.map((line) => `   ${line}`)].join("\n");
}

export function buildKnownSpaceData(
  item: KnownSpaceOption,
  index: number
): Record<string, unknown> {
  return {
    index,
    spaceId: item.space,
    name: formatKnownSpaceName({
      space: item,
      resolvedView: "agent",
      currentProfileId: "",
    }),
    source: item.source,
    creatorProfileName: item.creatorProfileName ?? null,
    creatorProfileId: item.creatorProfileId ?? null,
    creatorOwnerUserId: item.creatorOwnerUserId ?? null,
    creatorKind: item.creatorKind ?? null,
    availableViaProfileName: item.availableViaProfileName ?? null,
    availableViaProfileId: item.availableViaProfileId ?? null,
    spaceCreatedAt: item.spaceCreatedAt ?? null,
    spaceUpdatedAt: item.spaceUpdatedAt ?? null,
    lastJoinedAt: item.lastJoinedAt ?? null,
    lastSeenTs: item.lastSeenTs ?? null,
    status: item.status ?? null,
    gatewayHost: item.gatewayHost ?? null,
    baseUrl: item.baseUrl ?? null,
    spacePurpose: item.spacePurpose ?? null,
    activeAgentCount: item.activeAgentCount ?? null,
    activeHumanCount: item.activeHumanCount ?? null,
    activeMemberCount: item.activeMemberCount ?? null,
  };
}

export function formatKnownSpaceDetailLines(input: {
  space: KnownSpaceOption;
  resolvedView: "human" | "agent";
  currentProfileId: string;
  currentProfileName?: string;
  currentOwnerUserId?: string;
  detailVariant?: KnownSpaceDetailVariant;
  command?:
    | "join"
    | "watch"
    | "guide"
    | "delete"
    | "password"
    | "add_members"
    | "remove_members"
    | "leave";
}): string[] {
  const projection = buildKnownSpaceDisplayProjection({
    space: input.space,
    currentProfileId: input.currentProfileId,
    currentProfileName: input.currentProfileName,
  });
  const detailVariant = input.detailVariant ?? "full";
  const lines = buildSpaceMetadataFields({
    projection,
    includeAvailableVia: detailVariant !== "delete_confirmation",
    includeCreatedAt: detailVariant !== "delete_confirmation",
    includeLastJoinedAt: detailVariant !== "delete_confirmation",
  }).map((field) => `${field.label}: ${field.value}`);

  if (detailVariant === "delete_confirmation") {
    return lines;
  }

  if (input.resolvedView === "human") {
    if (input.space.source === "local") {
      lines.push("Source: local cache");
    }
    return lines;
  }

  lines.push(`Gateway: ${normalizeDisplayValue(input.space.gatewayHost)}`);
  lines.push(`Status: ${normalizeDisplayValue(input.space.status)}`);
  lines.push(`Creator kind: ${normalizeDisplayValue(input.space.creatorKind)}`);
  lines.push(
    `Space updated: ${normalizeDisplayValue(input.space.spaceUpdatedAt)}`
  );
  lines.push(`Last seen ts: ${normalizeDisplayValue(input.space.lastSeenTs)}`);
  lines.push(`Record updated: ${normalizeDisplayValue(input.space.updatedAt)}`);
  lines.push(`Source: ${input.space.source}`);

  return lines;
}

export function toKnownSpaceOptionFromLocal(
  item: SpaceConfig,
  availableViaProfile?: OpenMeldProfile
): KnownSpaceOption {
  const creatorProfileName = resolveLocalCreatorProfileName(item.creator);
  const creatorProfileId = resolveLocalCreatorProfileId(item.creator);
  const creatorOwnerUserId = resolveLocalCreatorOwnerUserId(item.creator);

  return {
    source: "local",
    space: item.space,
    baseUrl: item.baseUrl,
    name: item.name ?? null,
    creatorProfileName,
    creatorProfileId,
    creatorOwnerUserId,
    creatorKind:
      typeof item.creator?.kind === "string" ? item.creator.kind : null,
    availableViaProfileName: availableViaProfile?.profileName ?? null,
    availableViaProfileId: availableViaProfile?.openMeldProfileId ?? null,
    spaceCreatedAt: item.spaceCreatedAt ?? null,
    spaceUpdatedAt: item.spaceUpdatedAt ?? null,
    lastJoinedAt: resolveKnownSpaceLastSeenTimestamp(item.lastSeenTs),
    lastSeenTs:
      typeof item.lastSeenTs === "number" && Number.isFinite(item.lastSeenTs)
        ? item.lastSeenTs
        : null,
    passwordProtected:
      typeof item.passwordProtected === "boolean"
        ? item.passwordProtected
        : null,
    updatedAt: item.updatedAt,
    gatewayHost: resolveGatewayHost(item.baseUrl),
    spacePurpose: item.spacePurpose ?? null,
    activeAgentCount: item.activeAgentCount ?? null,
    activeHumanCount: item.activeHumanCount ?? null,
    activeMemberCount: item.activeMemberCount ?? null,
  };
}

function resolveLocalCreatorProfileId(
  creator: SpaceCreator | undefined
): string | null {
  if (typeof creator?.profile === "string") {
    return creator.profile;
  }
  if (typeof creator?.profileId === "string") {
    return creator.profileId;
  }
  return null;
}

function resolveLocalCreatorProfileName(
  creator: SpaceCreator | undefined
): string | null {
  if (typeof creator?.profileName !== "string") {
    return null;
  }
  const normalized = creator.profileName.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveLocalCreatorOwnerUserId(
  creator: SpaceCreator | undefined
): string | null {
  if (typeof creator?.ownerUserId !== "string") {
    return null;
  }
  const normalized = creator.ownerUserId.trim();
  return normalized.length > 0 ? normalized : null;
}

export function buildKnownSpaceDisplayProjection(input: {
  space: KnownSpaceOption;
  currentProfileId: string;
  currentProfileName?: string;
}) {
  return buildSpaceDisplayProjection({
    currentProfileId: input.currentProfileId,
    currentProfileName: input.currentProfileName,
    spaceId: input.space.space,
    spaceName: input.space.name,
    creatorProfileId: input.space.creatorProfileId,
    creatorProfileName: input.space.creatorProfileName,
    availableViaProfileId: input.space.availableViaProfileId,
    availableViaProfileName: input.space.availableViaProfileName,
    spaceCreatedAt: input.space.spaceCreatedAt,
    lastJoinedAt: resolveKnownSpaceJoinedTimestamp(input.space),
    passwordProtected: input.space.passwordProtected,
  });
}

export function resolveKnownSpaceJoinedTimestamp(
  space: KnownSpaceOption
): string | null {
  return (
    normalizeOptionalString(space.lastJoinedAt) ??
    resolveKnownSpaceLastSeenTimestamp(space.lastSeenTs)
  );
}

export function resolveKnownSpaceLastSeenTimestamp(
  value: number | null | undefined
): string | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 1_000_000_000_000
  ) {
    return null;
  }
  return new Date(value).toISOString();
}
