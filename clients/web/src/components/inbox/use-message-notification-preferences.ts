"use client";

import type { UpdateInboxMessageNotificationPreferencesBody } from "@openmeld/schemas/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	getCurrentInboxMessageNotificationPreferences,
	updateCurrentInboxMessageNotificationPreferences,
} from "#/lib/organizations/inbox";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { inboxQueryKeys } from "#/query/organizations/inbox";

export const MESSAGE_NOTIFICATION_LABELS = {
	all_messages: "All new messages",
	mentions_and_replies: "Mentions and replies",
	muted: "Mute message notifications",
} as const;

export function useMessageNotificationPreferences(spaceId?: string) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const organizationId = currentOrganization.id;
	const queryClient = useQueryClient();
	const rootKey = ["message-notification-preferences", currentUserId];
	const queryKey = [...rootKey, organizationId, spaceId ?? null];
	const query = useQuery({
		queryKey,
		queryFn: ({ signal }) =>
			getCurrentInboxMessageNotificationPreferences({
				organizationId,
				spaceId,
				signal,
			}),
		staleTime: 0,
		refetchOnWindowFocus: true,
	});
	const mutation = useMutation({
		mutationKey: queryKey,
		mutationFn: (preference: UpdateInboxMessageNotificationPreferencesBody) =>
			updateCurrentInboxMessageNotificationPreferences({
				organizationId,
				preference,
			}),
		onSuccess: async () => {
			// An account default affects inherited conversations in every Organization.
			// Refetch the owning server projection instead of deriving saved state.
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: rootKey }),
				queryClient.invalidateQueries({
					queryKey: [...inboxQueryKeys.lists(organizationId), "attention"],
				}),
				queryClient.invalidateQueries({
					queryKey: inboxQueryKeys.summary(organizationId),
				}),
			]);
		},
	});
	return { query, mutation };
}
