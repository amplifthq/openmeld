import type { ProfileKind } from "./types";

export const MAX_MENTION_TOKEN_LENGTH = 128;

export const MENTION_TOKEN_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const HANDLE_SEED_SANITIZE_REGEX = /[^a-z0-9]+/g;
const HANDLE_SEED_MULTI_SEPARATOR_REGEX = /-+/g;
const LEGACY_MENTION_ALIAS_SEED_MAX_LENGTH = 96;
const LEGACY_MENTION_ALIAS_PROFILE_ID_SUFFIX_LENGTH = 8;
const LEGACY_HANDLE_SEED_START_CHAR_REGEX = /^[a-z0-9]/;
const LEGACY_HANDLE_SEED_SANITIZE_REGEX = /[^A-Za-z0-9._-]+/g;
const LEGACY_HANDLE_SEED_MULTI_SEPARATOR_REGEX = /[._-]{2,}/g;
const PROFILE_ID_SUFFIX_SANITIZE_REGEX = /[^a-z0-9]/g;

// A loop, not /^-+|-+$/: an anchored edge regex backtracks polynomially on
// long separator runs in untrusted names.
function trimEdgeChars(value: string, chars: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && chars.includes(value[start] ?? "")) {
    start += 1;
  }
  while (end > start && chars.includes(value[end - 1] ?? "")) {
    end -= 1;
  }
  return value.slice(start, end);
}

export function normalizeMentionToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_MENTION_TOKEN_LENGTH ||
    !MENTION_TOKEN_REGEX.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function buildProfileHandleBase(input: {
  profileName: string;
  profileKind: ProfileKind;
}): string {
  const normalized = input.profileName
    .trim()
    .toLowerCase()
    .replace(HANDLE_SEED_SANITIZE_REGEX, "-")
    .replace(HANDLE_SEED_MULTI_SEPARATOR_REGEX, "-");

  const bounded = trimEdgeChars(normalized, "-").slice(
    0,
    MAX_MENTION_TOKEN_LENGTH
  );
  if (bounded.length > 0) {
    return bounded;
  }

  return resolveProfileHandleFallbackBase(input.profileKind);
}

export function buildProfileHandleCandidate(input: {
  baseHandle: string;
  profileKind: ProfileKind;
  sequence: number;
}): string {
  const sequence = Math.max(1, Math.trunc(input.sequence));
  const normalizedBase =
    normalizeMentionToken(input.baseHandle) ??
    normalizeMentionToken(
      resolveProfileHandleFallbackBase(input.profileKind)
    ) ??
    "profile";

  if (sequence === 1) {
    return normalizedBase;
  }

  const suffix = `-${sequence}`;
  const boundedBase = trimEdgeChars(
    normalizedBase.slice(0, MAX_MENTION_TOKEN_LENGTH - suffix.length),
    "-"
  );

  const fallbackBase = resolveProfileHandleFallbackBase(
    input.profileKind
  ).slice(0, Math.max(1, MAX_MENTION_TOKEN_LENGTH - suffix.length));

  return `${boundedBase || fallbackBase}${suffix}`;
}

export function buildProfileHandleCandidates(input: {
  profileName: string;
  profileKind: ProfileKind;
  limit?: number;
}): string[] {
  const baseHandle = buildProfileHandleBase(input);
  const limit = Math.max(1, Math.trunc(input.limit ?? 8));
  const candidates: string[] = [];

  for (let sequence = 1; sequence <= limit; sequence += 1) {
    candidates.push(
      buildProfileHandleCandidate({
        baseHandle,
        profileKind: input.profileKind,
        sequence,
      })
    );
  }

  return candidates;
}

