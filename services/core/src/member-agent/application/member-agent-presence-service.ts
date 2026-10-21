import type {
  ListMemberAgentsResponse,
  MemberAgentPresence,
  MemberAgentPresenceState,
} from "@openmeld/schemas";
import type { RuntimeTransportAgentProfileOperationalContext } from "@openmeld/schemas/types";
import type { RuntimeHarness } from "./runtime-harness-catalog";

type WakeAvailabilityCategory =
  MemberAgentPresence["profiles"][number]["wakeAvailability"];

export type MemberAgentPresenceDeps = {
  listOwnerMemberAgents: () => Promise<ListMemberAgentsResponse>;
  listRuntimeHarnesses: () => Promise<readonly RuntimeHarness[]>;
  // Online computers keyed by `${deviceId}\u0000${lane}`. A failed lookup
  // throws: it is no verdict, so the whole read fails instead of answering
  // Checking (developing/product/agent-profiles.md, MemberAgent presence).
  readOnlineRuntimeKeys: () => Promise<ReadonlySet<string>>;
  // The existing per-Profile workload read; a missing entry is unknown.
  readOperationalContexts: (
    agentProfileIds: readonly string[]
  ) => Promise<
    ReadonlyMap<string, RuntimeTransportAgentProfileOperationalContext>
  >;
  // The existing four-state Wakeability per Profile; a Profile the answer
  // leaves out reads as checking, and a failed read throws.
  readWakeAvailability: (
    agentProfileIds: readonly string[]
  ) => Promise<ReadonlyMap<string, WakeAvailabilityCategory>>;
};

export function buildOnlineRuntimeKey(input: {
  deviceId: string;
  lane: string;
}): string {
  return `${input.deviceId}\u0000${input.lane}`;
}

/**
 * Derive each MemberAgent's presence at read time
 * (design-plans/member-agent-program.md §4.1). Nothing is stored: the
 * computers come from the debounced Harness catalog, availability from the
 * Profiles' existing Wakeability, and counts from their existing workload.
 */
export async function readMemberAgentPresence(
  deps: MemberAgentPresenceDeps
): Promise<MemberAgentPresence[]> {
  const listing = await deps.listOwnerMemberAgents();
  if (listing.memberAgents.length === 0) {
    return [];
  }
  const profileIds = listing.memberAgents.flatMap((memberAgent) =>
    memberAgent.profiles.map((profile) => profile.openMeldProfileId)
  );
  const [harnesses, onlineKeys, wakeAvailability, operationalContexts] =
    await Promise.all([
      deps.listRuntimeHarnesses(),
      deps.readOnlineRuntimeKeys(),
      profileIds.length > 0
        ? deps.readWakeAvailability(profileIds)
        : new Map<string, WakeAvailabilityCategory>(),
      profileIds.length > 0
        ? deps.readOperationalContexts(profileIds)
        : new Map<string, RuntimeTransportAgentProfileOperationalContext>(),
    ]);

  return listing.memberAgents.map((memberAgent) => {
    const computers =
      memberAgent.harnessKind === "hosted"
        ? []
        : harnesses
            .filter(
              (harness) =>
                harness.harnessKind === memberAgent.harnessKind &&
                harness.present
            )
            .map((harness) => ({
              openMeldServiceRuntimeId: harness.openMeldServiceRuntimeId,
              online: onlineKeys.has(buildOnlineRuntimeKey(harness)),
            }));
    const profiles = memberAgent.profiles.map((profile) => ({
      openMeldProfileId: profile.openMeldProfileId,
      wakeAvailability:
        wakeAvailability.get(profile.openMeldProfileId) ?? "checking",
    }));
    return {
      memberAgentId: memberAgent.id,
      harnessKind: memberAgent.harnessKind,
      state: resolveMemberAgentPresenceState({
        computers,
        hosted: memberAgent.harnessKind === "hosted",
        profiles,
      }),
      computers,
      profiles,
      workload: aggregateWorkload(
        memberAgent.profiles.map((profile) =>
          operationalContexts.get(profile.openMeldProfileId)
        )
      ),
    };
  });
}

export function resolveMemberAgentPresenceState(input: {
  computers: readonly { online: boolean }[];
  hosted: boolean;
  profiles: readonly { wakeAvailability: WakeAvailabilityCategory }[];
}): MemberAgentPresenceState {
  if (!input.hosted) {
    if (input.computers.length === 0) {
      return "missing";
    }
    if (!input.computers.some((computer) => computer.online)) {
      return "all_offline";
    }
  }
  return input.profiles.some(
    (profile) => profile.wakeAvailability === "available"
  )
    ? "available"
    : "checking";
}

function aggregateWorkload(
  contexts: readonly (
    | RuntimeTransportAgentProfileOperationalContext
    | undefined
  )[]
): MemberAgentPresence["workload"] {
  let runningCount = 0;
  let queuedCount = 0;
  for (const context of contexts) {
    if (!context || context.status === "checking") {
      return { status: "unavailable" };
    }
    if (context.status === "working") {
      runningCount += 1;
    }
    if (context.status === "working" || context.status === "paused") {
      queuedCount += context.waitingCount;
    }
  }
  return { status: "ready", runningCount, queuedCount };
}
