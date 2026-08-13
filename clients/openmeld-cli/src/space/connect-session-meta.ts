import type { SpaceCursor, SpaceMeta } from "@openmeld/protocol";
import { resolveCustomMentionAliasOverride } from "@openmeld/protocol";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";

const MENTION_ALIAS_TOKEN_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function resolvePresentString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return value;
}

function resolveTrimmedPresentString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  return normalized;
}

function resolveOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function resolveCreatorProfileId(creator: unknown): string | undefined {
  if (!creator || typeof creator !== "object") {
    return undefined;
  }
  const record = creator as { profileId?: unknown; profile?: unknown };
  if (
    typeof record.profileId === "string" &&
    record.profileId.trim().length > 0
  ) {
    return record.profileId.trim();
  }
  if (typeof record.profile === "string" && record.profile.trim().length > 0) {
    return record.profile.trim();
  }
  return undefined;
}

export function resolveCreatorProfileName(
  creator: unknown
): string | undefined {
  if (!creator || typeof creator !== "object") {
    return undefined;
  }
  const record = creator as { profileName?: unknown };
  return normalizeOptionalTrimmedText(record.profileName);
}

export function resolveCreatorKind(
  kind: unknown
): "human" | "agent" | "system" | undefined {
  if (kind === "human" || kind === "agent" || kind === "system") {
    return kind;
  }
  return undefined;
}

