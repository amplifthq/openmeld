import { useMemo } from "react";
import { groupMemberAgentConversations } from "#/components/member-agents/member-agent-conversations";
import {
	useArchivedMemberAgentSessionIds,
	useMemberAgentIndex,
	useMemberAgentSync,
} from "#/components/member-agents/use-member-agents";
import { buildOrganizationSpacePath } from "#/lib/organizations/organization-routes";
import { resolveAccountSpaceRecency } from "#/lib/spaces/account-spaces";
import { selectAccountSpaceSections } from "./account-space-sections";
import { mergeChatPreferences } from "./chat-sidebar-model";
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
	const memberAgents = useMemberAgentIndex();
	useMemberAgentSync();
	const archivedSpaceIds = useArchivedMemberAgentSessionIds(memberAgents);
	const {
		store,
		preferences: chatPreferences,
		org,
		profileId,
		indicators,
	} = directMessages;
	const preferences = store.preferences;
	// Menu destinations depend on saved group definitions, not read receipts
	// or account-item refreshes. Keep the same preference migration rules.
	const moveGroups = useMemo(() => {
		const targets = preferences
			? conversationSections(preferences, mergeChatPreferences(preferences, []))
			: [];
		const choices = (kind: "space" | "direct-message") =>
			targets
				.filter((target) => target.kind === "pinned" || target.kind === kind)
				.map(({ id, name }) => ({ id, name }));
		return {
			space: choices("space"),
			"direct-message": choices("direct-message"),
		};
	}, [preferences]);
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
			activity: resolveAccountSpaceRecency(item),
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
			activity: Math.max(
				preview?.data?.timestamp ?? 0,
				Date.parse(chat.createdAt ?? "") || 0
			),
			url: directMessages.chatPath(chat),
		});
	}
	if (memberAgents.ready) {
		const grouped = groupMemberAgentConversations({
			archivedSpaceIds,
			conversations: [...conversations.values()],
			index: memberAgents.index,
			selectedSpaceId: directMessages.selected,
		});
		conversations.clear();
		for (const conversation of grouped) {
			conversations.set(conversation.spaceId, conversation);
		}
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
	const disabled = !preferences;
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
		if (!(preferences && conversation && target && canMove(id, sectionId))) {
			return;
		}
		const accountItem =
			conversation.kind === "space"
				? conversation.item
				: directMessages.ordinaryAccountItems.find(
						(item) => item.spaceId === id
					);
		// Pin membership and layout have different owners. Start both intents
		// immediately; a failed pin keeps the canonical membership in its source.
		await Promise.all([
			accountItem
				? directMessages.pin.setPinned(accountItem, sectionId === "pinned")
				: Promise.resolve(true),
			store.updateAsync((current) => {
				const chats = mergeChatPreferences(
					current,
					directMessages.ordinaryAccountItems
				);
				const currentTarget = conversationSections(current, chats).find(
					(section) => section.id === sectionId
				);
				return currentTarget
					? moveConversationPreferences({
							preferences: current,
							chats,
							conversation,
							target: currentTarget,
							visibleIds,
							beforeId,
						})
					: current;
			}),
		]);
	};
	const unpin = async (conversation: Conversation) => {
		if (!preferences) {
			return;
		}
		const accountItem =
			conversation.kind === "space"
				? conversation.item
				: directMessages.ordinaryAccountItems.find(
						(item) => item.spaceId === conversation.spaceId
					);
		await Promise.all([
			accountItem
				? directMessages.pin.setPinned(accountItem, false)
				: Promise.resolve(true),
			store.updateAsync((current) => {
				const chats = mergeChatPreferences(
					current,
					directMessages.ordinaryAccountItems
				);
				return {
					...current,
					messages: undefined,
					pinned: {
						...current.pinned,
						spaceIds: current.pinned.spaceIds.filter(
							(id) => id !== conversation.spaceId
						),
					},
					chats: {
						...chats,
						pinned: {
							...chats.pinned,
							spaceIds: chats.pinned.spaceIds.filter(
								(id) => id !== conversation.spaceId
							),
						},
					},
				};
			}),
		]);
	};
	const updateSection = (
		section: ConversationSection,
		change: Partial<ConversationSection> | null
	) => {
		if (!preferences || disabled || section.kind === "pinned") {
			return;
		}
		store.update((current) => {
			const chats = mergeChatPreferences(
				current,
				directMessages.ordinaryAccountItems
			);
			const ownerPreferences = section.kind === "space" ? current : chats;
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
			return section.kind === "space"
				? { ...current, spaces: updated.spaces, groups: updated.groups }
				: {
						...current,
						messages: undefined,
						chats: {
							...chats,
							spaces: updated.spaces,
							groups: updated.groups,
						},
					};
		});
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
		store.update((current) => {
			const chats = mergeChatPreferences(
				current,
				directMessages.ordinaryAccountItems
			);
			const groups = kind === "space" ? current.groups : chats.groups;
			if (groups.some((value) => value.id === group.id)) {
				return current;
			}
			return kind === "space"
				? { ...current, groups: [...groups, group] }
				: {
						...current,
						messages: undefined,
						chats: {
							...chats,
							groups: [...groups, group],
						},
					};
		});
	};
	return {
		directMessages,
		conversations: [...conversations.values()],
		sections,
		moveGroups,
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
