export type SpaceProfileAddMode = "profiles" | "agents" | "human_profiles";

export type SpaceProfileAddProfileKind = "human" | "agent";

export type SpaceProfileAddProfile = {
  profileId: string;
  profileKind: string | null | undefined;
  profileName: string;
  status: string;
  ownerUserId?: string | null | undefined;
  ownerName?: string | null | undefined;
  isDefault?: boolean | undefined;
  createdAt?: string | null | undefined;
  lastUsedAt?: string | null | undefined;
};

export type SpaceProfileAddMember = {
  profileId: string;
  profileKind?: string | null | undefined;
  status?: string | null | undefined;
};

export type SpaceProfileAddSelector =
  | { kind: "none" }
  | { kind: "all" }
  | { kind: "profile_ids"; profileIds: readonly string[] };

export type SpaceProfileAddExcludedReason =
  | "current_acting_profile"
  | "different_owner"
  | "inactive_profile"
  | "kind_mismatch"
  | "not_found"
  | "unsupported_profile_kind";

export type SpaceProfileAddCandidate = {
  alreadyJoined: boolean;
  excludedReason: SpaceProfileAddExcludedReason | null;
  profile: SpaceProfileAddProfile;
  profileId: string;
  profileKind: SpaceProfileAddProfileKind | null;
  profileName: string;
  selectable: boolean;
};

export type SpaceProfileAddInvalidSelection = {
  profileId: string;
  reason: SpaceProfileAddExcludedReason;
};

export type SpaceProfileAddPlan = {
  alreadyJoinedCandidates: readonly SpaceProfileAddCandidate[];
  candidates: readonly SpaceProfileAddCandidate[];
  excludedCandidates: readonly SpaceProfileAddCandidate[];
  invalidSelections: readonly SpaceProfileAddInvalidSelection[];
  mode: SpaceProfileAddMode;
  selectableCandidates: readonly SpaceProfileAddCandidate[];
  selectedCandidates: readonly SpaceProfileAddCandidate[];
  selectedProfileIds: readonly string[];
};

export function buildSpaceProfileAddPlan(input: {
  actingProfileId: string;
  allowCurrentProfile?: boolean;
  currentMembers: readonly SpaceProfileAddMember[];
  currentOwnerUserId?: string | null | undefined;
  mode: SpaceProfileAddMode;
  profiles: readonly SpaceProfileAddProfile[];
  selector: SpaceProfileAddSelector;
}): SpaceProfileAddPlan {
  const actingProfileId = normalizeText(input.actingProfileId);
  const currentOwnerUserId = normalizeText(input.currentOwnerUserId);
  const activeMemberProfileIds = buildActiveMemberProfileIds(
    input.currentMembers
  );
  const candidates = input.profiles
    .map((profile) =>
      buildSpaceProfileAddCandidate({
        activeMemberProfileIds,
        actingProfileId,
        allowCurrentProfile: input.allowCurrentProfile === true,
        currentOwnerUserId,
        mode: input.mode,
        profile,
      })
    )
    .filter(
      (candidate): candidate is SpaceProfileAddCandidate => candidate !== null
    )
    .sort((left, right) =>
      compareSpaceProfileAddCandidates(left, right, input.mode)
    );
  const eligibleCandidateById = new Map(
    candidates
      .filter((candidate) => candidate.excludedReason === null)
      .map((candidate) => [candidate.profileId, candidate] as const)
  );
  const excludedReasonById = new Map(
    candidates
      .filter(
        (
          candidate
        ): candidate is SpaceProfileAddCandidate & {
          excludedReason: SpaceProfileAddExcludedReason;
        } => candidate.excludedReason !== null
      )
      .map(
        (candidate) => [candidate.profileId, candidate.excludedReason] as const
      )
  );
  const selectedProfileIds = resolveSelectedProfileIds({
    eligibleCandidateById,
    excludedReasonById,
    selector: input.selector,
  });
  const selectedCandidates = selectedProfileIds
    .map((profileId) => eligibleCandidateById.get(profileId))
    .filter(
      (candidate): candidate is SpaceProfileAddCandidate =>
        candidate !== undefined
    );

  return {
    alreadyJoinedCandidates: candidates.filter(
      (candidate) =>
        candidate.excludedReason === null && candidate.alreadyJoined
    ),
    candidates,
    excludedCandidates: candidates.filter(
      (candidate) => candidate.excludedReason !== null
    ),
    invalidSelections: resolveInvalidSelections({
      eligibleCandidateById,
      excludedReasonById,
      selector: input.selector,
    }),
    mode: input.mode,
    selectableCandidates: candidates.filter(
      (candidate) => candidate.selectable
    ),
    selectedCandidates,
    selectedProfileIds,
  };
}

export function getSpaceProfileAddModeProfileKinds(
  mode: SpaceProfileAddMode
): readonly SpaceProfileAddProfileKind[] {
  switch (mode) {
    case "agents":
      return ["agent"];
    case "human_profiles":
      return ["human"];
    case "profiles":
      return ["agent", "human"];
    default:
      assertNever(mode);
  }
}

