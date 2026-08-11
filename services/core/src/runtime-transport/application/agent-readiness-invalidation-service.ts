export type AgentReadinessInvalidationWarning = {
  error?: unknown;
  profileId?: string;
  reasonCode: string;
  spaceId?: string;
};

export type AgentReadinessInvalidationPorts = {
  broadcastSpaceAgentReadinessInvalidated: (input: {
    agentProfileIds: readonly string[];
    reason: string;
    spaceId: string;
  }) => Promise<void>;
  listActiveSpaceIdsForProfile: (input: {
    limit: number;
    profileId: string;
  }) => Promise<readonly string[]>;
  warn?: (warning: AgentReadinessInvalidationWarning) => void;
};

const DEFAULT_PROFILE_SPACE_LIMIT = 100;

// A route-catalog change scoped to specific profiles (one binding write)
// invalidates exactly those profiles: every other profile's readiness facts
// are untouched, so re-broadcasting them only flaps UIs and burns CPU. An
// unscoped change keeps the historical whole-owner fan-out, and the periodic
// route reconciliation remains the fail-closed backstop for any gap a scoped
// caller might miss.
export function resolveRouteCatalogChangedInvalidationProfileIds(input: {
  scopedProfileIds: readonly string[];
  sessionProfileIds: readonly string[];
}): readonly string[] {
  return input.scopedProfileIds.length > 0
    ? input.scopedProfileIds
    : input.sessionProfileIds;
}

export async function publishAgentReadinessInvalidationToSpaces(input: {
  ports: AgentReadinessInvalidationPorts;
  profileIds: readonly string[];
  profileSpaceLimit?: number;
  reason: string;
}): Promise<void> {
  const profileIds = normalizeProfileIds(input.profileIds);
  const reason = normalizeText(input.reason);
  if (profileIds.length === 0 || !reason) {
    return;
  }

  const profileSpaceLimit =
    input.profileSpaceLimit ?? DEFAULT_PROFILE_SPACE_LIMIT;
  const profileIdsBySpaceId = new Map<string, Set<string>>();

  await Promise.all(
    profileIds.map(async (profileId) => {
      let spaceIds: readonly string[];
      try {
        spaceIds = await input.ports.listActiveSpaceIdsForProfile({
          limit: profileSpaceLimit,
          profileId,
        });
      } catch (error) {
        input.ports.warn?.({
          error,
          profileId,
          reasonCode: "agent.readiness.invalidation.space_index_lookup_failed",
        });
        return;
      }

      for (const spaceId of normalizeProfileIds(spaceIds)) {
        const existing = profileIdsBySpaceId.get(spaceId) ?? new Set<string>();
        existing.add(profileId);
        profileIdsBySpaceId.set(spaceId, existing);
      }
    })
  );

  await Promise.all(
    [...profileIdsBySpaceId.entries()].map(
      async ([spaceId, agentProfileIds]) => {
        try {
          await input.ports.broadcastSpaceAgentReadinessInvalidated({
            agentProfileIds: [...agentProfileIds],
            reason,
            spaceId,
          });
        } catch (error) {
          input.ports.warn?.({
            error,
            reasonCode: "agent.readiness.invalidation.space_broadcast_failed",
            spaceId,
          });
        }
      }
    )
  );
}

function normalizeProfileIds(values: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const value of values) {
    const text = normalizeText(value);
    if (text) {
      normalized.add(text);
    }
  }
  return [...normalized];
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}
