import type { AuthProfileView } from "@openmeld/schemas/types";

export type AgentProfileSidebarGroup = {
	id: string;
	label: string;
	profiles: readonly AuthProfileView[];
};

export function resolveAgentProfileSidebarGroups(input: {
	currentUserId: string;
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

	return [...groupsByOwnerId.entries()]
		.sort(([leftOwnerId, left], [rightOwnerId, right]) => {
			const leftIsCurrentUser = leftOwnerId === input.currentUserId;
			const rightIsCurrentUser = rightOwnerId === input.currentUserId;
			if (leftIsCurrentUser !== rightIsCurrentUser) {
				return leftIsCurrentUser ? -1 : 1;
			}
			return (
				left.label.localeCompare(right.label, "en", { sensitivity: "base" }) ||
				leftOwnerId.localeCompare(rightOwnerId)
			);
		})
		.map(([, group]) => group);
}
