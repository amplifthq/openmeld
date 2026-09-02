"use client";

import type { InboxNotificationPreferencesResponse } from "@openmeld/schemas/types";
import { SettingsRow } from "@openmeld/ui/components/settings-row";
import { SettingsSection } from "@openmeld/ui/components/settings-section";
import { Switch } from "@openmeld/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppPageHeader } from "#/components/app/app-page-header";
import { useAppShellAccount } from "#/components/app/app-shell-account";
import { BrowserNotificationControl } from "#/components/inbox/browser-notification-toggle";
import { useInboxBrowserNotificationSettings } from "#/components/inbox/use-inbox-browser-notification-settings";
import { resolveBrowserNotificationDescription } from "#/lib/inbox/browser-notifications";
import { updateCurrentInboxNotificationPreferences } from "#/lib/organizations/inbox";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	inboxNotificationPreferencesQueryOptions,
	inboxQueryKeys,
} from "#/query/organizations/inbox";

export function NotificationsSection() {
	const queryClient = useQueryClient();
	const account = useAppShellAccount();
	const { currentOrganization, currentUserId } = useAppOrganization();
	const {
		error: browserError,
		isPending: browserPending,
		setEnabled: updateBrowserNotifications,
		setSoundEnabled: updateBrowserNotificationSounds,
		soundError,
		settings: browserSettings,
	} = useInboxBrowserNotificationSettings(currentUserId);
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

	if (!browserSettings) {
		return null;
	}

	const browserDescription = resolveBrowserNotificationDescription(
		browserSettings.permission
	);

	const emailDescription = account.email?.trim()
		? `Send urgent Inbox items to ${account.email.trim()}. You can turn this off at any time.`
		: "Send urgent Inbox items to your verified account email. You can turn this off at any time.";
	const emailStatus = resolveSettingsRowStatus({
		hasError: emailMutation.isError || preferencesQuery.isError,
		isPending: emailMutation.isPending,
		isSaved: emailMutation.isSuccess,
	});
	const browserStatus = resolveSettingsRowStatus({
		hasError: browserError !== null,
		isPending: browserPending,
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
						<BrowserNotificationControl
							disabled={browserPending}
							onChange={updateBrowserNotifications}
							settings={browserSettings}
						/>
					}
					description={browserDescription}
					error={browserError ?? undefined}
					label="Browser notifications"
					status={browserStatus}
				/>
				<SettingsRow
					control={
						<Switch
							aria-label="Play OpenMeld sounds"
							checked={browserSettings.soundEnabled}
							onCheckedChange={updateBrowserNotificationSounds}
						/>
					}
					description="Play an OpenMeld sound when a browser notification appears on this device. Browser and system notification sounds are controlled separately."
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
