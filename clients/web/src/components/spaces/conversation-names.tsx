import type { InboxItem } from "@openmeld/schemas/types";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import {
	type ConversationName,
	presentInboxConversation,
	resolveConversationTitle,
} from "#/lib/conversations/presentation";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import { accountSidebarQueryOptions } from "#/query/account/sidebar-preferences";
import { centerAgentSessionsQueryOptions } from "#/query/organizations/center-agent-sessions";
import { organizationProfileIdentityDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import {
	isDirectMessageItem,
	resolveAccountSpaceViewerProfileId,
} from "./account-space-sections";
import { resolveDirectMessagePresentation } from "./direct-message-presentation";

export type ConversationNames = {
	organizationId: string;
	userId: string;
	names: ReadonlyMap<string, ConversationName>;
};
export const ConversationNamesContext = createContext<ConversationNames | null>(
	null
);

/** One derived presentation over the sidebar's existing authorized query caches. */
export function ConversationNamesProvider({
	children,
}: {
	children: ReactNode;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const profileId = defaultHumanProfile?.openMeldProfileId ?? "";
	const sidebar = useQuery(
		accountSidebarQueryOptions(currentUserId, currentOrganization.id)
	);
	const sessions = useInfiniteQuery(
		centerAgentSessionsQueryOptions(currentOrganization.id, profileId)
	);
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
			organizationId: currentOrganization.id,
		})
	);
	const value = useMemo(() => {
		const names = new Map<string, ConversationName>();
		const titles = sidebar.data?.preferences.chats?.titles;
		// Personal titles also cover archived chats and unloaded session pages.
		for (const [spaceId, name] of Object.entries(titles ?? {})) {
			names.set(spaceId, { name });
		}
		for (const item of [
			...(spaces.data?.pinnedItems ?? []),
			...(spaces.data?.spaceItems ?? []),
		]) {
			if (item.organizationId !== currentOrganization.id) {
				continue;
			}
			const direct = isDirectMessageItem(item);
			const presentation = direct
				? resolveDirectMessagePresentation({
						item,
						profileDirectory: directory.data,
						viewerUserId: currentUserId,
						viewerProfileId: resolveAccountSpaceViewerProfileId({
							currentProfileId: profileId,
							item,
						}),
					})
				: null;
			names.set(item.spaceId, {
				name: direct
					? resolveConversationTitle(
							item.spaceId,
							presentation?.name ?? item.spaceName,
							titles
						)
					: item.spaceName,
				sourceName: item.spaceName,
			});
		}
		for (const session of sessions.data?.pages.flatMap(
			(page) => page.sessions
		) ?? []) {
			names.set(session.spaceId, {
				name: resolveConversationTitle(session.spaceId, session.name, titles),
				sourceName: session.name,
			});
		}
		return {
			organizationId: currentOrganization.id,
			userId: currentUserId,
			names,
		};
	}, [
		currentOrganization.id,
		currentUserId,
		sidebar.data,
		spaces.data,
		sessions.data,
		directory.data,
		profileId,
	]);
	return (
		<ConversationNamesContext value={value}>
			{children}
		</ConversationNamesContext>
	);
}

export function useConversationNames() {
	return useContext(ConversationNamesContext);
}

export function presentInboxItem(
	item: InboxItem,
	context: ConversationNames | null
): InboxItem {
	if (
		!context ||
		item.organizationId !== context.organizationId ||
		item.recipientUserId !== context.userId
	) {
		return item;
	}
	const target = item.sourceTarget;
	return presentInboxConversation(
		item,
		"spaceId" in target && target.spaceId
			? context.names.get(target.spaceId)
			: undefined
	);
}
