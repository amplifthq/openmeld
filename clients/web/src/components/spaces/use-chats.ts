import type { AccountSidebarPreferences } from "@openmeld/schemas";
import {
	useInfiniteQuery,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { moveSidebarItemIds } from "#/components/app/sidebar-order";
import { useSidebarPreferences } from "#/components/app/use-sidebar-preferences";
import {
	useMemberAgentIndex,
	useMemberAgentSessionTitles,
} from "#/components/member-agents/use-member-agents";
import { resolveConversationTitle } from "#/lib/conversations/presentation";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationCenterAgentChatPath,
	buildOrganizationDirectMessagePath,
} from "#/lib/organizations/organization-routes";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import {
	agentDirectMessageSessionQueryKeys,
	agentDirectMessageSessionsQueryOptions,
	createAgentDirectMessageSessionApi,
} from "#/query/organizations/agent-direct-message-sessions";
import { centerAgentSessionsQueryOptions } from "#/query/organizations/center-agent-sessions";
import { spaceInboxSummaryQueryOptions } from "#/query/organizations/inbox";
import { organizationProfileIdentityDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import {
	resolveAccountSpaceViewerProfileId,
	selectAccountSpaceSections,
} from "./account-space-sections";
import {
	type Chat,
	chatSessionAgentProfileId,
	isChatArchived,
	mergeChatPreferences,
} from "./chat-sidebar-model";
import { resolveDirectMessagePresentation } from "./direct-message-presentation";
import { spaceMessagePreviewQueryOptions } from "./direct-message-preview";
import {
	resolveSidebarAttentionSpaceIds,
	sortSidebarSpaces,
} from "./sidebar-space-order";
import { useAccountSpacePinMutation } from "./use-account-space-pin-mutation";
import { useSpaceListIndicators } from "./use-space-list-indicators";

type Preferences = NonNullable<AccountSidebarPreferences["chats"]>;

/**
 * A MemberAgent has one Direct Message per Session, so its name alone would
 * label every Session the same; the Session's title tells them apart.
 */
export function withSessionTitle(
	name: string | null,
	sessionTitle: string | undefined
): string | null {
	return name && sessionTitle ? `${name} · ${sessionTitle}` : name;
}

export function useChats(input: {
	currentProfileId?: string;
	includeSpaceIndicators?: boolean;
	currentSpaceId?: string;
	search: string;
	archived: boolean;
	includes: (kind: string) => boolean;
}) {
	const { currentOrganization: org, currentUserId } = useAppOrganization();
	const queryClient = useQueryClient();
	const { defaultHumanProfile, profilesQuery } = useDefaultHumanProfile();
	const profileId =
		input.currentProfileId ?? defaultHumanProfile?.openMeldProfileId ?? "";
	const store = useSidebarPreferences(org.id);
	const spaces = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: !!profileId,
			profileId,
			scope: "account",
		})
	);
	const directory = useQuery(
		organizationProfileIdentityDirectoryQueryOptions({
			enabled: !!profileId,
			organizationId: org.id,
		})
	);
	const accountItems = spaces.data
		? selectAccountSpaceSections({
				currentOrganizationId: org.id,
				sections: spaces.data,
			}).directMessageItems
		: [];
	const selected = useRouterState({
		select: (state) =>
			input.currentSpaceId ??
			new URLSearchParams(state.location.searchStr).get("session"),
	});
	const sessions = useInfiniteQuery(
		centerAgentSessionsQueryOptions(org.id, profileId)
	);
	const memberAgents = useMemberAgentIndex();
	const memberAgentSessionTitles = useMemberAgentSessionTitles(memberAgents);
	const chatsById = new Map<string, Chat>(
		accountItems.map((item) => {
			const viewerProfileId = resolveAccountSpaceViewerProfileId({
				currentProfileId: profileId,
				item,
			});
			const presentation = resolveDirectMessagePresentation({
				item,
				profileDirectory: directory.data,
				viewerProfileId,
				viewerUserId: currentUserId,
			});
			return [
				item.spaceId,
				{
					messagePreview: item.messagePreview,
					recentMessagePreviews: item.recentMessagePreviews,
					spaceId: item.spaceId,
					name: withSessionTitle(
						presentation.name,
						memberAgentSessionTitles.get(item.spaceId)
					),
					profileKind: presentation.profileKind,
					createdAt: item.spaceCreatedAt ?? null,
					viewerProfileId,
					peer: presentation.peer,
					participants: presentation.participants,
				},
			];
		})
	);
	for (const session of sessions.data?.pages.flatMap((page) => page.sessions) ??
		[]) {
		chatsById.set(session.spaceId, {
			...chatsById.get(session.spaceId),
			...session,
			session: true,
			centerAgentProfileId: session.centerAgentProfileId,
			centerAgentAvatarStyle: directory.data?.agentProfiles.find(
				(profile) => profile.profileId === session.centerAgentProfileId
			)?.avatarStyle,
			centerAgentProfileName: directory.data?.agentProfiles.find(
				(profile) => profile.profileId === session.centerAgentProfileId
			)?.profileName,
		});
	}
	const chats = [...chatsById.values()];
	const sessionProfileIds = [
		...new Set(
			chats.flatMap((chat) => {
				const id = chatSessionAgentProfileId(chat);
				return id ? [id] : [];
			})
		),
	];
	const archivedSessions = useQueries({
		queries: sessionProfileIds.map((agentProfileId) =>
			agentDirectMessageSessionsQueryOptions({
				organizationId: org.id,
				agentProfileId,
				archived: true,
				enabled: isMemberAgentsEnabled() && Boolean(profileId),
			})
		),
	});
	const sessionArchivedIds = new Set(
		archivedSessions.flatMap(
			(query) => query.data?.sessions.map((session) => session.spaceId) ?? []
		)
	);
	const ordinaryAccountItems = accountItems.filter(
		(item) => !chatsById.get(item.spaceId)?.session
	);
	const preferences = mergeChatPreferences(
		store.preferences,
		ordinaryAccountItems
	);
	const isArchived = (chat: Chat) =>
		isChatArchived({
			chat,
			memberAgentsEnabled: isMemberAgentsEnabled(),
			personalArchivedIds: preferences.archivedIds,
			sessionArchivedIds,
		});
	const unprojectedChats = chats.filter(
		(chat) => chat.messagePreview === undefined
	);
	const unprojectedPreviews = useQueries({
		queries: unprojectedChats.map((chat) =>
			spaceMessagePreviewQueryOptions({
				spaceId: chat.spaceId,
				viewerProfileId: chat.viewerProfileId ?? profileId,
				enabled: !!profileId,
			})
		),
	});
	const previewById = new Map(
		unprojectedChats.map((chat, index) => [
			chat.spaceId,
			unprojectedPreviews[index],
		])
	);
	const previews = chats.map((chat) =>
		chat.messagePreview !== undefined
			? { data: chat.messagePreview, isPending: false, isError: false }
			: previewById.get(chat.spaceId)
	);
	const activity = new Map(
		chats.map((chat, index) => [
			chat.spaceId,
			previews[index]?.data?.timestamp ?? 0,
		])
	);
	const chatPath = (chat: Chat, focusSignalId?: string) =>
		chat.session
			? buildOrganizationCenterAgentChatPath(org.slug, {
					session: chat.spaceId,
					focusSignalId,
				})
			: buildOrganizationDirectMessagePath({
					orgSlug: org.slug,
					spaceId: chat.spaceId,
					search: {
						profileId: chat.viewerProfileId ?? profileId,
						focusSignalId,
					},
				});
	const inbox = useQuery(
		spaceInboxSummaryQueryOptions({ organizationId: org.id })
	);
	const attentionById = new Map(
		(inbox.data?.attention ?? []).map((item) => [item.spaceId, item])
	);
	const indicators = useSpaceListIndicators({
		currentProfileId: profileId,
		currentSpaceId: selected ?? "",
		organizationId: org.id,
		spaceIds: chats.map((chat) => chat.spaceId),
		...(input.includeSpaceIndicators ? { sections: spaces.data } : {}),
	});
	// Publish each page immediately; searching and saved groups include older chats
	// as subsequent pages arrive, without holding the first page behind them.
	useEffect(() => {
		if (sessions.hasNextPage && !sessions.isFetching && !sessions.isError) {
			sessions.fetchNextPage();
		}
	}, [
		sessions.hasNextPage,
		sessions.isFetching,
		sessions.isError,
		sessions.fetchNextPage,
	]);
	const save = (chats: Preferences) => {
		if (store.preferences) {
			store.save({ ...store.preferences, messages: undefined, chats });
		}
	};
	const setArchived = async (chat: Chat, archived: boolean) => {
		if (isMemberAgentsEnabled() && chatSessionAgentProfileId(chat)) {
			try {
				await createAgentDirectMessageSessionApi(org.id).updateSession({
					spaceId: chat.spaceId,
					update: { operation: archived ? "archive" : "unarchive" },
				});
				await queryClient.invalidateQueries({
					queryKey: agentDirectMessageSessionQueryKeys.all(org.id),
				});
			} catch (error) {
				console.error("Could not update chat archive", error);
				toast.error("Couldn’t update this chat. Try again.");
			}
			return;
		}
		store.update((current) => {
			const currentChats = mergeChatPreferences(current, ordinaryAccountItems);
			return {
				...current,
				messages: undefined,
				chats: {
					...currentChats,
					archivedIds: archived
						? [...new Set([...currentChats.archivedIds, chat.spaceId])]
						: currentChats.archivedIds.filter((id) => id !== chat.spaceId),
				},
			};
		});
	};
	const sections = [
		{ id: "pinned", name: "Pinned", ...preferences.pinned },
		...preferences.groups,
		{ id: "chats", name: "Direct messages", ...preferences.spaces },
	];
	const title = (chat: Chat) =>
		resolveConversationTitle(chat.spaceId, chat.name, preferences.titles);
	const owner = (id: string) =>
		preferences.pinned.spaceIds.includes(id)
			? "pinned"
			: (preferences.groups.find((g) => g.spaceIds.includes(id))?.id ??
				"chats");
	const rows = (section: string) => {
		const config = sections.find((s) => s.id === section);
		if (!config) {
			return [];
		}
		const items = chats.filter(
			(chat) =>
				owner(chat.spaceId) === section &&
				input.includes(
					chat.session ? "agent" : (chat.profileKind ?? "unknown")
				) &&
				isArchived(chat) === input.archived &&
				title(chat)
					.toLocaleLowerCase()
					.includes(input.search.toLocaleLowerCase())
		);
		return sortSidebarSpaces(
			items.map((chat) => ({
				...chat,
				pinnedAt: null,
				lastJoinedAt: "",
				spaceCreatedAt: chat.createdAt,
				spaceUpdatedAt: chat.createdAt,
			})),
			config,
			resolveSidebarAttentionSpaceIds(
				indicators.activeWakeSummaryBySpaceId,
				inbox.data?.attention
			),
			new Map(
				[...indicators.unreadBySpaceId].map(([id, value]) => [
					id,
					value.latestUnreadOccurredAtMs,
				])
			),
			new Set(indicators.activeWakeSummaryBySpaceId.keys()),
			activity
		);
	};
	const sortSection = (id: string, sort: Preferences["spaces"]["sort"]) => {
		if (id === "pinned") {
			save({ ...preferences, pinned: { ...preferences.pinned, sort } });
		} else if (id === "chats") {
			save({ ...preferences, spaces: { ...preferences.spaces, sort } });
		} else {
			save({
				...preferences,
				groups: preferences.groups.map((g) =>
					g.id === id ? { ...g, sort } : g
				),
			});
		}
	};
	const pin = useAccountSpacePinMutation({ currentProfileId: profileId });
	const move = async (section: string, id: string, before?: string) => {
		const target = sections.find((s) => s.id === section);
		if (!target || store.disabled) {
			return;
		}
		const accountItem = ordinaryAccountItems.find(
			(item) => item.spaceId === id
		);
		if (
			accountItem &&
			!(await pin.setPinned(accountItem, section === "pinned"))
		) {
			return;
		}
		const ids = moveSidebarItemIds(
			target.spaceIds,
			rows(section).map((c) => c.spaceId),
			id,
			before
		);
		if (section === "pinned") {
			save({ ...preferences, pinned: { sort: "manual", spaceIds: ids } });
			return;
		}
		save({
			...preferences,
			pinned: {
				...preferences.pinned,
				spaceIds: preferences.pinned.spaceIds.filter((v) => v !== id),
			},
			spaces:
				section === "chats"
					? { sort: "manual", spaceIds: ids }
					: {
							...preferences.spaces,
							spaceIds: preferences.spaces.spaceIds.filter((v) => v !== id),
						},
			groups: preferences.groups.map((g) =>
				g.id === section
					? { ...g, sort: "manual", spaceIds: ids }
					: { ...g, spaceIds: g.spaceIds.filter((v) => v !== id) }
			),
		});
	};
	const unpin = async (id: string) => {
		const accountItem = ordinaryAccountItems.find(
			(item) => item.spaceId === id
		);
		if (accountItem && !(await pin.setPinned(accountItem, false))) {
			return;
		}
		save({
			...preferences,
			pinned: {
				...preferences.pinned,
				spaceIds: preferences.pinned.spaceIds.filter((value) => value !== id),
			},
		});
	};
	return {
		isArchived,
		setArchived,
		move,
		unpin,
		pin,
		org,
		profileId,
		profilesQuery,
		needsDefaultHumanProfile: input.currentProfileId === undefined,
		store,
		spaces,
		directory,
		sessions,
		chats,
		ordinaryAccountItems,
		preferences,
		previews,
		activity,
		chatPath,
		inbox,
		attentionById,
		indicators,
		selected,
		save,
		sections,
		sortSection,
		title,
		owner,
		rows,
	};
}
