import type { AgentAccessRequestView } from "@openmeld/schemas";
import type { OrganizationProfileDirectoryResponse } from "@openmeld/schemas/types";
import { useQuery } from "@tanstack/react-query";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import {
	useAgentAccessRequests,
	useViewerAgentAccessGrants,
} from "#/query/agent-access";
import { agentDirectMessageSessionsQueryOptions } from "#/query/organizations/agent-direct-message-sessions";
import { organizationProfileIdentityDirectoryQueryOptions } from "#/query/organizations/organization-directory";

/**
 * Where the viewer stands with a teammate's Agent whose owner answers first
 * (member-agent-program.md §7). In a Direct Message the first message is the
 * request:
 * - `not_required`: the viewer owns the Agent, or no person owns it.
 * - `none`: no Direct Message with the Agent yet.
 * - `draft`: a Direct Message exists and no request was sent from it.
 * - `waiting`: the request waits for the owner.
 * - `approved_once`: the owner allowed one chat: the request's own Direct
 *   Message, never another one.
 * - `always_allowed`: the owner always lets the viewer use the Agent.
 * - `declined`: the owner declined the latest request.
 * - `revoked`: the owner allowed the latest request, then took that access
 *   back.
 *
 * The owner's decision is history; the grant it wrote is the current fact.
 * An active standing grant wins over any request.
 */
export type ColleagueAccessState =
	| "not_required"
	| "none"
	| "draft"
	| "waiting"
	| "approved_once"
	| "always_allowed"
	| "declined"
	| "revoked";

export type ColleagueAccess = {
	state: ColleagueAccessState;
	/** The latest Direct Message request, when one decides the state. */
	request: AgentAccessRequestView | null;
	/** The owner's display name; null for `not_required` or before it loads. */
	ownerName: string | null;
};

/**
 * Pure derivation. Pass `spaceId` to scope the state to one Direct Message
 * (it exists, so the floor is `draft`); omit it for the Agent as a whole,
 * where `directMessageCount` decides `none` or `draft`.
 */
export function resolveColleagueAccessState(input: {
	viewerUserId: string;
	ownerUserId: string | null | undefined;
	profileId: string;
	standingGrantProfileIds: readonly string[];
	requests: readonly AgentAccessRequestView[];
	spaceId?: string | null;
	directMessageCount?: number;
}): Pick<ColleagueAccess, "state" | "request"> {
	if (!input.ownerUserId || input.ownerUserId === input.viewerUserId) {
		return { state: "not_required", request: null };
	}
	if (input.standingGrantProfileIds.includes(input.profileId)) {
		return { state: "always_allowed", request: null };
	}
	const request = latestDirectMessageRequest(input);
	const state = request ? resolveRequestState(request) : null;
	if (request && state) {
		return { state, request };
	}
	// Withdrawn, voided, or no request: back to an unsent Direct Message.
	const hasDirectMessage =
		Boolean(input.spaceId) || (input.directMessageCount ?? 0) > 0;
	return { state: hasDirectMessage ? "draft" : "none", request: null };
}

function resolveRequestState(
	request: AgentAccessRequestView
): Exclude<ColleagueAccessState, "not_required" | "none" | "draft"> | null {
	switch (request.status) {
		case "pending":
			return "waiting";
		case "declined":
			return "declined";
		case "allowed":
			break;
		default:
			return null;
	}
	// An allowed request without its grant is not access.
	if (request.grant?.status !== "active") {
		return "revoked";
	}
	return request.decision === "always_allow"
		? "always_allowed"
		: "approved_once";
}

function latestDirectMessageRequest(input: {
	profileId: string;
	requests: readonly AgentAccessRequestView[];
	spaceId?: string | null;
}): AgentAccessRequestView | null {
	let latest: AgentAccessRequestView | null = null;
	for (const request of input.requests) {
		if (
			request.viewerRole === "requester" &&
			request.kind === "direct_message" &&
			request.agentProfileId === input.profileId &&
			(!input.spaceId || request.spaceId === input.spaceId) &&
			(!latest || latest.createdAt < request.createdAt)
		) {
			latest = request;
		}
	}
	return latest;
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
 * The viewer's state with a teammate's Agent, from their standing grants,
 * their requests as requester, and their Direct Messages with the Agent.
 * Null while any of these load, or when member Agents are off.
 */
export function useColleagueAccessState(input: {
	profileId: string | null | undefined;
	ownerUserId: string | null | undefined;
	/** Scopes the state to this Direct Message. */
	spaceId?: string | null;
}): ColleagueAccess | null {
	const organization = useOptionalAppOrganization();
	const organizationId = organization?.currentOrganization.id ?? "";
	const viewerUserId = organization?.currentUserId ?? null;
	const profileId = input.profileId ?? "";
	const asksOwner =
		isMemberAgentsEnabled() &&
		Boolean(profileId && viewerUserId && organizationId) &&
		Boolean(input.ownerUserId) &&
		input.ownerUserId !== viewerUserId;
	const grants = useViewerAgentAccessGrants();
	const requests = useAgentAccessRequests(
		{ role: "requester" },
		{ enabled: asksOwner }
	);
	const sessions = useQuery(
		agentDirectMessageSessionsQueryOptions({
			organizationId,
			agentProfileId: profileId,
			enabled: asksOwner && !input.spaceId,
		})
	);
	const directory = useQuery(
		organizationProfileIdentityDirectoryQueryOptions({
			enabled: asksOwner,
			organizationId,
		})
	);
	if (!(isMemberAgentsEnabled() && profileId && viewerUserId)) {
		return null;
	}
	if (!asksOwner) {
		return { state: "not_required", request: null, ownerName: null };
	}
	if (!(grants.data && requests.data && (input.spaceId || sessions.data))) {
		return null;
	}
	const resolved = resolveColleagueAccessState({
		viewerUserId,
		ownerUserId: input.ownerUserId,
		profileId,
		standingGrantProfileIds: grants.data,
		requests: requests.data,
		spaceId: input.spaceId,
		directMessageCount: sessions.data?.sessions.length ?? 0,
	});
	return {
		...resolved,
		ownerName:
			(input.ownerUserId &&
				resolveAgentOwnerName({
					directory: directory.data,
					agentProfileId: profileId,
					ownerUserId: input.ownerUserId,
				})) ||
			resolved.request?.ownerName ||
			null,
	};
}
