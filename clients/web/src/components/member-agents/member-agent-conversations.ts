import type { Conversation } from "#/components/spaces/conversation-sidebar-model";
import type { MemberAgentIndex } from "./member-agent-index";

/**
 * Collapses the signed-in member's Direct Message Sessions with any Profile
 * of one MemberAgent into a single sidebar row named after the MemberAgent.
 * The row opens the selected Session when it belongs to the MemberAgent,
 * else the one the member last opened, else the most recent one; the header
 * dropdown lists the rest. Spaces,
 * Human DMs, colleagues' Agents, and Center Agent chats are unchanged.
 */
export function groupMemberAgentConversations(input: {
	conversations: readonly Conversation[];
	index: MemberAgentIndex;
	selectedSpaceId: string | null | undefined;
	/** Archived Sessions leave the row; the header dropdown lists them. */
	archivedSpaceIds?: ReadonlySet<string>;
	/** The member's last-opened Session of a MemberAgent, if remembered. */
	lastChatOf?: (memberAgentId: string) => string | null;
}): Conversation[] {
	const groups = new Map<string, Conversation[]>();
	const result: (Conversation | { groupOf: string })[] = [];
	for (const conversation of input.conversations) {
		const memberAgentId = resolveConversationMemberAgentId(
			conversation,
			input.index
		);
		if (!memberAgentId) {
			result.push(conversation);
			continue;
		}
		if (
			input.archivedSpaceIds?.has(conversation.spaceId) &&
			conversation.spaceId !== input.selectedSpaceId
		) {
			continue;
		}
		const group = groups.get(memberAgentId);
		if (group) {
			group.push(conversation);
		} else {
			groups.set(memberAgentId, [conversation]);
			result.push({ groupOf: memberAgentId });
		}
	}
	return result.map((entry) => {
		if (!("groupOf" in entry)) {
			return entry;
		}
		const sessions = groups.get(entry.groupOf) ?? [];
		const lastChat = input.lastChatOf?.(entry.groupOf) ?? null;
		const representative =
			sessions.find((session) => session.spaceId === input.selectedSpaceId) ??
			sessions.find((session) => session.spaceId === lastChat) ??
			[...sessions].sort((left, right) => right.activity - left.activity)[0];
		if (!representative) {
			throw new Error("A MemberAgent row needs at least one Session.");
		}
		return {
			...representative,
			memberAgentId: entry.groupOf,
			memberAgentSessionIds: sessions.map((session) => session.spaceId),
			memberAgentSessionTimestamps: new Map(
				sessions.flatMap((session) => {
					const timestamp =
						session.kind === "direct-message"
							? session.preview?.data?.timestamp
							: undefined;
					return timestamp === undefined
						? []
						: [[session.spaceId, timestamp] as const];
				})
			),
			title:
				input.index.byId.get(entry.groupOf)?.displayName ??
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
