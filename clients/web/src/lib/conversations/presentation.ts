import type { InboxItem } from "@openmeld/schemas/types";

export type ConversationName = { name: string; sourceName?: string | null };

export function resolveConversationTitle(
	spaceId: string,
	name: string | null | undefined,
	titles: Readonly<Record<string, string>> | undefined
): string {
	return titles?.[spaceId] ?? name ?? "New chat";
}

/** Display only: never derive identity, routing or notification eligibility from copy. */
export function presentInboxConversation(
	item: InboxItem,
	conversation: ConversationName | undefined
): InboxItem {
	if (
		!conversation ||
		(item.sourceTarget.kind !== "space" &&
			item.sourceTarget.kind !== "center_agent")
	) {
		return item;
	}
	let title = item.title;
	if (
		["agent_reply", "space_message", "space_mention", "wake_outcome"].includes(
			item.kind
		)
	) {
		const sourceName =
			item.sourceTarget.kind === "center_agent"
				? conversation.sourceName
				: item.contextLabel;
		const prefix = conversationTitlePrefix(
			title,
			sourceName,
			item.sourceTarget.kind === "center_agent"
		);
		if (prefix) {
			title = `${prefix}${conversation.name}`;
		}
	}
	return title === item.title && item.contextLabel === conversation.name
		? item
		: { ...item, title, contextLabel: conversation.name };
}

// Older Center Agent items replaced their source label with "Center Agent".
// Recognize only the Space producer's templates; leave ambiguous/custom copy intact.
const CONVERSATION_ACTION =
	/(?: replied to your thread in | replied in | mentioned you in | addressed your agent in |^New message in |^Agent update in |^Agent couldn't finish in )/gu;

function conversationTitlePrefix(
	title: string,
	sourceName: string | null | undefined,
	legacyCenterAgent: boolean
): string | null {
	const actions = [...title.matchAll(CONVERSATION_ACTION)];
	if (sourceName) {
		for (const action of actions) {
			const end = action.index + action[0].length;
			const suffix = title.slice(end);
			if (
				suffix === sourceName ||
				(suffix.endsWith("…") && sourceName.startsWith(suffix.slice(0, -1)))
			) {
				return title.slice(0, end);
			}
		}
	}
	if (!legacyCenterAgent || actions.length !== 1) {
		return null;
	}
	const action = actions[0];
	return action ? title.slice(0, action.index + action[0].length) : null;
}
