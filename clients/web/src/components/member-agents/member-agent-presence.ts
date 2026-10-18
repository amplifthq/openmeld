import type { OrganizationAgentRuntimeOverviewResponse } from "@openmeld/schemas/types";

type RuntimeOverviewItem =
	OrganizationAgentRuntimeOverviewResponse["agentProfiles"][number];

export type MemberAgentState =
	| "available"
	| "checking"
	| "offline"
	| "unavailable";

/**
 * The single MemberAgent presence shape every Web surface reads. Today it is
 * aggregated client-side from the existing per-Profile readiness and workload
 * reads. Package 1c moves this to a Core presence read with debounce; only
 * `aggregateMemberAgentPresence`'s input changes then, not this output.
 */
export type MemberAgentPresence = {
	state: MemberAgentState;
	runningCount: number;
	queuedCount: number;
	/** Computers that run this MemberAgent's Profiles (owner-only names). */
	computers: readonly string[];
	lastActivityAt: string | null;
};

const STATE_PRIORITY: readonly MemberAgentState[] = [
	"available",
	"checking",
	"unavailable",
	"offline",
];

export function aggregateMemberAgentPresence(input: {
	profileIds: readonly string[];
	runtimeByProfileId: ReadonlyMap<string, RuntimeOverviewItem>;
}): MemberAgentPresence {
	const items = input.profileIds
		.map((profileId) => input.runtimeByProfileId.get(profileId))
		.filter((item): item is RuntimeOverviewItem => item !== undefined);
	const states = new Set<MemberAgentState>(
		items.map(
			(item) => item.readiness.agentWakeAvailability?.category ?? "checking"
		)
	);
	// An Agent with any reachable Profile is available; with no Profiles read
	// yet it is still being checked, never presented as broken.
	const state =
		items.length === 0
			? "checking"
			: (STATE_PRIORITY.find((candidate) => states.has(candidate)) ??
				"checking");
	let runningCount = 0;
	let queuedCount = 0;
	for (const item of items) {
		const counts = readWorkloadCounts(item);
		runningCount += counts.running;
		queuedCount += counts.queued;
	}
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
	return { state, runningCount, queuedCount, computers, lastActivityAt };
}

function readWorkloadCounts(item: RuntimeOverviewItem): {
	running: number;
	queued: number;
} {
	if (item.workload?.status === "ready") {
		return {
			running: item.workload.activeCount,
			queued: item.workload.waitingCount + item.workload.queuedMessageCount,
		};
	}
	const context = item.operationalContext;
	if (context?.status === "working") {
		return { running: 1, queued: context.waitingCount };
	}
	if (context?.status === "paused") {
		return { running: 0, queued: context.waitingCount };
	}
	return { running: 0, queued: 0 };
}

export const MEMBER_AGENT_STATE_LABELS: Readonly<
	Record<MemberAgentState, string>
> = {
	available: "Available",
	checking: "Checking",
	offline: "Offline",
	unavailable: "Needs attention",
};
