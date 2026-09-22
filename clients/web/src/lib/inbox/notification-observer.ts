import {
	isInboxItemInOrganizationScope,
	isInboxNotificationEligible,
} from "@openmeld/api-client";
import type { InboxNotificationObservationsResponse } from "@openmeld/schemas/types";
import { observeCurrentInboxNotifications } from "#/lib/organizations/inbox";
import {
	INBOX_NOTIFICATION_STORAGE_UNAVAILABLE_MESSAGE,
	markInboxNotificationItemPending,
	recheckPendingWriteAvailability,
} from "./client-notifications";

/** One bounded page per refresh. Core owns insertion order; the existing pending
 * ledger owns retry. Never advance the cursor past an item we failed to retain.
 * A new reader first establishes a baseline, so old unread history is not replayed. */
export function createInboxNotificationObserver(input: {
	deliveryEnabled: boolean;
	organizationId: string;
	userId: string;
}): (signal?: AbortSignal) => Promise<InboxNotificationObservationsResponse> {
	let cursor: string | undefined;
	return async (signal) => {
		signal?.throwIfAborted();
		const response = await observeCurrentInboxNotifications({
			organizationId: input.organizationId,
			cursor,
			limit: 50,
			signal,
		});
		signal?.throwIfAborted();
		if (
			response.organizationId !== input.organizationId ||
			response.items.some(
				(item) =>
					item.recipientUserId !== input.userId ||
					!isInboxItemInOrganizationScope(item, input.organizationId)
			)
		) {
			throw new Error("Inbox notification observation scope mismatch.");
		}
		if (input.deliveryEnabled) {
			// Once per authorized refresh, including empty pages. The failed item may
			// now be read, resolved, or inaccessible, so it cannot own recovery.
			recheckPendingWriteAvailability();
		}
		for (const item of response.items) {
			if (
				!input.deliveryEnabled ||
				item.readAt !== null ||
				!isInboxNotificationEligible(item, "all_messages")
			) {
				continue;
			}
			if (!markInboxNotificationItemPending({ ...input, itemId: item.id })) {
				throw new Error(INBOX_NOTIFICATION_STORAGE_UNAVAILABLE_MESSAGE);
			}
		}
		cursor = response.cursor;
		return response;
	};
}