export function normalizeOptionalTrimmedText(
  value: unknown
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeOptionalIsoDateTime(
  value: unknown
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return normalized;
}

export function resolveSessionMeta(
  requestedSpace: string,
  spaceMeta: SpaceMeta | null,
  fallbackName?: string,
  fallbackSpaceCreatedAt?: string
): {
  accessMode?: SpaceMeta["accessMode"];
  spaceId: string;
  spaceName?: string;
  spaceCreatedAt?: string;
  spaceCreatorName?: string;
  spaceCreatorId?: string;
  passwordProtected?: boolean;
  visibility?: SpaceMeta["visibility"];
  storageUsedBytes?: number;
  storageSoftLimitBytes?: number;
  storageUsagePercent?: number;
} {
  const spaceId = resolvePresentString(spaceMeta?.spaceId) ?? requestedSpace;
  const fallbackSpaceName = resolveTrimmedPresentString(fallbackName);
  const spaceName = resolvePresentString(spaceMeta?.name) ?? fallbackSpaceName;
  const fallbackCreatedAt = resolveTrimmedPresentString(fallbackSpaceCreatedAt);
  const spaceCreatedAt =
    resolvePresentString(spaceMeta?.createdAt) ?? fallbackCreatedAt;
  const spaceCreatorName = resolveCreatorProfileName(spaceMeta?.creator);
  const spaceCreatorId = resolveCreatorProfileId(spaceMeta?.creator);
  const passwordProtected =
    typeof spaceMeta?.passwordProtected === "boolean"
      ? spaceMeta.passwordProtected
      : undefined;
  const accessMode = spaceMeta?.accessMode;
  const visibility = spaceMeta?.visibility;
  const storageUsedBytes = resolveOptionalNumber(
    spaceMeta?.storageUsage?.usedBytes
  );
  const storageSoftLimitBytes = resolveOptionalNumber(
    spaceMeta?.storageUsage?.softLimitBytes
  );
  const storageUsagePercent = resolveOptionalNumber(
    spaceMeta?.storageUsage?.usagePercent
  );

  return {
    ...(accessMode ? { accessMode } : {}),
    spaceId,
    ...(spaceName ? { spaceName } : {}),
    ...(spaceCreatedAt ? { spaceCreatedAt } : {}),
    ...(spaceCreatorName ? { spaceCreatorName } : {}),
    ...(spaceCreatorId ? { spaceCreatorId } : {}),
    ...(typeof passwordProtected === "boolean" ? { passwordProtected } : {}),
    ...(visibility ? { visibility } : {}),
    ...(typeof storageUsedBytes === "number" ? { storageUsedBytes } : {}),
    ...(typeof storageSoftLimitBytes === "number"
      ? { storageSoftLimitBytes }
      : {}),
    ...(typeof storageUsagePercent === "number" ? { storageUsagePercent } : {}),
  };
}

export function resolveSessionRoleContext(input: {
  inputRole?: string;
  localRole?: string;
  cloudRole?: string;
}): { role?: string } {
  const role =
    normalizeRoleValue(input.inputRole) ??
    normalizeRoleValue(input.cloudRole) ??
    normalizeRoleValue(input.localRole);

  return {
    ...(role ? { role } : {}),
  };
}

export function resolveSessionMentionAlias(input: {
  inputMentionAlias?: string;
  localMentionAlias?: string;
  cloudMentionAlias?: string;
  profileId?: string;
  profileName?: string;
  profileKind?: OpenMeldProfile["profileKind"];
}): string | undefined {
  const explicitMentionAlias = normalizeMentionAliasValue(
    input.inputMentionAlias
  );
  if (explicitMentionAlias) {
    return explicitMentionAlias;
  }

  return (
    normalizeStoredMentionAliasValue({
      mentionAlias: input.cloudMentionAlias,
      profileId: input.profileId,
      profileName: input.profileName,
      profileKind: input.profileKind,
    }) ??
    normalizeStoredMentionAliasValue({
      mentionAlias: input.localMentionAlias,
      profileId: input.profileId,
      profileName: input.profileName,
      profileKind: input.profileKind,
    })
  );
}

export function buildSpaceCursorPatch(input: {
  lastSeenTs: number | null;
  shouldSyncRole: boolean;
  shouldSyncMentionAlias: boolean;
  role?: string;
  mentionAlias?: string;
}): {
  lastSeenTs?: number;
  role?: string;
  mentionAlias?: string;
} | null {
  const patch: {
    lastSeenTs?: number;
    role?: string;
    mentionAlias?: string;
  } = {};

  if (typeof input.lastSeenTs === "number") {
    patch.lastSeenTs = input.lastSeenTs;
  }
  if (input.shouldSyncRole && input.role) {
    patch.role = input.role;
  }
  if (input.shouldSyncMentionAlias && input.mentionAlias) {
    patch.mentionAlias = input.mentionAlias;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export function normalizeCursorLastSeenTs(
  cursor: SpaceCursor | null
): number | null {
  const value = cursor?.lastSeenTs;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.trunc(value);
}

export function normalizeRoleValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeMentionAliasValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  return MENTION_ALIAS_TOKEN_REGEX.test(normalized) ? normalized : undefined;
}

export function normalizeStoredMentionAliasValue(input: {
  mentionAlias: unknown;
  profileId?: string;
  profileName?: string;
  profileKind?: OpenMeldProfile["profileKind"];
}): string | undefined {
  const normalizedMentionAlias = normalizeMentionAliasValue(input.mentionAlias);
  if (!normalizedMentionAlias) {
    return undefined;
  }

  return (
    resolveCustomMentionAliasOverride({
      mentionAlias: normalizedMentionAlias,
      profileId: input.profileId,
      profileName: input.profileName,
      profileKind: input.profileKind,
    }) ?? undefined
  );
}

export function resolveMaxLastSeenTs(
  localLastSeenTs: number | null,
  cloudLastSeenTs: number | null
): number | null {
  if (
    typeof localLastSeenTs === "number" &&
    typeof cloudLastSeenTs === "number"
  ) {
    return Math.max(localLastSeenTs, cloudLastSeenTs);
  }
  if (typeof localLastSeenTs === "number") {
    return localLastSeenTs;
  }
  if (typeof cloudLastSeenTs === "number") {
    return cloudLastSeenTs;
  }
  return null;
}
