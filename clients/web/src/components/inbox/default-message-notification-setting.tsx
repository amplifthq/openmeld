"use client";

import { Button } from "@openmeld/ui/components/button";
import { SettingsRow } from "@openmeld/ui/components/settings-row";
import { SkeletonRows } from "@openmeld/ui/components/skeleton-content";
import { RadioGroup, RadioItem } from "@openmeld/ui/fluid/radio-group";
import {
	MESSAGE_NOTIFICATION_LABELS,
	useMessageNotificationPreferences,
} from "./use-message-notification-preferences";

const MODES = ["all_messages", "mentions_and_replies"] as const;

export function DefaultMessageNotificationSetting() {
	const { query, mutation } = useMessageNotificationPreferences();
	const error = mutation.error ?? query.error;
	const disabled = mutation.isPending || query.isError;
	const pendingStatus = mutation.isPending ? "saving" : "idle";
	const unavailableControl = query.isError ? (
		<Button onClick={() => query.refetch()} size="sm" variant="outline">
			Try again
		</Button>
	) : (
		<SkeletonRows label="Loading notification preferences" rows={2} />
	);
	return (
		<SettingsRow
			control={
				query.data ? (
					<RadioGroup
						aria-label="Default message notifications"
						className="w-full"
						orientation="horizontal"
						selectedIndex={MODES.indexOf(query.data.defaultMode)}
					>
						{MODES.map((mode, index) => (
							<RadioItem
								aria-disabled={disabled}
								className="min-w-0 flex-1"
								description={
									mode === "all_messages"
										? "Messages and thread updates."
										: "Direct messages, @mentions, and replies to you."
								}
								index={index}
								key={mode}
								label={MESSAGE_NOTIFICATION_LABELS[mode]}
								onSelect={() => {
									if (!disabled) {
										mutation.mutate({ scope: "account", mode });
									}
								}}
								selected={query.data.defaultMode === mode}
							/>
						))}
					</RadioGroup>
				) : (
					unavailableControl
				)
			}
			description="Applies across organizations. You can change this for each conversation."
			error={error?.message}
			label="Default message notifications"
			layout="stacked"
			status={error ? "error" : pendingStatus}
		/>
	);
}