function buildSpaceProfileAddCandidate(input: {
  activeMemberProfileIds: ReadonlySet<string>;
  actingProfileId: string | null;
  allowCurrentProfile: boolean;
  currentOwnerUserId: string | null;
  mode: SpaceProfileAddMode;
  profile: SpaceProfileAddProfile;
}): SpaceProfileAddCandidate | null {
  const profileId = normalizeText(input.profile.profileId);
  const profileName = normalizeText(input.profile.profileName);
  const profileKind = normalizeProfileKind(input.profile.profileKind);
  if (!(profileId && profileName)) {
    return null;
  }
  const alreadyJoined = input.activeMemberProfileIds.has(profileId);
  const excludedReason = resolveExcludedReason({
    actingProfileId: input.actingProfileId,
    allowCurrentProfile: input.allowCurrentProfile,
    currentOwnerUserId: input.currentOwnerUserId,
    mode: input.mode,
    profile: input.profile,
    profileId,
    profileKind,
  });

  return {
    alreadyJoined,
    excludedReason,
    profile: input.profile,
    profileId,
    profileKind,
    profileName,
    selectable: excludedReason === null && !alreadyJoined,
  };
}

function resolveExcludedReason(input: {
  actingProfileId: string | null;
  allowCurrentProfile: boolean;
  currentOwnerUserId: string | null;
  mode: SpaceProfileAddMode;
  profile: SpaceProfileAddProfile;
  profileId: string;
  profileKind: SpaceProfileAddProfileKind | null;
}): SpaceProfileAddExcludedReason | null {
  if (input.profileKind === null) {
    return "unsupported_profile_kind";
  }
  if (input.profile.status !== "active") {
    return "inactive_profile";
  }
  if (
    !input.allowCurrentProfile &&
    input.actingProfileId &&
    input.profileId === input.actingProfileId
  ) {
    return "current_acting_profile";
  }
  const ownerUserId = normalizeText(input.profile.ownerUserId);
  if (
    input.currentOwnerUserId &&
    ownerUserId &&
    ownerUserId !== input.currentOwnerUserId
  ) {
    return "different_owner";
  }
  if (
    !getSpaceProfileAddModeProfileKinds(input.mode).includes(input.profileKind)
  ) {
    return "kind_mismatch";
  }
  return null;
}

function resolveSelectedProfileIds(input: {
  eligibleCandidateById: ReadonlyMap<string, SpaceProfileAddCandidate>;
  excludedReasonById: ReadonlyMap<string, SpaceProfileAddExcludedReason>;
  selector: SpaceProfileAddSelector;
}): string[] {
  if (input.selector.kind === "none") {
    return [];
  }
  if (input.selector.kind === "all") {
    return [...input.eligibleCandidateById.values()]
      .filter((candidate) => candidate.selectable)
      .map((candidate) => candidate.profileId);
  }
  return normalizeProfileIds(input.selector.profileIds).filter((profileId) =>
    input.eligibleCandidateById.has(profileId)
  );
}

function resolveInvalidSelections(input: {
  eligibleCandidateById: ReadonlyMap<string, SpaceProfileAddCandidate>;
  excludedReasonById: ReadonlyMap<string, SpaceProfileAddExcludedReason>;
  selector: SpaceProfileAddSelector;
}): SpaceProfileAddInvalidSelection[] {
  if (input.selector.kind !== "profile_ids") {
    return [];
  }
  return normalizeProfileIds(input.selector.profileIds).flatMap((profileId) => {
    if (input.eligibleCandidateById.has(profileId)) {
      return [];
    }
    return [
      {
        profileId,
        reason: input.excludedReasonById.get(profileId) ?? "not_found",
      },
    ];
  });
}

function buildActiveMemberProfileIds(
  members: readonly SpaceProfileAddMember[]
): Set<string> {
  const profileIds = new Set<string>();
  for (const member of members) {
    if (member.status === "removed") {
      continue;
    }
    const profileId = normalizeText(member.profileId);
    if (profileId) {
      profileIds.add(profileId);
    }
  }
  return profileIds;
}

function compareSpaceProfileAddCandidates(
  left: SpaceProfileAddCandidate,
  right: SpaceProfileAddCandidate,
  mode: SpaceProfileAddMode
): number {
  if (left.alreadyJoined !== right.alreadyJoined) {
    return left.alreadyJoined ? -1 : 1;
  }
  if (
    mode === "profiles" &&
    left.profileKind !== null &&
    right.profileKind !== null &&
    left.profileKind !== right.profileKind
  ) {
    return left.profileKind === "agent" ? -1 : 1;
  }
  if (left.profile.isDefault !== right.profile.isDefault) {
    return left.profile.isDefault ? -1 : 1;
  }
  const lastUsedDelta =
    resolveDateMs(right.profile.lastUsedAt) -
    resolveDateMs(left.profile.lastUsedAt);
  if (lastUsedDelta !== 0) {
    return lastUsedDelta;
  }
  const createdDelta =
    resolveDateMs(right.profile.createdAt) -
    resolveDateMs(left.profile.createdAt);
  if (createdDelta !== 0) {
    return createdDelta;
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

function normalizeProfileIds(profileIds: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const profileId of profileIds) {
    const value = normalizeText(profileId);
    if (value) {
      normalized.add(value);
    }
  }
  return [...normalized];
}

function normalizeProfileKind(
  profileKind: string | null | undefined
): SpaceProfileAddProfileKind | null {
  return profileKind === "agent" || profileKind === "human"
    ? profileKind
    : null;
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function resolveDateMs(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function assertNever(value: never): never {
  throw new Error(`unexpected space profile add mode: ${String(value)}`);
}
