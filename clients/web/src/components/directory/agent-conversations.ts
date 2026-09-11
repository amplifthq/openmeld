import {
	isDirectMessageItem,
	resolveAccountSpaceViewerProfileId,
} from "#/components/spaces/account-space-sections";
import {
	buildOrganizationDirectMessagePath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";
import type {
	AccountSpaceItem,
	AccountSpaceSections,
} from "#/lib/spaces/account-spaces";
import type { DirectoryAgentProfileSummary } from "./directory-human-profile-model";

export type AgentConversation = {
	space: AccountSpaceItem;
	agents: readonly Pick<
		DirectoryAgentProfileSummary,
		"id" | "name" | "agentControllerRef"
	>[];
};

export function selectAgentConversations(input: {
	sections: AccountSpaceSections;
	agents: AgentConversation["agents"];
	organizationId: string;
}): AgentConversation[] {
	const agentsById = new Map(input.agents.map((agent) => [agent.id, agent]));
	const conversations = new Map<string, AgentConversation>();
	for (const space of [
		...input.sections.pinnedItems,
		...input.sections.spaceItems,
	]) {
		if (space.organizationId !== input.organizationId) {
			continue;
		}
		const agents = space.joinedProfiles.flatMap(({ profileId }) => {
			const agent = agentsById.get(profileId);
			return agent ? [agent] : [];
		});
		if (agents.length) {
			conversations.set(space.spaceId, { space, agents });
		}
	}
	return [...conversations.values()].sort(
		(left, right) =>
			(right.space.messagePreview?.timestamp ??
				Date.parse(right.space.spaceUpdatedAt ?? right.space.lastJoinedAt)) -
			(left.space.messagePreview?.timestamp ??
				Date.parse(left.space.spaceUpdatedAt ?? left.space.lastJoinedAt))
	);
}

export function agentConversationLink(input: {
	conversation: AgentConversation;
	orgSlug: string;
	humanProfileId: string;
}) {
	const item = input.conversation.space;
	const search = {
		profileId: resolveAccountSpaceViewerProfileId({
			currentProfileId: input.humanProfileId,
			item,
		}),
	};
	const to = isDirectMessageItem(item)
		? buildOrganizationDirectMessagePath({
				orgSlug: input.orgSlug,
				spaceId: item.spaceId,
			})
		: buildOrganizationSpacePath({
				orgSlug: input.orgSlug,
				spaceId: item.spaceId,
			});
	return { to, search };
}
