import type { QueryClient } from "@tanstack/react-query";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	readBrowserPreference,
	removeBrowserPreference,
	writeBrowserPreference,
} from "#/lib/spaces/browser-preference-storage";
import { agentDirectMessageSessionsQueryOptions } from "#/query/organizations/agent-direct-message-sessions";
import { useMemberAgentIndex } from "./use-member-agents";

// The chat a member last opened with each of their MemberAgents, so every
// entry that resolves "the Agent's chat" (the sidebar Agent row, a Profile
// row, the Agent page Chat button, a profile's Message action) reopens it
// instead of the latest one. Browser-local like the other sidebar
// preferences; a stale entry falls back to the latest chat and is cleared.

const STORAGE_PREFIX = "openmeld:member-agent-last-chat";

/** Who remembers: one Human Profile, which is one member in one org. */
export type MemberAgentLastChatScope = {
	organizationId: string;
	humanProfileId: string;
};

/** The signed-in member's scope in the current org, once known; null while
 *  MemberAgents are off. */
export function useMemberAgentLastChatScope(): MemberAgentLastChatScope | null {
	const { currentOrganization } = useAppOrganization();
	const { humanProfileId } = useMemberAgentIndex();
	return humanProfileId
		? { organizationId: currentOrganization.id, humanProfileId }
		: null;
}

/** Remembered per MemberAgent, and per Profile for Profile entries. */
export type MemberAgentLastChatTarget =
	| { memberAgentId: string }
	| { agentProfileId: string };

function storageKey(
	scope: MemberAgentLastChatScope,
	target: MemberAgentLastChatTarget
): string {
	const subject =
		"memberAgentId" in target
			? `agent:${target.memberAgentId}`
			: `profile:${target.agentProfileId}`;
	return `${STORAGE_PREFIX}:${scope.organizationId}:${scope.humanProfileId}:${subject}`;
}

export function readMemberAgentLastChat(
	scope: MemberAgentLastChatScope,
	target: MemberAgentLastChatTarget
): string | null {
	const value = readBrowserPreference(storageKey(scope, target))?.trim();
	return value ? value : null;
}

/** Records an opened chat for its MemberAgent and for its Profile. */
export function rememberMemberAgentChat(
	scope: MemberAgentLastChatScope,
	chat: { memberAgentId: string; agentProfileId: string; spaceId: string }
): void {
	writeBrowserPreference(
		storageKey(scope, { memberAgentId: chat.memberAgentId }),
		chat.spaceId
	);
	writeBrowserPreference(
		storageKey(scope, { agentProfileId: chat.agentProfileId }),
		chat.spaceId
	);
}

/** Clears an entry that still names `spaceId`; a newer choice is kept. */
export function forgetMemberAgentChat(
	scope: MemberAgentLastChatScope,
	target: MemberAgentLastChatTarget,
	spaceId: string
): void {
	if (readMemberAgentLastChat(scope, target) === spaceId) {
		removeBrowserPreference(storageKey(scope, target));
	}
}

/**
 * The remembered chat when it is still one of `available`; otherwise null.
 * With `complete`, a remembered chat missing from the list (deleted,
 * archived or no longer accessible) is cleared.
 */
export function resolveMemberAgentLastChat(input: {
	scope: MemberAgentLastChatScope | null;
	target: MemberAgentLastChatTarget;
	available: readonly string[];
	complete: boolean;
}): string | null {
	if (!input.scope) {
		return null;
	}
	const remembered = readMemberAgentLastChat(input.scope, input.target);
	if (!remembered) {
		return null;
	}
	if (input.available.includes(remembered)) {
		return remembered;
	}
	if (input.complete) {
		forgetMemberAgentChat(input.scope, input.target, remembered);
	}
	return null;
}

/**
 * The remembered chat with one agent Profile, checked against its active
 * Sessions, for entries that would otherwise open the Profile's Direct
 * Message. Null when nothing usable is remembered.
 */
export async function readRememberedProfileChat(input: {
	queryClient: QueryClient;
	scope: MemberAgentLastChatScope;
	agentProfileId: string;
}): Promise<{ spaceId: string; memberProfileId: string } | null> {
	const target = { agentProfileId: input.agentProfileId };
	if (!readMemberAgentLastChat(input.scope, target)) {
		return null;
	}
	const list = await input.queryClient.fetchQuery(
		agentDirectMessageSessionsQueryOptions({
			organizationId: input.scope.organizationId,
			agentProfileId: input.agentProfileId,
			enabled: true,
		})
	);
	const spaceId = resolveMemberAgentLastChat({
		scope: input.scope,
		target,
		available: list.sessions.map((session) => session.spaceId),
		complete: list.nextCursor === null,
	});
	return spaceId ? { spaceId, memberProfileId: list.memberProfileId } : null;
}
