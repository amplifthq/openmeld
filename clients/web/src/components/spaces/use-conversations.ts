import { useRef, useState } from "react";
import { buildOrganizationSpacePath } from "#/lib/organizations/organization-routes";
import { selectAccountSpaceSections } from "./account-space-sections";
import {
	type Conversation,
	type ConversationSection,
	conversationSectionId,
	conversationSections,
	moveConversationPreferences,
	sortConversations,
} from "./conversation-sidebar-model";
import { resolveSidebarAttentionSpaceIds } from "./sidebar-space-order";
import { useChats } from "./use-chats";
import { useDeletedSpaceNotices } from "./use-deleted-space-notices";

export function useConversations(input: {
	currentProfileId?: string;
	currentSpaceId?: string;
}) {
	const directMessages = useChats({
		...input,
		includeSpaceIndicators: true,
		search: "",
		archived: false,
		includes: () => true,
	});
	const {
		store,
		preferences: chatPreferences,
		org,
		profileId,
		indicators,
	} = directMessages;
	const preferences = store.preferences;
	useDeletedSpaceNotices(directMessages.spaces.data?.recentlyDeletedItems);
	const selected = directMessages.selected;
	const accountSections = selectAccountSpaceSections({
		currentOrganizationId: org.id,
		sections: directMessages.spaces.data ?? { pinnedItems: [], spaceItems: [] },
	});
	const conversations = new Map<string, Conversation>();
	for (const item of [
		...accountSections.pinnedItems,
		...accountSections.spaceItems,
	]) {
		conversations.set(item.spaceId, {
			kind: "space",
			item,
			spaceId: item.spaceId,
			title: item.spaceName,
			profileId,
			activity:
				item.messagePreview?.timestamp ??
				(Date.parse(item.spaceCreatedAt ?? "") || 0),
			url: buildOrganizationSpacePath({
				orgSlug: org.slug,
				spaceId: item.spaceId,
				search: { profileId },
			}),
		});
	}
	for (const chat of directMessages.chats) {
		const preview = directMessages.previews[directMessages.chats.indexOf(chat)];
		conversations.set(chat.spaceId, {
			kind: "direct-message",
			chat,
			preview,
			spaceId: chat.spaceId,
			title: directMessages.title(chat),
			profileId: chat.viewerProfileId ?? profileId,
			activity:
				preview?.data?.timestamp ?? (Date.parse(chat.createdAt ?? "") || 0),
			url: directMessages.chatPath(chat),
		});
	}
	const sections = preferences
		? conversationSections(preferences, chatPreferences)
		: [];
	const owner = (conversation: Conversation) =>
		conversationSectionId(
			conversation,
			sections,
			chatPreferences.pinned.spaceIds
		);
	const attention = resolveSidebarAttentionSpaceIds(
		indicators.activeWakeSummaryBySpaceId,
		directMessages.inbox.data?.attention
	);
	const unread = new Map(
		[...indicators.unreadBySpaceId]
			.filter(([, value]) => value.unreadCount > 0)
			.map(([id, value]) => [id, value.latestUnreadOccurredAtMs])
	);
	const working = new Set(indicators.activeWakeSummaryBySpaceId.keys());
	const sort = (
		items: readonly Conversation[],
		section: Pick<ConversationSection, "id" | "sort" | "spaceIds">
	) => sortConversations(items, section, attention, unread, working);
	const [busy, setBusy] = useState(false);
	const writing = useRef(false);
	const disabled =
		store.disabled || directMessages.pin.arePinActionsPending || busy;
	const canMove = (id: string, sectionId: string) => {
		const conversation = conversations.get(id);
		const target = sections.find((section) => section.id === sectionId);
		return (
			!disabled &&
			!!conversation &&
			!!target &&
			(target.kind === "pinned" || target.kind === conversation.kind)
		);
	};
	const move = async (
		sectionId: string,
		id: string,
		visibleIds: readonly string[],
		beforeId?: string
	) => {
		const conversation = conversations.get(id);
		const target = sections.find((section) => section.id === sectionId);
		if (
			!(preferences && conversation && target && canMove(id, sectionId)) ||
			writing.current
		) {
			return;
		}
		writing.current = true;
		setBusy(true);
		try {
			const accountItem =
				conversation.kind === "space"
					? conversation.item
					: directMessages.ordinaryAccountItems.find(
							(item) => item.spaceId === id
						);
			if (
				accountItem &&
				!(await directMessages.pin.setPinned(
					accountItem,
					sectionId === "pinned"
				))
			) {
				return;
			}
			await store.saveAsync(
				moveConversationPreferences({
					preferences,
					chats: chatPreferences,
					conversation,
					target,
					visibleIds,
					beforeId,
				})
			);
		} finally {
			writing.current = false;
			setBusy(false);
		}
	};
	const unpin = async (conversation: Conversation) => {
		if (!preferences || disabled || writing.current) {
			return;
		}
		writing.current = true;
		setBusy(true);
		try {
			const accountItem =
				conversation.kind === "space"
					? conversation.item
					: directMessages.ordinaryAccountItems.find(
							(item) => item.spaceId === conversation.spaceId
						);
			if (
				accountItem &&
				!(await directMessages.pin.setPinned(accountItem, false))
			) {
				return;
			}
			await store.saveAsync({
				...preferences,
				messages: undefined,
				pinned: {
					...preferences.pinned,
					spaceIds: preferences.pinned.spaceIds.filter(
						(id) => id !== conversation.spaceId
					),
				},
				chats: {
					...chatPreferences,
					pinned: {
						...chatPreferences.pinned,
						spaceIds: chatPreferences.pinned.spaceIds.filter(
							(id) => id !== conversation.spaceId
						),
					},
				},
			});
		} finally {
			writing.current = false;
			setBusy(false);
		}
	};
	const updateSection = (
		section: ConversationSection,
		change: Partial<ConversationSection> | null
	) => {
		if (!preferences || disabled || section.kind === "pinned") {
			return;
		}
		const ownerPreferences =
			section.kind === "space" ? preferences : chatPreferences;
		const updated = section.groupId
			? {
					...ownerPreferences,
					groups: change
						? ownerPreferences.groups.map((group) =>
								group.id === section.groupId
									? {
											...group,
											...(change.name === undefined
												? {}
												: { name: change.name }),
											...(change.sort === undefined
												? {}
												: { sort: change.sort }),
										}
									: group
							)
						: ownerPreferences.groups.filter(
								(group) => group.id !== section.groupId
							),
				}
			: {
					...ownerPreferences,
					spaces: {
						...ownerPreferences.spaces,
						...(change?.sort === undefined ? {} : { sort: change.sort }),
					},
				};
		store.save(
			section.kind === "space"
				? { ...preferences, spaces: updated.spaces, groups: updated.groups }
				: {
						...preferences,
						messages: undefined,
						chats: {
							...chatPreferences,
							spaces: updated.spaces,
							groups: updated.groups,
						},
					}
		);
	};
	const addGroup = (kind: "space" | "direct-message", name: string) => {
		if (!preferences || disabled) {
			return;
		}
		const group = {
			id: crypto.randomUUID(),
			name,
			sort: "priority" as const,
			spaceIds: [],
		};
		store.save(
			kind === "space"
				? { ...preferences, groups: [...preferences.groups, group] }
				: {
						...preferences,
						messages: undefined,
						chats: {
							...chatPreferences,
							groups: [...chatPreferences.groups, group],
						},
					}
		);
	};
	return {
		directMessages,
		conversations: [...conversations.values()],
		sections,
		selected,
		owner,
		sort,
		move,
		unpin,
		canMove,
		updateSection,
		addGroup,
		disabled,
	};
}
