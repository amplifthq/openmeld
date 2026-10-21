import type { AccountSidebarPreferences } from "@openmeld/schemas";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { moveSidebarItemIds, sortSidebarManual } from "../app/sidebar-order";
import type { Chat } from "./chat-sidebar-model";
import { sortSidebarSpaces } from "./sidebar-space-order";

export type Conversation = {
	spaceId: string;
	title: string;
	activity: number;
	url: string;
	profileId: string;
	/** Set on the one row that stands for all Sessions of a MemberAgent. */
	memberAgentId?: string;
	/** Every Session Space the MemberAgent row stands for. */
	memberAgentSessionIds?: readonly string[];
	/** Last-message time of each of those Sessions, from the live chat list. */
	memberAgentSessionTimestamps?: ReadonlyMap<string, number>;
} & (
	| { kind: "space"; item: AccountSpaceItem }
	| {
			kind: "direct-message";
			chat: Chat;
			preview?: ConversationPreview;
			/** Present on the single entry that stands for several Center Agent sessions. */
			sessionSpaceIds?: readonly string[];
			sessionUrlBySpaceId?: ReadonlyMap<string, string>;
	  }
);

export type ConversationPreview = {
	data?: { text: string; timestamp: number; signalId?: string } | null;
	isError: boolean;
	isPending: boolean;
};

export type ConversationSection = AccountSidebarPreferences["spaces"] & {
	id: string;
	name: string;
	kind: "space" | "direct-message" | "pinned";
	groupId?: string;
};

export function conversationCategory(item: Conversation) {
	if (item.kind === "space") {
		return "space";
	}
	return item.chat.session
		? "agent"
		: (item.chat.profileKind ?? item.chat.peer?.profileKind ?? "unknown");
}

export function conversationSections(
	preferences: AccountSidebarPreferences,
	chats: NonNullable<AccountSidebarPreferences["chats"]>
): ConversationSection[] {
	return [
		{
			id: "pinned",
			name: "Pinned",
			kind: "pinned",
			sort: "manual",
			spaceIds: [
				...new Set([...preferences.pinned.spaceIds, ...chats.pinned.spaceIds]),
			],
		},
		...preferences.groups.map((group) => ({
			...group,
			id: `space:${group.id}`,
			groupId: group.id,
			kind: "space" as const,
		})),
		{ ...preferences.spaces, id: "spaces", name: "Spaces", kind: "space" },
		...chats.groups.map((group) => ({
			...group,
			id: `chat:${group.id}`,
			groupId: group.id,
			kind: "direct-message" as const,
		})),
		{
			...chats.spaces,
			id: "chats",
			name: "Direct messages",
			kind: "direct-message",
		},
	];
}

export function conversationSectionId(
	item: Conversation,
	sections: readonly ConversationSection[],
	chatPins: readonly string[]
): string {
	const pinned =
		item.kind === "space"
			? !!item.item.pinnedAt
			: chatPins.includes(item.spaceId);
	if (pinned) {
		return "pinned";
	}
	return (
		sections.find(
			(section) =>
				section.kind === item.kind &&
				section.groupId &&
				section.spaceIds.includes(item.spaceId)
		)?.id ?? (item.kind === "space" ? "spaces" : "chats")
	);
}

export function sortConversations(
	items: readonly Conversation[],
	section: Pick<ConversationSection, "id" | "sort" | "spaceIds">,
	attention: ReadonlySet<string>,
	unread: ReadonlyMap<string, number>,
	working: ReadonlySet<string>
): readonly Conversation[] {
	if (section.id === "pinned") {
		return sortSidebarManual(items, section.spaceIds, (item) => item.spaceId);
	}
	return sortSidebarSpaces(
		items.map((item) => ({ ...item, pinnedAt: null, lastJoinedAt: "" })),
		section,
		attention,
		unread,
		working,
		new Map(items.map((item) => [item.spaceId, item.activity]))
	);
}

// Pin membership stays in Space Index (ordinary conversations) and chats
// preferences (sessions). The root pinned section stores only the shared order.
export function moveConversationPreferences(input: {
	preferences: AccountSidebarPreferences;
	chats: NonNullable<AccountSidebarPreferences["chats"]>;
	conversation: Conversation;
	target: ConversationSection;
	visibleIds: readonly string[];
	beforeId?: string;
}): AccountSidebarPreferences {
	const { preferences, conversation, target } = input;
	if (target.kind !== "pinned" && target.kind !== conversation.kind) {
		return preferences;
	}
	const id = conversation.spaceId;
	const ids = moveSidebarItemIds(
		target.spaceIds,
		input.visibleIds,
		id,
		input.beforeId
	);
	const chats = {
		...input.chats,
		pinned: {
			...input.chats.pinned,
			spaceIds: input.chats.pinned.spaceIds.filter((value) => value !== id),
		},
	};
	const next = {
		...preferences,
		chats,
		messages: undefined,
		pinned: {
			...preferences.pinned,
			spaceIds: preferences.pinned.spaceIds.filter((value) => value !== id),
		},
	};
	if (target.kind === "pinned") {
		if (conversation.kind === "direct-message") {
			chats.pinned.spaceIds.push(id);
		}
		return { ...next, pinned: { sort: "manual", spaceIds: ids } };
	}
	const owner = conversation.kind === "space" ? next : chats;
	const updated = {
		...owner,
		spaces: target.groupId
			? {
					...owner.spaces,
					spaceIds: owner.spaces.spaceIds.filter((value) => value !== id),
				}
			: { sort: "manual" as const, spaceIds: ids },
		groups: owner.groups.map((group) =>
			group.id === target.groupId
				? { ...group, sort: "manual" as const, spaceIds: ids }
				: { ...group, spaceIds: group.spaceIds.filter((value) => value !== id) }
		),
	};
	return conversation.kind === "space"
		? { ...next, spaces: updated.spaces, groups: updated.groups }
		: {
				...next,
				chats: { ...chats, spaces: updated.spaces, groups: updated.groups },
			};
}
