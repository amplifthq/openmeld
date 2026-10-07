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
	hasPendingInboxReads,
	optimisticallyReadInbox,
} from "#/query/organizations/inbox-optimistic-read";

export function useInboxItemReadMutation(input: {
	onAnnouncement?: (message: string) => void;
	organizationId: string;
}) {
	const queryClient = useQueryClient();
	const mutation = useMutation<
		MarkInboxItemReadResponse,
		InboxFailure,
		{ item: InboxItem; read: boolean },
		ReturnType<typeof optimisticallyReadInbox>
	>({
		mutationFn: async (variables) =>
			await markCurrentInboxItemRead({
				itemId: variables.item.id,
				organizationId: input.organizationId,
				read: variables.read,
			}),
		onError: (_error, variables, context) => {
			context?.settle(false);
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
			return optimisticallyReadInbox(
				queryClient,
				input.organizationId,
				variables
			);
		},
		onSettled: async () => {
			if (hasPendingInboxReads(queryClient, input.organizationId)) {
				return;
			}
			await invalidateInboxFacts({
				organizationId: input.organizationId,
				queryClient,
			});
		},
		onSuccess: (_response, variables, context) => {
			context?.settle(true);
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
