import type { Conversation } from "#/components/spaces/conversation-sidebar-model";
import type { MemberAgentIndex } from "./member-agent-index";

/**
 * Collapses the signed-in member's Direct Message Sessions with any Profile
 * of one MemberAgent into a single sidebar row named after the MemberAgent.
 * The row opens the selected Session when it belongs to the MemberAgent and
 * the most recent one otherwise; the header dropdown lists the rest. Spaces,
 * Human DMs, colleagues' Agents, and Center Agent chats are unchanged.
 */
export function groupMemberAgentConversations(input: {
	conversations: readonly Conversation[];
	index: MemberAgentIndex;
	selectedSpaceId: string | null | undefined;
}): Conversation[] {
	const groups = new Map<string, Conversation[]>();
	const result: (Conversation | { memberAgentId: string })[] = [];
	for (const conversation of input.conversations) {
		const memberAgentId = resolveConversationMemberAgentId(
			conversation,
			input.index
		);
		if (!memberAgentId) {
			result.push(conversation);
			continue;
		}
		const group = groups.get(memberAgentId);
		if (group) {
			group.push(conversation);
		} else {
			groups.set(memberAgentId, [conversation]);
			result.push({ memberAgentId });
		}
	}
	return result.map((entry) => {
		if (!("memberAgentId" in entry)) {
			return entry;
		}
		const sessions = groups.get(entry.memberAgentId) ?? [];
		const representative =
			sessions.find((session) => session.spaceId === input.selectedSpaceId) ??
			[...sessions].sort((left, right) => right.activity - left.activity)[0];
		if (!representative) {
			throw new Error("A MemberAgent row needs at least one Session.");
		}
		return {
			...representative,
			title:
				input.index.byId.get(entry.memberAgentId)?.displayName ??
				representative.title,
			activity: Math.max(...sessions.map((session) => session.activity)),
		};
	});
}

export function resolveConversationMemberAgentId(
	conversation: Conversation,
	index: MemberAgentIndex
): string | null {
	if (conversation.kind !== "direct-message" || conversation.chat.session) {
		return null;
	}
	const peerProfileId = conversation.chat.peer?.profileId;
	if (!peerProfileId || conversation.chat.peer?.profileKind !== "agent") {
		return null;
	}
	return index.byProfileId.get(peerProfileId)?.memberAgentId ?? null;
}