export function resolveAvailableProfileHandle(input: {
  profileName: string;
  profileKind: ProfileKind;
  takenHandles?: Iterable<string>;
}): string {
  const takenHandles = new Set<string>();
  for (const handle of input.takenHandles ?? []) {
    const normalized = normalizeMentionToken(handle);
    if (normalized) {
      takenHandles.add(normalized.toLowerCase());
    }
  }

  const baseHandle = buildProfileHandleBase(input);
  for (let sequence = 1; sequence < Number.MAX_SAFE_INTEGER; sequence += 1) {
    const candidate = buildProfileHandleCandidate({
      baseHandle,
      profileKind: input.profileKind,
      sequence,
    });
    if (!takenHandles.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  throw new Error("failed to resolve available profile handle");
}

export function buildLegacyDefaultMentionAliasCandidates(input: {
  profileName: string;
  profileId: string;
  profileKind: ProfileKind;
}): string[] {
  const aliases: string[] = [];
  const normalizedProfileName = normalizeMentionToken(input.profileName);
  if (normalizedProfileName) {
    aliases.push(normalizedProfileName);
  }

  const profileSeed = buildLegacyDefaultMentionAliasSeed({
    profileName: input.profileName,
    profileKind: input.profileKind,
  });
  const profileIdSuffix = normalizeLegacyProfileIdSuffix(input.profileId);
  const fallbackAlias = normalizeMentionToken(
    profileIdSuffix ? `${profileSeed}-${profileIdSuffix}` : profileSeed
  );
  if (fallbackAlias && !aliases.includes(fallbackAlias)) {
    aliases.push(fallbackAlias);
  }

  return aliases;
}

export function isLegacyDefaultMentionAlias(input: {
  mentionAlias: string | null | undefined;
  profileName?: string | null;
  profileId?: string | null;
  profileKind?: ProfileKind | null;
}): boolean {
  const mentionAlias = normalizeMentionToken(input.mentionAlias);
  if (!mentionAlias) {
    return false;
  }

  const profileName =
    typeof input.profileName === "string" ? input.profileName : null;
  const profileId =
    typeof input.profileId === "string" ? input.profileId : null;
  const profileKind = input.profileKind ?? null;
  if (!(profileName && profileId && profileKind)) {
    return false;
  }

  return buildLegacyDefaultMentionAliasCandidates({
    profileName,
    profileId,
    profileKind,
  }).some(
    (candidate) => candidate.toLowerCase() === mentionAlias.toLowerCase()
  );
}

export function resolveCustomMentionAliasOverride(input: {
  mentionAlias: string | null | undefined;
  profileName?: string | null;
  profileId?: string | null;
  profileKind?: ProfileKind | null;
}): string | null {
  const mentionAlias = normalizeMentionToken(input.mentionAlias);
  if (!mentionAlias) {
    return null;
  }

  return isLegacyDefaultMentionAlias({
    mentionAlias,
    profileName: input.profileName,
    profileId: input.profileId,
    profileKind: input.profileKind,
  })
    ? null
    : mentionAlias;
}

function resolveProfileHandleFallbackBase(profileKind: ProfileKind): string {
  switch (profileKind) {
    case "human":
      return "human";
    case "system":
      return "system";
    default:
      return "agent";
  }
}

function normalizeLegacyProfileIdSuffix(profileId: string): string {
  const normalized = profileId
    .trim()
    .toLowerCase()
    .replace(PROFILE_ID_SUFFIX_SANITIZE_REGEX, "");

  if (normalized.length === 0) {
    return "";
  }

  const withoutAgentPrefix = normalized.startsWith("agt")
    ? normalized.slice(3)
    : normalized;
  const source =
    withoutAgentPrefix.length > 0 ? withoutAgentPrefix : normalized;
  return source.slice(0, LEGACY_MENTION_ALIAS_PROFILE_ID_SUFFIX_LENGTH);
}

function buildLegacyDefaultMentionAliasSeed(input: {
  profileName: string;
  profileKind: ProfileKind;
}): string {
  const normalized = trimEdgeChars(
    input.profileName
      .trim()
      .toLowerCase()
      .replace(LEGACY_HANDLE_SEED_SANITIZE_REGEX, "-")
      .replace(LEGACY_HANDLE_SEED_MULTI_SEPARATOR_REGEX, "-"),
    "._-"
  ).slice(0, LEGACY_MENTION_ALIAS_SEED_MAX_LENGTH);

  if (normalized.length === 0) {
    return resolveProfileHandleFallbackBase(input.profileKind);
  }

  if (LEGACY_HANDLE_SEED_START_CHAR_REGEX.test(normalized)) {
    return normalized;
  }

  return `agent-${normalized}`.slice(0, LEGACY_MENTION_ALIAS_SEED_MAX_LENGTH);
}
