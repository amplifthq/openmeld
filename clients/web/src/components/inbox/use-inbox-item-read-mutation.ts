"use client";

import type {
	InboxItem,
	MarkInboxItemReadResponse,
} from "@openmeld/schemas/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import {
	type InboxFailure,
	markCurrentInboxItemRead,
} from "#/lib/organizations/inbox";
import {
	inboxQueryKeys,
	invalidateInboxFacts,
} from "#/query/organizations/inbox";
import {
	captureInboxCacheSnapshots,
	type InboxCacheSnapshots,
	restoreInboxCacheSnapshots,
	updateCachedInboxItem,
	updateCachedInboxUnreadCount,
} from "./inbox-page-cache";

export function useInboxItemReadMutation(input: {
	onAnnouncement?: (message: string) => void;
	organizationId: string;
}) {
	const queryClient = useQueryClient();
	const mutation = useMutation<
		MarkInboxItemReadResponse,
		InboxFailure,
		{ item: InboxItem; read: boolean },
		InboxCacheSnapshots
	>({
		mutationKey: [
			...inboxQueryKeys.organization(input.organizationId),
			"mutation",
		],
		mutationFn: async (variables) =>
			await markCurrentInboxItemRead({
				itemId: variables.item.id,
				organizationId: input.organizationId,
				read: variables.read,
			}),
		onError: (_error, variables, context) => {
			restoreInboxCacheSnapshots(queryClient, context);
			input.onAnnouncement?.(
				`Could not mark ${variables.item.title} as ${
					variables.read ? "read" : "unread"
				}.`
			);
			toast.error(
				`Could not mark this item as ${variables.read ? "read" : "unread"}.`
			);
		},
		onMutate: async (variables) => {
			await queryClient.cancelQueries({
				queryKey: inboxQueryKeys.organization(input.organizationId),
			});
			const context = captureInboxCacheSnapshots(
				queryClient,
				input.organizationId
			);
			const readAt = variables.read ? new Date().toISOString() : null;
			updateCachedInboxItem({
				itemId: variables.item.id,
				organizationId: input.organizationId,
				queryClient,
				update: (item) => ({ ...item, readAt }),
			});
			updateCachedInboxUnreadCount({
				delta: variables.read ? -1 : 1,
				organizationId: input.organizationId,
				queryClient,
			});
			return context;
		},
		onSettled: async () => {
			await invalidateInboxFacts({
				organizationId: input.organizationId,
				queryClient,
			});
		},
		onSuccess: (response, variables) => {
			updateCachedInboxItem({
				itemId: variables.item.id,
				organizationId: input.organizationId,
				queryClient,
				update: () => response.item,
			});
			input.onAnnouncement?.(
				`${variables.item.title} marked as ${
					variables.read ? "read" : "unread"
				}.`
			);
		},
	});

	const setRead = useCallback(
		(item: InboxItem, read: boolean) => {
			if ((item.readAt !== null) === read) {
				return;
			}
			mutation.mutate({ item, read });
		},
		[mutation.mutate]
	);

	return {
		isPending: mutation.isPending,
		setRead,
	};
}
