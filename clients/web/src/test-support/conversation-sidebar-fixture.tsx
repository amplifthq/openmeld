import type { AccountSidebarPreferences } from "@openmeld/schemas";
import { createWakeProgressItem } from "@openmeld/space";
import { useState } from "react";
import {
	type Conversation,
	conversationSectionId,
	conversationSections,
	moveConversationPreferences,
	sortConversations,
} from "#/components/spaces/conversation-sidebar-model";
import { buildSpaceActiveWakeSummary } from "#/components/spaces/space-active-wake-presentation";
import { EMPTY_CHAT_PREFERENCES } from "#/lib/organizations/center-agent-chat-preferences";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";

export function fixtureSpace(
	id: string,
	title: string,
	pinned = false
): AccountSpaceItem {
	return {
		spaceId: id,
		spaceName: title,
		pinnedAt: pinned ? "2026-09-01" : null,
		spacePurpose: null,
		organizationId: "org",
		visibility: "private",
		joinedProfiles: [],
		lastJoinedAt: "2026-09-01",
		openProfileId: "human",
		openProfileName: "Human",
		pinnedProfileIds: pinned ? ["human"] : [],
		activeAgentCount: 1,
		activeHumanCount: 1,
		activeMemberCount: 2,
		messagePreview: {
			signalId: "message",
			profileId: "human",
			timestamp: 100,
			text: "The release plan is ready to review.",
		},
	};
}

const fixtureConversations: Conversation[] = [
	{
		kind: "space",
		item: fixtureSpace("release", "Release planning", true),
		spaceId: "release",
		title: "Release planning",
		activity: 100,
		profileId: "human",
		url: "/o/test/spaces/release",
	},
	{
		kind: "space",
		item: fixtureSpace("design", "Product design"),
		spaceId: "design",
		title: "Product design",
		activity: 300,
		profileId: "human",
		url: "/o/test/spaces/design",
	},
	{
		kind: "direct-message",
		chat: { spaceId: "felix", name: "Felix", createdAt: null },
		spaceId: "felix",
		title: "Felix",
		activity: 200,
		profileId: "human",
		url: "/o/test/chats/felix",
	},
	{
		kind: "direct-message",
		chat: {
			spaceId: "agent",
			name: "Launch checklist",
			createdAt: null,
			session: true,
		},
		spaceId: "agent",
		title: "Launch checklist",
		activity: 400,
		profileId: "human",
		url: "/o/test/chats/center-agent?session=agent",
	},
];

export function useConversationSidebarFixture() {
	const layoutScenario =
		typeof window !== "undefined" &&
		new URLSearchParams(window.location.search).has("layout");
	const [preferences, save] = useState<AccountSidebarPreferences>({
		pinned: { sort: "manual", spaceIds: ["release", "felix"] },
		spaces: { sort: "priority", spaceIds: [] },
		groups: [],
		chats: {
			...EMPTY_CHAT_PREFERENCES,
			pinned: { sort: "manual", spaceIds: ["felix"] },
		},
	});
	const [conversations, setConversations] = useState(fixtureConversations);
	const displayTitle = (item: Conversation) => {
		if (layoutScenario && item.spaceId === "design") {
			return "Product design and release coordination";
		}
		return item.kind === "direct-message"
			? (chatPreferences.titles[item.spaceId] ?? item.title)
			: item.title;
	};
	const chatPreferences = preferences.chats ?? EMPTY_CHAT_PREFERENCES;
	const sections = conversationSections(preferences, chatPreferences);
	const owner = (item: Conversation) =>
		conversationSectionId(item, sections, chatPreferences.pinned.spaceIds);
	const sort = (
		items: readonly Conversation[],
		section: Parameters<typeof sortConversations>[1]
	) => sortConversations(items, section, new Set(), new Map(), new Set());
	const move = (
		sectionId: string,
		id: string,
		visibleIds: readonly string[],
		beforeId?: string
	) => {
		const target = sections.find((section) => section.id === sectionId);
		const conversation = conversations.find((item) => item.spaceId === id);
		if (!(target && conversation)) {
			return Promise.resolve();
		}
		save(
			moveConversationPreferences({
				preferences,
				chats: chatPreferences,
				conversation,
				target,
				visibleIds,
				beforeId,
			})
		);
		if (conversation.kind === "space") {
			setConversations((items) =>
				items.map((item) =>
					item.spaceId === id && item.kind === "space"
						? {
								...item,
								item: {
									...item.item,
									pinnedAt: sectionId === "pinned" ? "2026-09-01" : null,
								},
							}
						: item
				)
			);
		}
		return Promise.resolve();
	};
	return {
		conversations: conversations.map((item) => ({
			...item,
			title: displayTitle(item),
		})),
		sections,
		moveGroups: {
			space: [
				{ id: "pinned", name: "Pinned" },
				{ id: "spaces", name: "Spaces" },
			],
			"direct-message": [
				{ id: "pinned", name: "Pinned" },
				{ id: "chats", name: "Direct messages" },
			],
		},
		selected: "design",
		owner,
		sort,
		move,
		unpin: async (item: Conversation) =>
			move(item.kind === "space" ? "spaces" : "chats", item.spaceId, []),
		canMove: () => true,
		updateSection: () => undefined,
		addGroup: () => undefined,
		disabled: false,
		directMessages: {
			inbox: { data: undefined, isPending: false, isError: false },
			org: { id: "org", slug: "test" },
			profileId: "human",
			needsDefaultHumanProfile: false,
			profilesQuery: {
				isPending: false,
				isError: false,
				isSuccess: true,
				isFetching: false,
				fetchStatus: "idle",
				refetch: () => undefined,
			},
			preferences: chatPreferences,
			isArchived: (chat: { spaceId: string }) =>
				chatPreferences.archivedIds.includes(chat.spaceId),
			setArchived: async (chat: { spaceId: string }, archived: boolean) =>
				save({
					...preferences,
					chats: {
						...chatPreferences,
						archivedIds: archived
							? [...new Set([...chatPreferences.archivedIds, chat.spaceId])]
							: chatPreferences.archivedIds.filter((id) => id !== chat.spaceId),
					},
				}),
			save: (chats: NonNullable<AccountSidebarPreferences["chats"]>) =>
				save({ ...preferences, chats }),
			store: {
				preferences,
				disabled: false,
				isPending: false,
				isError: false,
				save,
				saveAsync: async (next: AccountSidebarPreferences) => save(next),
				retry: () => undefined,
			},
			spaces: { isPending: false, isError: false, refetch: () => undefined },
			sessions: {
				isPending: false,
				isError: false,
				hasNextPage: false,
				refetch: () => undefined,
			},
			directory: { isPending: false, isError: false, refetch: () => undefined },
			indicators: {
				activityUnavailable: false,
				unreadBySpaceId: new Map(),
				activeWakeSummaryBySpaceId: new Map(
					layoutScenario
						? [
								[
									"design",
									buildSpaceActiveWakeSummary({
										spaceId: "design",
										items: [
											createWakeProgressItem({
												clientMessageId: "preview-message",
												sourceSignalId: "preview-signal",
												dispatchId: "preview-dispatch",
												targetProfileId: "preview-agent",
												targetLabel: "Review Agent",
												phase: "running",
												updatedAtMs: Date.now(),
											}),
										],
									}),
								],
							]
						: []
				),
			},
			attentionById: new Map(),
		},
	};
}
