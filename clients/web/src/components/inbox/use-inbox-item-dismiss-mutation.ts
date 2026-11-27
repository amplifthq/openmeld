"use client";

import type {
	DismissInboxItemResponse,
	InboxItem,
} from "@openmeld/schemas/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import {
	dismissCurrentInboxItem,
	type InboxFailure,
} from "#/lib/organizations/inbox";
import {
	inboxQueryKeys,
	invalidateInboxFacts,
} from "#/query/organizations/inbox";
import {
	captureInboxCacheSnapshots,
	type InboxCacheSnapshots,
	removeCachedInboxItem,
	restoreInboxCacheSnapshots,
} from "./inbox-page-cache";

export function useInboxItemDismissMutation(input: {
	onAnnouncement?: (message: string) => void;
	onDismissed?: (itemId: string) => void;
	organizationId: string;
}) {
	const queryClient = useQueryClient();
	const mutation = useMutation<
		DismissInboxItemResponse,
		InboxFailure,
		{ item: InboxItem; completed: boolean },
		InboxCacheSnapshots
	>({
		mutationFn: async ({ item }) =>
			await dismissCurrentInboxItem({
				itemId: item.id,
				organizationId: input.organizationId,
			}),
		onError: (_error, { item, completed }, context) => {
			restoreInboxCacheSnapshots(queryClient, context);
			input.onAnnouncement?.(
				completed
					? `Could not complete ${item.title}.`
					: `Could not remove ${item.title} from Inbox.`
			);
			toast.error(
				completed
					? "Could not complete this TODO."
					: "Could not remove this item from Inbox."
			);
		},
		onMutate: async ({ item }) => {
			await queryClient.cancelQueries({
				queryKey: inboxQueryKeys.organization(input.organizationId),
			});
			const context = captureInboxCacheSnapshots(
				queryClient,
				input.organizationId
			);
			removeCachedInboxItem({
				item,
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
		onSuccess: (response, { item, completed }) => {
			input.onAnnouncement?.(
				completed
					? `${item.title} completed in TODO.`
					: `${item.title} removed from Inbox.`
			);
			input.onDismissed?.(response.dismissedItemId);
		},
	});

	const dismiss = useCallback(
		(item: InboxItem) => mutation.mutate({ item, completed: false }),
		[mutation.mutate]
	);

	const complete = useCallback(
		(item: InboxItem) => mutation.mutate({ item, completed: true }),
		[mutation.mutate]
	);
	return { dismiss, complete, isPending: mutation.isPending };
}
