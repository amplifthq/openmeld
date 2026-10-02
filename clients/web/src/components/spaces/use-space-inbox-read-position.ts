import type { SpaceInboxUnreadTarget } from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
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
	const query = useQuery(
		spaceInboxUnreadTargetsQueryOptions({
			enabled: input.organizationId !== null,
			organizationId: input.organizationId ?? "",
			spaceId: input.spaceId,
		})
	);
	const writes = useRef(Promise.resolve());
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
		(targets: readonly SpaceInboxUnreadTarget[]) => {
			const organizationId = input.organizationId;
			if (!organizationId || targets.length === 0) {
				return Promise.resolve();
			}
			const write = writes.current
				.catch(() => undefined)
				.then(async () => {
					const items = targets.map((target) => {
						if (!target.itemId) {
							throw new Error(
								"Unread updates are still loading. Refresh this Space and try again."
							);
						}
						return { itemId: target.itemId, occurredAtMs: target.occurredAtMs };
					});
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
			},
		};
	}, [input.organizationId, input.spaceId, refresh]);
	return {
		isReady: query.isSuccess,
		targets: query.data?.targets ?? [],
		scopes: query.data?.scopes,
		totalUnreadCount: query.data?.totalUnreadCount ?? 0,
		markViewed,
		prepareMarkAllRead,
	};
}
