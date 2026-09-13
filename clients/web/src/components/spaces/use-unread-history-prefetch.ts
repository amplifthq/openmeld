import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { createUnreadHistoryPrefetcher } from "#/query/spaces/unread-history-prefetch";
import type { SpaceUnreadById } from "./account-space-sections";

export function useUnreadHistoryPrefetch(input: {
	accountId: string;
	organizationId: string;
	activeSpaceId?: string | null;
	conversations: readonly { spaceId: string; profileId: string }[];
	unread: SpaceUnreadById;
}) {
	const queryClient = useQueryClient();
	const prefetcher = useRef<ReturnType<
		typeof createUnreadHistoryPrefetcher
	> | null>(null);
	const targets = JSON.stringify(
		input.conversations
			.flatMap((conversation) => {
				const unread = input.unread.get(conversation.spaceId);
				if (
					conversation.spaceId === input.activeSpaceId ||
					!conversation.profileId ||
					!unread?.unreadCount
				) {
					return [];
				}
				return [
					{
						spaceId: conversation.spaceId,
						openMeldProfileId: conversation.profileId,
						revision: unread.latestUnreadOccurredAtMs ?? 0,
					},
				];
			})
			.sort((a, b) => b.revision - a.revision)
	);
	const targetsRef = useRef(targets);
	targetsRef.current = targets;
	useEffect(() => {
		if (!(input.accountId && input.organizationId)) {
			return;
		}
		const owner = createUnreadHistoryPrefetcher(queryClient);
		prefetcher.current = owner;
		const schedule = () =>
			owner.schedule(
				document.visibilityState === "visible" && navigator.onLine
					? JSON.parse(targetsRef.current)
					: []
			);
		schedule();
		document.addEventListener("visibilitychange", schedule);
		window.addEventListener("online", schedule);
		window.addEventListener("offline", schedule);
		return () => {
			owner.dispose();
			prefetcher.current = null;
			document.removeEventListener("visibilitychange", schedule);
			window.removeEventListener("online", schedule);
			window.removeEventListener("offline", schedule);
		};
	}, [queryClient, input.accountId, input.organizationId]);
	useEffect(() => {
		prefetcher.current?.schedule(
			document.visibilityState === "visible" && navigator.onLine
				? JSON.parse(targets)
				: []
		);
	}, [targets]);
}
