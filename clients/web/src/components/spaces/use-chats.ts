import { createCenterAgentApi } from "@openmeld/api-client";
import type {
	AccountSidebarPreferences,
	ListCenterAgentSessionsResponse,
} from "@openmeld/schemas";
import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { moveSidebarItemIds } from "#/components/app/sidebar-order";
import { useSidebarPreferences } from "#/components/app/use-sidebar-preferences";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationCenterAgentChatPath,
	buildOrganizationDirectMessagePath,
} from "#/lib/organizations/organization-routes";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import { spaceInboxSummaryQueryOptions } from "#/query/organizations/inbox";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import {
	resolveAccountSpaceViewerProfileId,
	selectAccountSpaceSections,
} from "./account-space-sections";
import { type Chat, mergeChatPreferences } from "./chat-sidebar-model";
import { resolveDirectMessagePeer } from "./direct-message-peer";
import { spaceMessagePreviewQueryOptions } from "./direct-message-preview";
import {
	resolveSidebarAttentionSpaceIds,
	sortSidebarSpaces,
} from "./sidebar-space-order";
import { useAccountSpacePinMutation } from "./use-account-space-pin-mutation";
import { useSpaceListIndicators } from "./use-space-list-indicators";

type Preferences = NonNullable<AccountSidebarPreferences["chats"]>;

export function useChats(input: {
	currentSpaceId?: string;
	search: string;
	archived: boolean;
	includes: (kind: string) => boolean;
}) {
	const { currentOrganization: org } = useAppOrganization();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const profileId = defaultHumanProfile?.openMeldProfileId ?? "";
	const store = useSidebarPreferences(profileId, org.id);
	const spaces = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: !!profileId,
			profileId,
			scope: "account",
		})
	);
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
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
	const sessions = useInfiniteQuery({
		queryKey: ["center-agent", org.id, profileId, "sessions", "sidebar"],
		enabled: !!profileId,
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (page: ListCenterAgentSessionsResponse) =>
			page.nextCursor ?? undefined,
		queryFn: ({ signal, pageParam }) => {
			const api = createCenterAgentApi(
				createOrganizationScopedWebOpenMeldApiFoundation({
					organizationId: org.id,
				})
			);
			return api.listSessions({ limit: 100, cursor: pageParam, signal });
		},
		staleTime: 30_000,
	});
	const chatsById = new Map<string, Chat>(
		accountItems.map((item) => {
			const viewerProfileId = resolveAccountSpaceViewerProfileId({
				currentProfileId: profileId,
				item,
			});
			const peer = resolveDirectMessagePeer({
				item,
				profileDirectory: directory.data,
				viewerProfileId,
			});
			return [
				item.spaceId,
				{
					spaceId: item.spaceId,
					name: peer?.profileName ?? item.spaceName,
					createdAt: item.spaceCreatedAt ?? null,
					viewerProfileId,
					peer,
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
		});
	}
	const chats = [...chatsById.values()];
	const ordinaryAccountItems = accountItems.filter(
		(item) => !chatsById.get(item.spaceId)?.session
	);
	const preferences = mergeChatPreferences(
		store.preferences,
		ordinaryAccountItems
	);
	const previews = useQueries({
		queries: chats.map((chat) =>
			spaceMessagePreviewQueryOptions({
				spaceId: chat.spaceId,
				viewerProfileId: chat.viewerProfileId ?? profileId,
				enabled: !!profileId,
			})
		),
	});
	const activity = new Map(
		chats.map((chat, index) => [
			chat.spaceId,
			previews[index]?.data?.timestamp ??
				(Date.parse(chat.createdAt ?? "") || 0),
		])
	);
	const chatPath = (chat: Chat) =>
		chat.session
			? buildOrganizationCenterAgentChatPath(org.slug, {
					session: chat.spaceId,
				})
			: buildOrganizationDirectMessagePath({
					orgSlug: org.slug,
					spaceId: chat.spaceId,
					search: { profileId: chat.viewerProfileId ?? profileId },
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
	const sections = [
		{ id: "pinned", name: "Pinned", ...preferences.pinned },
		...preferences.groups,
		{ id: "chats", name: "Chats", ...preferences.spaces },
	];
	const title = (chat: Chat) =>
		preferences.titles[chat.spaceId] ?? chat.name ?? "New chat";
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
					chat.session ? "agent" : (chat.peer?.profileKind ?? "unknown")
				) &&
				preferences.archivedIds.includes(chat.spaceId) === input.archived &&
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
		move,
		unpin,
		pin,
		org,
		profileId,
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
