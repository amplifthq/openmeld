import type { MemberAgentPresence } from "@openmeld/schemas";
import type { OrganizationAgentRuntimeOverviewResponse } from "@openmeld/schemas/types";

type RuntimeOverviewItem =
	OrganizationAgentRuntimeOverviewResponse["agentProfiles"][number];

export type MemberAgentState = "available" | "checking" | "offline" | "missing";

/**
 * The single MemberAgent presence shape every Web surface reads. State and
 * workload come from Core's derived presence read (`memberAgentPresence`,
 * with its debounce); computer names and the last activity come from the
 * owner's per-Profile runtime reads, which the presence read does not carry.
 */
export type MemberAgentPresenceView = {
	state: MemberAgentState;
	/** Null when Core cannot report a complete workload. */
	runningCount: number | null;
	queuedCount: number | null;
	/** Computers that run this MemberAgent's Profiles (owner-only names). */
	computers: readonly string[];
	lastActivityAt: string | null;
};

const STATE_BY_PRESENCE: Readonly<
	Record<MemberAgentPresence["state"], MemberAgentState>
> = {
	available: "available",
	checking: "checking",
	all_offline: "offline",
	missing: "missing",
};

export function resolveMemberAgentPresence(input: {
	presence: MemberAgentPresence | undefined;
	profileIds: readonly string[];
	runtimeByProfileId: ReadonlyMap<string, RuntimeOverviewItem>;
}): MemberAgentPresenceView {
	const items = input.profileIds
		.map((profileId) => input.runtimeByProfileId.get(profileId))
		.filter((item): item is RuntimeOverviewItem => item !== undefined);
	const workload =
		input.presence?.workload.status === "ready"
			? input.presence.workload
			: null;
	const computers = [
		...new Set(
			items
				.map((item) => item.readiness.runtimeDeviceDisplayName?.trim() ?? "")
				.filter((name) => name.length > 0)
		),
	].sort((left, right) => left.localeCompare(right, "en"));
	const lastActivityAt =
		items
			.map((item) => item.lastTaskActivityAt ?? null)
			.filter((value): value is string => value !== null)
			.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
	return {
		// Until Core answers, the Agent is being checked, never shown as broken.
		state: input.presence
			? STATE_BY_PRESENCE[input.presence.state]
			: "checking",
		runningCount: workload?.runningCount ?? null,
		queuedCount: workload?.queuedCount ?? null,
		computers,
		lastActivityAt,
	};
}

export const MEMBER_AGENT_STATE_LABELS: Readonly<
	Record<MemberAgentState, string>
> = {
	available: "Available",
	checking: "Checking",
	offline: "Offline",
	missing: "Not on any computer",
};
