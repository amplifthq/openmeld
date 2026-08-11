import type {
	PostSpaceMembersResponse,
	SpaceMemberAgentSnapshot,
	SpaceMemberHumanSnapshot,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import type { QueryClient } from "@tanstack/react-query";
import type { SpaceBootstrapSnapshot } from "#/query/spaces/bootstrap";
import { mergeSpaceHistorySnapshots } from "#/query/spaces/history";
import { spaceQueryKeys } from "#/query/spaces/status";

type SpaceMemberSnapshotItem =
	| SpaceMemberHumanSnapshot
	| SpaceMemberAgentSnapshot;

type MergeSpaceMembersSnapshotOptions = {
	/**
	 * Newly created, locally bound Agent Profiles may briefly arrive from the
	 * add-members response before Core's Wake-readiness projection has caught
	 * up. During that window, show a transient checking state instead of a stale
	 * negative readiness verdict from the mutation response.
	 */
	pendingWakeReadinessProfileIds?: readonly string[];
};

export function applySpaceMembersResponseToCache(input: {
	pendingWakeReadinessProfileIds?: readonly string[];
	queryClient: QueryClient;
	response: PostSpaceMembersResponse;
	spaceId: string;
	viewerProfileId: string;
}): void {
	if (input.response.items.length === 0) {
		return;
	}

	const patchSnapshot = (
		current: SpaceMembersSnapshot | undefined
	): SpaceMembersSnapshot | undefined =>
		current
			? mergeSpaceMembersSnapshot(current, input.response.items, {
					pendingWakeReadinessProfileIds: input.pendingWakeReadinessProfileIds,
				})
			: current;

	input.queryClient.setQueryData<SpaceMembersSnapshot>(
		spaceQueryKeys.members(input.spaceId, input.viewerProfileId),
		patchSnapshot
	);
	input.queryClient.setQueryData<SpaceBootstrapSnapshot>(
		spaceQueryKeys.bootstrap(input.spaceId, input.viewerProfileId),
		(current) =>
			current
				? {
						...current,
						members: mergeSpaceMembersSnapshot(
							current.members,
							input.response.items,
							{
								pendingWakeReadinessProfileIds:
									input.pendingWakeReadinessProfileIds,
							}
						),
					}
				: current
	);
}

export function applySpaceBootstrapSnapshotToCache(input: {
	bootstrap: SpaceBootstrapSnapshot;
	queryClient: QueryClient;
	spaceId: string;
	viewerProfileId: string;
}): void {
	input.queryClient.setQueryData(
		spaceQueryKeys.status(input.spaceId, input.viewerProfileId),
		input.bootstrap.status
	);
	input.queryClient.setQueryData<SpaceMembersSnapshot>(
		spaceQueryKeys.members(input.spaceId, input.viewerProfileId),
		(current) =>
			current
				? mergeSpaceMembersSnapshot(
						current,
						listSpaceMemberSnapshotItems(input.bootstrap.members)
					)
				: input.bootstrap.members
	);
	input.queryClient.setQueryData<SpaceBootstrapSnapshot["history"]>(
		spaceQueryKeys.history(input.spaceId, input.viewerProfileId),
		(current) =>
			mergeSpaceHistorySnapshots({
				current,
				incoming: input.bootstrap.history,
			})
	);
	input.queryClient.setQueryData(
		spaceQueryKeys.threads(input.spaceId, input.viewerProfileId),
		input.bootstrap.threads
	);
}

export function applySpaceMemberRemovalToCache(input: {
	memberProfileIds: readonly string[];
	queryClient: QueryClient;
	spaceId: string;
	viewerProfileId: string;
}): void {
	const memberProfileIds = normalizeSpaceMemberProfileIds(
		input.memberProfileIds
	);
	if (memberProfileIds.size === 0) {
		return;
	}

	input.queryClient.setQueryData<SpaceMembersSnapshot>(
		spaceQueryKeys.members(input.spaceId, input.viewerProfileId),
		(current) =>
			current
				? removeSpaceMembersFromSnapshot(current, memberProfileIds)
				: current
	);
	input.queryClient.setQueryData<SpaceBootstrapSnapshot>(
		spaceQueryKeys.bootstrap(input.spaceId, input.viewerProfileId),
		(current) =>
			current
				? {
						...current,
						members: removeSpaceMembersFromSnapshot(
							current.members,
							memberProfileIds
						),
					}
				: current
	);
}

export function mergeSpaceMembersSnapshot(
	current: SpaceMembersSnapshot,
	incomingItems: readonly SpaceMemberSnapshotItem[],
	options: MergeSpaceMembersSnapshotOptions = {}
): SpaceMembersSnapshot {
	const existingByProfileId = new Map<string, SpaceMemberSnapshotItem>();
	for (const member of [...current.humans, ...current.agents]) {
		existingByProfileId.set(member.profileId, member);
	}
	const pendingWakeReadinessProfileIds = new Set(
		(options.pendingWakeReadinessProfileIds ?? [])
			.map((profileId) => profileId.trim())
			.filter((profileId) => profileId.length > 0)
	);

	const nextHumans = current.humans.filter(
		(member) =>
			!incomingItems.some((incoming) => incoming.profileId === member.profileId)
	);
	const nextAgents = current.agents.filter(
		(member) =>
			!incomingItems.some((incoming) => incoming.profileId === member.profileId)
	);

	for (const incoming of incomingItems) {
		const existing = existingByProfileId.get(incoming.profileId);
		const merged = mergeSpaceMemberSnapshotItem({
			existing,
			incoming,
			pendingWakeReadiness:
				pendingWakeReadinessProfileIds.has(incoming.profileId) &&
				existing === undefined,
		});
		if (merged.profileKind === "human") {
			nextHumans.push(merged);
		} else {
			nextAgents.push(merged);
		}
	}

	return {
		...current,
		humans: nextHumans,
		agents: nextAgents,
		summary: buildSpaceMembersSummary({
			agents: nextAgents,
			humans: nextHumans,
		}),
	};
}

function removeSpaceMembersFromSnapshot(
	current: SpaceMembersSnapshot,
	memberProfileIds: ReadonlySet<string>
): SpaceMembersSnapshot {
	const humans = current.humans.filter(
		(member) => !memberProfileIds.has(member.profileId)
	);
	const agents = current.agents.filter(
		(member) => !memberProfileIds.has(member.profileId)
	);
	return {
		...current,
		humans,
		agents,
		summary: buildSpaceMembersSummary({ agents, humans }),
	};
}

function normalizeSpaceMemberProfileIds(
	memberProfileIds: readonly string[]
): ReadonlySet<string> {
	return new Set(
		memberProfileIds
			.map((profileId) => profileId.trim())
			.filter((profileId) => profileId.length > 0)
	);
}

function mergeSpaceMemberSnapshotItem(input: {
	existing: SpaceMemberSnapshotItem | undefined;
	incoming: SpaceMemberSnapshotItem;
	pendingWakeReadiness: boolean;
}): SpaceMemberSnapshotItem {
	if (
		input.existing?.profileKind === "agent" &&
		input.incoming.profileKind === "agent"
	) {
		return {
			...input.existing,
			...input.incoming,
			agentWakeAvailability:
				input.incoming.agentWakeAvailability ??
				input.existing.agentWakeAvailability,
			ownerWakeDiagnostics:
				input.incoming.ownerWakeDiagnostics ??
				input.existing.ownerWakeDiagnostics,
			...mergeExistingAgentDisplayFactsWhenIncomingLacksReadiness({
				existing: input.existing,
				incoming: input.incoming,
			}),
		};
	}

	if (
		input.pendingWakeReadiness &&
		input.incoming.profileKind === "agent" &&
		hasLocalAgentControllerBinding(input.incoming) &&
		input.incoming.agentWakeAvailability?.status !== "available_for_wake"
	) {
		return {
			...input.incoming,
			agentWakeAvailability: createPendingWakeReadinessAvailability(),
		};
	}

	return input.incoming;
}

function mergeExistingAgentDisplayFactsWhenIncomingLacksReadiness(input: {
	existing: SpaceMemberAgentSnapshot;
	incoming: SpaceMemberAgentSnapshot;
}): Partial<SpaceMemberAgentSnapshot> {
	if (input.incoming.agentWakeAvailability !== undefined) {
		return {};
	}

	return {
		agentControllerConversationId:
			input.incoming.agentControllerConversationId ??
			input.existing.agentControllerConversationId,
		agentControllerPermissionMode:
			input.incoming.agentControllerPermissionMode ??
			input.existing.agentControllerPermissionMode,
		agentControllerRef:
			input.incoming.agentControllerRef ?? input.existing.agentControllerRef,
		lastSeenAt: input.incoming.lastSeenAt ?? input.existing.lastSeenAt,
		lastSeenLabel: input.incoming.lastSeenLabel ?? input.existing.lastSeenLabel,
		modelSelection:
			input.incoming.modelSelection ?? input.existing.modelSelection,
		runtimeDeviceDisplayName:
			input.incoming.runtimeDeviceDisplayName ??
			input.existing.runtimeDeviceDisplayName,
		workingDirectory:
			input.incoming.workingDirectory ?? input.existing.workingDirectory,
	};
}

function hasLocalAgentControllerBinding(
	agent: SpaceMemberAgentSnapshot
): boolean {
	return (
		typeof agent.agentControllerRef === "string" &&
		agent.agentControllerRef.trim().length > 0
	);
}

function createPendingWakeReadinessAvailability(): SpaceMemberAgentSnapshot["agentWakeAvailability"] {
	return {
		action: "check_status",
		badgeLabel: "Checking",
		category: "checking",
		isRefreshing: true,
		label: "Checking connection",
		phase: "checking_status",
		reasonCode: "agent_execution.check_status",
		status: "checking_connection",
		summary: "OpenMeld is checking this agent's local connection.",
		tooltip: "Checking Wake availability",
	};
}

function listSpaceMemberSnapshotItems(
	snapshot: SpaceMembersSnapshot
): SpaceMemberSnapshotItem[] {
	return [...snapshot.humans, ...snapshot.agents];
}

function buildSpaceMembersSummary(input: {
	agents: readonly SpaceMemberAgentSnapshot[];
	humans: readonly SpaceMemberHumanSnapshot[];
}): SpaceMembersSnapshot["summary"] {
	return {
		totalCount: input.humans.length + input.agents.length,
		humanCount: input.humans.length,
		agentCount: input.agents.length,
		liveNowCount: [...input.humans, ...input.agents].filter(
			(member) => member.liveNow
		).length,
		wakeableAgentCount: input.agents.filter(
			(agent) => agent.agentWakeAvailability?.status === "available_for_wake"
		).length,
		checkingAgentCount: input.agents.filter(
			(agent) => agent.agentWakeAvailability?.status === "checking_connection"
		).length,
		offlineAgentCount: input.agents.filter(
			(agent) => agent.agentWakeAvailability?.status === "offline_for_wake"
		).length,
		unavailableAgentCount: input.agents.filter(
			(agent) => agent.agentWakeAvailability?.status === "unavailable_for_wake"
		).length,
	};
}
