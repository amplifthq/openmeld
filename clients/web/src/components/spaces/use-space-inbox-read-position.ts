import type { SpaceInboxUnreadTarget } from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useInboxVisibleConversation } from "#/components/inbox/inbox-visible-conversation";
import { isInboxDocumentFocused } from "#/lib/inbox/desktop-notifications";
import { mutateCurrentSpaceInboxRead } from "#/lib/organizations/inbox";
import {
	inboxQueryKeys,
	invalidateInboxFacts,
	spaceInboxUnreadTargetsQueryOptions,
} from "#/query/organizations/inbox";
import {
	optimisticallyMarkSpaceInboxItemsRead,
	type SpaceInboxUnreadDestination,
} from "#/query/organizations/inbox-read-through-cache";

export function useSpaceInboxReadPosition(input: {
	destination: SpaceInboxUnreadDestination;
	organizationId: string | null;
	profileId: string;
	spaceId: string;
}) {
	const queryClient = useQueryClient();
	const visibleConversation = useInboxVisibleConversation();
	const query = useQuery(
		spaceInboxUnreadTargetsQueryOptions({
			enabled: input.organizationId !== null,
			organizationId: input.organizationId ?? "",
			spaceId: input.spaceId,
		})
	);
	const writes = useRef(Promise.resolve());
	const joinedWrites = useRef(new Set<string>());
	const [readBoundaryVersion, setReadBoundaryVersion] = useState(0);
	const refresh = useCallback(
		() =>
			input.organizationId
				? invalidateInboxFacts({
						organizationId: input.organizationId,
						queryClient,
					})
				: Promise.resolve(),
		[input.organizationId, queryClient]
	);
	const markViewed = useCallback(
		(
			targets: readonly (
				| SpaceInboxUnreadTarget
				| { itemId: string; occurredAtMs: number }
			)[]
		) => {
			const organizationId = input.organizationId;
			if (!organizationId || targets.length === 0) {
				return Promise.resolve();
			}
			const write = writes.current
				.catch(() => undefined)
				.then(async () => {
					const items = targets.flatMap((target) =>
						target.itemId
							? [{ itemId: target.itemId, occurredAtMs: target.occurredAtMs }]
							: []
					);
					await queryClient.cancelQueries({
						queryKey: inboxQueryKeys.organization(organizationId),
					});
					const optimistic = optimisticallyMarkSpaceInboxItemsRead({
						destination: input.destination,
						spaceId: input.spaceId,
						organizationId,
						queryClient,
						items,
					});
					try {
						for (let offset = 0; offset < items.length; offset += 500) {
							await mutateCurrentSpaceInboxRead({
								organizationId,
								body: {
									operation: "read",
									spaceId: input.spaceId,
									items: items.slice(offset, offset + 500),
								},
							});
						}
						const sources = targets.flatMap((target) =>
							!target.itemId && "signalId" in target
								? [
										{
											signalId: target.sourceKey ?? target.signalId,
											occurredAtMs: target.occurredAtMs,
										},
									]
								: []
						);
						for (let offset = 0; offset < sources.length; offset += 500) {
							await mutateCurrentSpaceInboxRead({
								organizationId,
								body: {
									operation: "read_sources",
									spaceId: input.spaceId,
									sources: sources.slice(offset, offset + 500),
								},
							});
						}
					} catch (error) {
						optimistic.rollback();
						await refresh().catch(() => undefined);
						throw error;
					}
					await refresh().catch((error) =>
						console.warn("Could not refresh unread updates.", error)
					);
				});
			writes.current = write;
			return write;
		},
		[
			input.destination,
			input.organizationId,
			input.spaceId,
			queryClient,
			refresh,
		]
	);
	const joinedItems = query.data?.joinedItems;
	useEffect(() => {
		if (
			!joinedItems?.length ||
			visibleConversation?.kind !== "space" ||
			visibleConversation.spaceId !== input.spaceId ||
			visibleConversation.threadRootSignalId
		) {
			return;
		}
		const acknowledge = () => {
			if (
				isInboxDocumentFocused() &&
				!joinedWrites.current.has(input.spaceId)
			) {
				joinedWrites.current.add(input.spaceId);
				markViewed(joinedItems)
					.catch((error: unknown) =>
						console.warn("Could not mark Space membership as read.", error)
					)
					.finally(() => joinedWrites.current.delete(input.spaceId));
			}
		};
		acknowledge();
		window.addEventListener("focus", acknowledge);
		document.addEventListener("visibilitychange", acknowledge);
		return () => {
			window.removeEventListener("focus", acknowledge);
			document.removeEventListener("visibilitychange", acknowledge);
		};
	}, [joinedItems, visibleConversation, input.spaceId, markViewed]);
	const prepareMarkAllRead = useCallback(async () => {
		if (!input.organizationId) {
			throw new Error("Sign in to mark updates as read.");
		}
		const organizationId = input.organizationId;
		const prepared = await mutateCurrentSpaceInboxRead({
			organizationId,
			body: { operation: "prepare", spaceId: input.spaceId },
		});
		if (prepared.operation !== "prepare") {
			throw new Error("Could not prepare unread updates. Try again.");
		}
		return {
			unreadCount: prepared.unreadCount,
			commit: async () => {
				await writes.current.catch(() => undefined);
				await mutateCurrentSpaceInboxRead({
					organizationId,
					body: {
						operation: "clear",
						spaceId: input.spaceId,
						snapshotId: prepared.snapshotId,
					},
				});
				await refresh();
				setReadBoundaryVersion((version) => version + 1);
			},
		};
	}, [input.organizationId, input.spaceId, refresh]);
	return {
		isReady: query.isSuccess,
		readBoundaryVersion,
		targets: query.data?.targets ?? [],
		scopes: query.data?.scopes,
		totalUnreadCount: query.data?.totalUnreadCount ?? 0,
		markViewed,
		prepareMarkAllRead,
	};
}
