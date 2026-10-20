import type {
	OrganizationProfileDirectoryResponse,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { useQuery } from "@tanstack/react-query";
import { useAgentViewerAccess } from "#/lib/agents/agent-viewer-access";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { organizationProfileIdentityDirectoryQueryOptions } from "#/query/organizations/organization-directory";

export type DirectMessageConsentEmptyState = {
	title: string;
	description: string;
};

/** The empty Direct Message with a colleague's Agent that asks its owner first. */
export function directMessageConsentEmptyState(input: {
	agentName: string;
	ownerName: string;
}): DirectMessageConsentEmptyState {
	const { agentName: agent, ownerName: owner } = input;
	return {
		title: `Ask ${owner} to use ${agent}`,
		description: `Your first message goes to ${owner} for approval. ${agent} starts once ${owner} allows it.`,
	};
}

/** The colleague's Agent in a Direct Message, when the viewer does not own it. */
export function resolveColleagueDirectMessageAgent(input: {
	snapshot: SpaceMembersSnapshot | null;
	viewerUserId: string | null;
}) {
	if (!(input.snapshot && input.viewerUserId)) {
		return null;
	}
	return (
		input.snapshot.agents.find(
			(agent) =>
				agent.status === "active" &&
				Boolean(agent.ownerUserId) &&
				agent.ownerUserId !== input.viewerUserId
		) ?? null
	);
}

/** Owners are named by their default Human Profile, like Direct Message titles. */
export function resolveAgentOwnerName(input: {
	directory: OrganizationProfileDirectoryResponse | undefined;
	agentProfileId: string;
	ownerUserId: string;
}): string | null {
	const owner = input.directory?.members.find(
		(member) => member.userId === input.ownerUserId
	);
	const agent = input.directory?.agentProfiles.find(
		(profile) => profile.profileId === input.agentProfileId
	);
	return (
		owner?.humanProfile?.profileName ??
		owner?.user.name ??
		agent?.ownerName ??
		null
	);
}

/**
 * Null unless this is a Direct Message with a colleague's Agent the viewer
 * may not use yet, so its first message waits for the owner's approval.
 */
export function useDirectMessageConsentEmptyState(input: {
	isDirectMessage: boolean;
	isCenterAgentDirectMessage: boolean;
	snapshot: SpaceMembersSnapshot | null;
}): DirectMessageConsentEmptyState | null {
	const organization = useOptionalAppOrganization();
	const viewerUserId = organization?.currentUserId ?? null;
	const agent =
		input.isDirectMessage && !input.isCenterAgentDirectMessage
			? resolveColleagueDirectMessageAgent({
					snapshot: input.snapshot,
					viewerUserId,
				})
			: null;
	const directory = useQuery(
		organizationProfileIdentityDirectoryQueryOptions({
			enabled: Boolean(agent && organization && isMemberAgentsEnabled()),
			organizationId: organization?.currentOrganization.id ?? "",
		})
	);
	const ownerName =
		agent?.ownerUserId && directory.data
			? resolveAgentOwnerName({
					directory: directory.data,
					agentProfileId: agent.profileId,
					ownerUserId: agent.ownerUserId,
				})
			: null;
	const access = useAgentViewerAccess({
		profileId: agent?.profileId ?? "",
		ownerUserId: agent ? agent.ownerUserId : null,
		ownerName,
	});
	if (!(agent && ownerName && isMemberAgentsEnabled())) {
		return null;
	}
	return access?.kind === "asks_owner"
		? directMessageConsentEmptyState({
				agentName: agent.profileName,
				ownerName,
			})
		: null;
}
