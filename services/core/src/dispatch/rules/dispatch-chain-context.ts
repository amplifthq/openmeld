type DispatchChainContext = {
  dispatchChainId: string;
  autoRelayDepth: number;
  visitedProfileIds: string[];
  visitedProfileIdsHash: string;
};

export const createDispatchChainContext = (input: {
  dispatchId: string;
}): DispatchChainContext => {
  const visitedProfileIds: string[] = [];
  return {
    dispatchChainId: input.dispatchId,
    autoRelayDepth: 0,
    visitedProfileIds,
    visitedProfileIdsHash: buildVisitedProfileIdsHash(visitedProfileIds),
  };
};

export const createNextDispatchChainContext = (input: {
  dispatchChainId: string;
  autoRelayDepth: number;
  sourceVisitedProfileIds?: string[];
  senderProfileId: string;
}): DispatchChainContext => {
  const visitedProfileIds = normalizeVisitedProfileIds([
    ...(input.sourceVisitedProfileIds ?? []),
    input.senderProfileId,
  ]);
  return {
    dispatchChainId: input.dispatchChainId,
    autoRelayDepth: Math.max(0, Math.trunc(input.autoRelayDepth)) + 1,
    visitedProfileIds,
    visitedProfileIdsHash: buildVisitedProfileIdsHash(visitedProfileIds),
  };
};

export const normalizeVisitedProfileIds = (
  profileIds: string[] | undefined
): string[] => {
  if (!profileIds) {
    return [];
  }
  const normalized: string[] = [];
  for (const profileId of profileIds) {
    const trimmed = profileId.trim();
    if (trimmed.length === 0 || normalized.includes(trimmed)) {
      continue;
    }
    normalized.push(trimmed);
  }
  return normalized;
};

export const buildVisitedProfileIdsHash = (profileIds: string[]): string => {
  const normalized = profileIds
    .map((profileId) => profileId.trim())
    .filter((profileId) => profileId.length > 0)
    .sort()
    .join("|");
  return `stable32:${toStableHexHash(normalized)}`;
};

const toStableHexHash = (input: string): string => {
  const HASH_BASE = 131;
  const HASH_MOD = 1_000_000_007;
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * HASH_BASE + input.charCodeAt(index)) % HASH_MOD;
  }
  return hash.toString(16).padStart(8, "0");
};
