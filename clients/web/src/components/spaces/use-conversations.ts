import { useEffect, useMemo } from "react";
import { groupMemberAgentConversations } from "#/components/member-agents/member-agent-conversations";
import {
	readMemberAgentLastChat,
	resolveMemberAgentLastChat,
	useMemberAgentLastChatScope,
} from "#/components/member-agents/member-agent-last-chat";
import {
	useArchivedMemberAgentSessionIds,
	useMemberAgentIndex,
	useMemberAgentSync,
} from "#/components/member-agents/use-member-agents";
import { buildOrganizationSpacePath } from "#/lib/organizations/organization-routes";
import { resolveAccountSpaceRecency } from "#/lib/spaces/account-spaces";
import { selectAccountSpaceSections } from "./account-space-sections";
import {
	aliasSpaceIds,
	collapseCenterAgentSessions,
	keepOnlyCenterAgentEntryPosition,
	mergeActiveWakeSummaries,
	mergeBySidebarEntry,
} from "./center-agent-sidebar-entry";
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
	/** Show the viewer's active Center Agent sessions as one entry with this title. */
	centerAgentEntryTitle?: string;
}) {
	const rawDirectMessages = useChats({
		currentProfileId: input.currentProfileId,
		currentSpaceId: input.currentSpaceId,
		includeSpaceIndicators: true,
		search: "",
		archived: false,
		includes: () => true,
	});
	const memberAgents = useMemberAgentIndex();
	useMemberAgentSync();
	const archivedSpaceIds = useArchivedMemberAgentSessionIds(memberAgents);
	const lastChatScope = useMemberAgentLastChatScope();
	const {
		store,
		preferences: chatPreferences,
		org,
		profileId,
	} = rawDirectMessages;
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
	useDeletedSpaceNotices(rawDirectMessages.spaces.data?.recentlyDeletedItems);
	const accountSections = selectAccountSpaceSections({
		currentOrganizationId: org.id,
		sections: rawDirectMessages.spaces.data ?? {
			pinnedItems: [],
			spaceItems: [],
		},
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
	for (const chat of rawDirectMessages.chats) {
		const preview =
			rawDirectMessages.previews[rawDirectMessages.chats.indexOf(chat)];
		conversations.set(chat.spaceId, {
			kind: "direct-message",
			chat,
			preview,
			spaceId: chat.spaceId,
			title: rawDirectMessages.title(chat),
			profileId: chat.viewerProfileId ?? profileId,
			activity: Math.max(
				preview?.data?.timestamp ?? 0,
				Date.parse(chat.createdAt ?? "") || 0
			),
			url: rawDirectMessages.chatPath(chat),
		});
	}
	// MemberAgent rows first: they group real Session Spaces, before any
	// Center Agent entry aliasing. A no-op while MEMBER_AGENTS_ENABLED is off.
	let memberAgentRows: { memberAgentId: string; spaceIds: string[] }[] = [];
	if (memberAgents.ready) {
		const grouped = groupMemberAgentConversations({
			archivedSpaceIds,
			conversations: [...conversations.values()],
			index: memberAgents.index,
			selectedSpaceId: rawDirectMessages.selected,
			lastChatOf: (memberAgentId) =>
				lastChatScope
					? readMemberAgentLastChat(lastChatScope, { memberAgentId })
					: null,
		});
		conversations.clear();
		for (const conversation of grouped) {
			conversations.set(conversation.spaceId, conversation);
		}
		memberAgentRows = grouped.flatMap((row) =>
			row.memberAgentId
				? [
						{
							memberAgentId: row.memberAgentId,
							spaceIds: [...(row.memberAgentSessionIds ?? [])],
						},
					]
				: []
		);
	}
	// A remembered chat no longer in the loaded list (deleted, archived or
	// inaccessible) is cleared; the row already fell back to the latest chat.
	const memberAgentRowsKey = JSON.stringify(memberAgentRows);
	const chatListLoaded = rawDirectMessages.spaces.isSuccess;
	const lastChatOrganizationId = lastChatScope?.organizationId;
	const lastChatHumanProfileId = lastChatScope?.humanProfileId;
	useEffect(() => {
		if (!(chatListLoaded && lastChatOrganizationId && lastChatHumanProfileId)) {
			return;
		}
		const rows = JSON.parse(memberAgentRowsKey) as typeof memberAgentRows;
		for (const row of rows) {
			resolveMemberAgentLastChat({
				scope: {
					organizationId: lastChatOrganizationId,
					humanProfileId: lastChatHumanProfileId,
				},
				target: { memberAgentId: row.memberAgentId },
				available: row.spaceIds,
				complete: true,
			});
		}
	}, [
		chatListLoaded,
		lastChatOrganizationId,
		lastChatHumanProfileId,
		memberAgentRowsKey,
	]);
	const collapsed = input.centerAgentEntryTitle
		? collapseCenterAgentSessions({
				conversations: [...conversations.values()],
				archivedIds: chatPreferences.archivedIds,
				latestUnreadAtBySpaceId: new Map(
					[...rawDirectMessages.indicators.unreadBySpaceId]
						.filter(([, value]) => value.unreadCount > 0)
						.map(([id, value]) => [id, value.latestUnreadOccurredAtMs])
				),
				title: input.centerAgentEntryTitle,
			})
		: null;
	const entryIdBySessionId: ReadonlyMap<string, string> =
		collapsed?.entryIdBySessionId ?? new Map();
	// A pin, group or manual position saved for any session applies to its entry.
	const sections = (
		preferences ? conversationSections(preferences, chatPreferences) : []
	).map((section) =>
		collapsed
			? {
					...section,
					spaceIds: aliasSpaceIds(section.spaceIds, entryIdBySessionId),
				}
			: section
	);
	const chatPins = aliasSpaceIds(
		chatPreferences.pinned.spaceIds,
		entryIdBySessionId
	);
	const rows = new Map(
		(collapsed?.conversations ?? [...conversations.values()]).map((item) => [
			item.spaceId,
			item,
		])
	);
	// Evidence stays keyed by real Space; the collapsed entry shows the sum.
	const directMessages = collapsed
		? {
				...rawDirectMessages,
				indicators: {
					...rawDirectMessages.indicators,
					unreadBySpaceId: mergeBySidebarEntry(
						rawDirectMessages.indicators.unreadBySpaceId,
						entryIdBySessionId,
						(current, next) => ({
							unreadCount: current.unreadCount + next.unreadCount,
							// An unknown count stays unknown so the badge falls back to the total.
							messageUnreadCount:
								current.messageUnreadCount === undefined ||
								next.messageUnreadCount === undefined
									? undefined
									: current.messageUnreadCount + next.messageUnreadCount,
							latestUnreadOccurredAtMs: Math.max(
								current.latestUnreadOccurredAtMs ?? 0,
								next.latestUnreadOccurredAtMs ?? 0
							),
						})
					),
					// Keyed by entry; each summary keeps the session Space that owns its work.
					activeWakeSummaryBySpaceId: mergeBySidebarEntry(
						rawDirectMessages.indicators.activeWakeSummaryBySpaceId,
						entryIdBySessionId,
						mergeActiveWakeSummaries
					),
				},
				attentionById: mergeBySidebarEntry(
					rawDirectMessages.attentionById,
					entryIdBySessionId,
					(current, next) => ({
						...current,
						unresolvedActionCount:
							current.unresolvedActionCount + next.unresolvedActionCount,
						unreadUrgentUpdateCount:
							current.unreadUrgentUpdateCount + next.unreadUrgentUpdateCount,
					})
				),
			}
		: rawDirectMessages;
	const { indicators } = directMessages;
	const selected = rawDirectMessages.selected
		? (entryIdBySessionId.get(rawDirectMessages.selected) ??
			rawDirectMessages.selected)
		: rawDirectMessages.selected;
	const owner = (conversation: Conversation) =>
		conversationSectionId(conversation, sections, chatPins);
	const attention = resolveSidebarAttentionSpaceIds(
		indicators.activeWakeSummaryBySpaceId,
		rawDirectMessages.inbox.data?.attention?.map((item) => ({
			...item,
			spaceId: entryIdBySessionId.get(item.spaceId) ?? item.spaceId,
		}))
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
		const conversation = rows.get(id);
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
		const conversation = rows.get(id);
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
			store.updateAsync((latest) => {
				const current =
					conversation.kind === "direct-message" && conversation.sessionSpaceIds
						? keepOnlyCenterAgentEntryPosition(
								latest,
								conversation.sessionSpaceIds,
								conversation.spaceId
							)
						: latest;
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
		const unpinned = new Set(
			conversation.kind === "direct-message" && conversation.sessionSpaceIds
				? conversation.sessionSpaceIds
				: [conversation.spaceId]
		);
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
			store.updateAsync((latest) => {
				const current =
					conversation.kind === "direct-message" && conversation.sessionSpaceIds
						? keepOnlyCenterAgentEntryPosition(
								latest,
								conversation.sessionSpaceIds,
								conversation.spaceId
							)
						: latest;
				const chats = mergeChatPreferences(
					current,
					directMessages.ordinaryAccountItems
				);
				return {
					...current,
					messages: undefined,
					pinned: {
						...current.pinned,
						spaceIds: current.pinned.spaceIds.filter((id) => !unpinned.has(id)),
					},
					chats: {
						...chats,
						pinned: {
							...chats.pinned,
							spaceIds: chats.pinned.spaceIds.filter((id) => !unpinned.has(id)),
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
		conversations: [...rows.values()],
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
