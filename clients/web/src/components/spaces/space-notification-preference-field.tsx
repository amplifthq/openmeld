"use client";

import { inboxConversationNotificationModeSchema } from "@openmeld/schemas";
import {
	MESSAGE_NOTIFICATION_LABELS,
	useMessageNotificationPreferences,
} from "#/components/inbox/use-message-notification-preferences";

export function SpaceNotificationPreferenceField(input: { spaceId: string }) {
	const { query, mutation } = useMessageNotificationPreferences(input.spaceId);
	const error = mutation.error ?? query.error;
	return (
		<div className="grid gap-1.5">
			<label
				className="font-medium text-sm"
				htmlFor="space-message-notifications"
			>
				Message notifications
			</label>
			<select
				className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-foreground text-sm"
				disabled={!query.data || mutation.isPending}
				id="space-message-notifications"
				onChange={(event) => {
					const value = event.currentTarget.value;
					if (value === "default") {
						mutation.mutate({
							scope: "conversation",
							spaceId: input.spaceId,
							mode: null,
						});
						return;
					}
					const mode = inboxConversationNotificationModeSchema.safeParse(value);
					if (mode.success) {
						mutation.mutate({
							scope: "conversation",
							spaceId: input.spaceId,
							mode: mode.data,
						});
					}
				}}
				value={query.data?.overrideMode ?? "default"}
			>
				<option value="default">
					{query.data
						? `Use default · ${MESSAGE_NOTIFICATION_LABELS[query.data.defaultMode]}`
						: "Loading notification preferences…"}
				</option>
				{Object.entries(MESSAGE_NOTIFICATION_LABELS).map(([value, label]) => (
					<option key={value} value={value}>
						{label}
					</option>
				))}
			</select>
			{error ? (
				<p className="text-destructive text-xs" role="alert">
					{mutation.error
						? "Notification preferences could not be saved. Try again."
						: "Notification preferences could not be loaded. Try again."}
				</p>
			) : null}
		</div>
	);
}
