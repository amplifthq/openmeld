"use client";

import type { InboxNotificationPreferencesResponse } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { SettingsRow } from "@openmeld/ui/components/settings-row";
import { SettingsSection } from "@openmeld/ui/components/settings-section";
import { Switch } from "@openmeld/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppPageHeader } from "#/components/app/app-page-header";
import { useAppShellAccount } from "#/components/app/app-shell-account";
import { ClientNotificationControl } from "#/components/inbox/client-notification-control";
import { useInboxNotificationSettings } from "#/components/inbox/use-inbox-notification-settings";
import { getDesktopPlatform } from "#/desktop/platform";
import { resolveClientNotificationDescription } from "#/lib/inbox/client-notifications";
import { updateCurrentInboxNotificationPreferences } from "#/lib/organizations/inbox";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	inboxNotificationPreferencesQueryOptions,
	inboxQueryKeys,
} from "#/query/organizations/inbox";

export function NotificationsSection() {
	const [testStatus, setTestStatus] = useState<string | null>(null);
	const queryClient = useQueryClient();
	const account = useAppShellAccount();
	const { currentOrganization, currentUserId } = useAppOrganization();
	const {
		error: notificationError,
		isPending: notificationPending,
		setEnabled: updateNotifications,
		setSoundEnabled: updateNotificationSounds,
		soundError,
		settings,
	} = useInboxNotificationSettings(currentUserId);
	const preferencesQuery = useQuery(
		inboxNotificationPreferencesQueryOptions({
			organizationId: currentOrganization.id,
			userId: currentUserId,
		})
	);
	const emailMutation = useMutation({
		mutationFn: async (urgentEmailEnabled: boolean) =>
			await updateCurrentInboxNotificationPreferences({
				organizationId: currentOrganization.id,
				urgentEmailEnabled,
			}),
		onError: (_error, _variables, previous) => {
			if (previous) {
				queryClient.setQueryData(
					inboxQueryKeys.preferences(currentUserId),
					previous
				);
			}
		},
		onMutate: async (urgentEmailEnabled) => {
			await queryClient.cancelQueries({
				queryKey: inboxQueryKeys.preferences(currentUserId),
			});
			const previous =
				queryClient.getQueryData<InboxNotificationPreferencesResponse>(
					inboxQueryKeys.preferences(currentUserId)
				);
			queryClient.setQueryData<InboxNotificationPreferencesResponse>(
				inboxQueryKeys.preferences(currentUserId),
				(current) => (current ? { ...current, urgentEmailEnabled } : current)
			);
			return previous;
		},
		onSuccess: (response) => {
			queryClient.setQueryData(
				inboxQueryKeys.preferences(currentUserId),
				response
			);
		},
	});

	if (!settings) {
		return null;
	}

	const notificationDescription = resolveClientNotificationDescription(
		settings.permission
	);

	const emailDescription = account.email?.trim()
		? `Send urgent Inbox items to ${account.email.trim()}. You can turn this off at any time.`
		: "Send urgent Inbox items to your verified account email. You can turn this off at any time.";
	const emailStatus = resolveSettingsRowStatus({
		hasError: emailMutation.isError || preferencesQuery.isError,
		isPending: emailMutation.isPending,
		isSaved: emailMutation.isSuccess,
	});
	const notificationStatus = resolveSettingsRowStatus({
		hasError: notificationError !== null,
		isPending: notificationPending,
		isSaved: false,
	});
	const soundStatus = resolveSettingsRowStatus({
		hasError: soundError !== null,
		isPending: false,
		isSaved: false,
	});
	const emailError = emailMutation.isError
		? emailMutation.error.message
		: preferencesQuery.error?.message;

	return (
		<>
			<AppPageHeader
				description="Choose how OpenMeld alerts you when something needs your attention."
				eyebrow="Personal"
				id="notifications-heading"
				title="Notifications"
			/>
			<SettingsSection
				description="Your Inbox always stays available. These controls only change how new items reach you."
				id="notification-delivery"
				title="Delivery"
			>
				<SettingsRow
					control={
						<ClientNotificationControl
							disabled={notificationPending}
							onChange={updateNotifications}
							settings={settings}
						/>
					}
					description={notificationDescription}
					error={notificationError ?? undefined}
					label={
						settings.permission === "unknown"
							? "Desktop notifications"
							: "Browser notifications"
					}
					status={notificationStatus}
				/>
				<SettingsRow
					control={
						<Switch
							aria-label="Play OpenMeld sounds"
							checked={settings.soundEnabled}
							onCheckedChange={updateNotificationSounds}
						/>
					}
					description={
						settings.permission === "unknown"
							? "Play a sound with Desktop notifications. Your Mac’s sound and Focus settings still apply."
							: "Play an OpenMeld sound when a browser notification appears on this device. Browser and system notification sounds are controlled separately."
					}
					error={soundError ?? undefined}
					label="Play OpenMeld sounds"
					status={soundStatus}
				/>
				<SettingsRow
					control={
						<Switch
							aria-label="Urgent email alerts"
							checked={preferencesQuery.data?.urgentEmailEnabled ?? true}
							disabled={
								preferencesQuery.isPending ||
								preferencesQuery.isError ||
								emailMutation.isPending
							}
							onCheckedChange={(checked) => emailMutation.mutate(checked)}
						/>
					}
					description={emailDescription}
					error={emailError}
					label="Urgent email alerts"
					showDivider={false}
					status={emailStatus}
				/>
			</SettingsSection>
			{settings.permission === "unknown" ? (
				<div className="space-y-2">
					<Button
						onClick={async () => {
							try {
								const result = await getDesktopPlatform()?.testNotification({
									userId: currentUserId,
									soundEnabled: settings.soundEnabled,
								});
								setTestStatus(
									result === "delivered"
										? "Test sent to macOS. Focus and notification settings control how it appears."
										: "The test could not be delivered. Check OpenMeld in your Mac’s notification settings and try again."
								);
							} catch {
								setTestStatus("The test could not be sent. Try again.");
							}
						}}
						size="sm"
						variant="outline"
					>
						Send test notification
					</Button>
					{testStatus ? (
						<output className="text-muted-foreground text-sm">
							{testStatus}
						</output>
					) : null}
				</div>
			) : null}
		</>
	);
}

function resolveSettingsRowStatus(input: {
	hasError: boolean;
	isPending: boolean;
	isSaved: boolean;
}): "error" | "idle" | "saved" | "saving" {
	if (input.isPending) {
		return "saving";
	}
	if (input.hasError) {
		return "error";
	}
	return input.isSaved ? "saved" : "idle";
}
