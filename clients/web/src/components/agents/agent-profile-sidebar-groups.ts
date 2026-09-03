import type { AgentProfileOperationalContextInput } from "@openmeld/agent-profile";
import type { AuthProfileView } from "@openmeld/schemas/types";

export type AgentProfileSidebarGroup = {
	id: string;
	label: string;
	profiles: readonly AuthProfileView[];
};

export function resolveAgentProfileSidebarGroups(input: {
	currentUserId: string;
	operationalContextByProfileId?: ReadonlyMap<
		string,
		AgentProfileOperationalContextInput
	>;
	profiles: readonly AuthProfileView[];
}): AgentProfileSidebarGroup[] {
	const groupsByOwnerId = new Map<string, AgentProfileSidebarGroup>();
	for (const profile of input.profiles) {
		const existing = groupsByOwnerId.get(profile.ownerUserId);
		if (existing) {
			groupsByOwnerId.set(profile.ownerUserId, {
				...existing,
				profiles: [...existing.profiles, profile],
			});
			continue;
		}
		const ownerName = profile.ownerName?.trim() || "Unknown member";
		groupsByOwnerId.set(profile.ownerUserId, {
			id: `agent-owner-${profile.ownerUserId}`,
			label:
				profile.ownerUserId === input.currentUserId
					? `${ownerName} (you)`
					: ownerName,
			profiles: [profile],
		});
	}

	const groups = [...groupsByOwnerId.entries()].map(
		([ownerUserId, group]) =>
			[
				ownerUserId,
				{
					...group,
					profiles: [...group.profiles].sort((left, right) =>
						compareAgentProfilesByActivity(
							left,
							right,
							input.operationalContextByProfileId
						)
					),
				},
			] as const
	);

	return groups
		.sort(([leftOwnerId, left], [rightOwnerId, right]) => {
			const leftIsCurrentUser = leftOwnerId === input.currentUserId;
			const rightIsCurrentUser = rightOwnerId === input.currentUserId;
			if (leftIsCurrentUser !== rightIsCurrentUser) {
				return leftIsCurrentUser ? -1 : 1;
			}
			const activityComparison = compareAgentProfileActivity(
				left.profiles[0],
				right.profiles[0],
				input.operationalContextByProfileId
			);
			if (activityComparison !== 0) {
				return activityComparison;
			}
			return (
				left.label.localeCompare(right.label, "en", { sensitivity: "base" }) ||
				leftOwnerId.localeCompare(rightOwnerId)
			);
		})
		.map(([, group]) => group);
}

function compareAgentProfilesByActivity(
	left: AuthProfileView | undefined,
	right: AuthProfileView | undefined,
	operationalContextByProfileId:
		| ReadonlyMap<string, AgentProfileOperationalContextInput>
		| undefined
): number {
	if (!(left && right)) {
		if (left) {
			return -1;
		}
		return right ? 1 : 0;
	}
	const activityComparison = compareAgentProfileActivity(
		left,
		right,
		operationalContextByProfileId
	);
	if (activityComparison !== 0) {
		return activityComparison;
	}
	return (
		left.profileName.localeCompare(right.profileName, "en", {
			sensitivity: "base",
		}) || left.openMeldProfileId.localeCompare(right.openMeldProfileId)
	);
}

function compareAgentProfileActivity(
	left: AuthProfileView | undefined,
	right: AuthProfileView | undefined,
	operationalContextByProfileId:
		| ReadonlyMap<string, AgentProfileOperationalContextInput>
		| undefined
): number {
	if (!(left && right)) {
		if (left) {
			return -1;
		}
		return right ? 1 : 0;
	}
	const operationalPriorityDelta =
		resolveOperationalPriority(
			operationalContextByProfileId?.get(right.openMeldProfileId)?.status
		) -
		resolveOperationalPriority(
			operationalContextByProfileId?.get(left.openMeldProfileId)?.status
		);
	if (operationalPriorityDelta !== 0) {
		return operationalPriorityDelta;
	}
	const recencyDelta =
		resolveProfileRecencyTimestamp(right) -
		resolveProfileRecencyTimestamp(left);
	if (recencyDelta !== 0) {
		return recencyDelta;
	}
	return 0;
}

function resolveOperationalPriority(
	status: AgentProfileOperationalContextInput["status"] | undefined
): number {
	if (status === "working") {
		return 2;
	}
	if (status === "paused") {
		return 1;
	}
	return 0;
}

function resolveActivityTimestamp(value: string | null): number {
	if (!value) {
		return 0;
	}
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : 0;
}

function resolveProfileRecencyTimestamp(profile: AuthProfileView): number {
	return Math.max(
		resolveActivityTimestamp(profile.createdAt),
		resolveActivityTimestamp(profile.lastUsedAt)
	);
}
