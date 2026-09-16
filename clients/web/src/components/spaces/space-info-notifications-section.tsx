"use client";

import { ClientNotificationControl } from "#/components/inbox/client-notification-control";
import { useInboxNotificationSettings } from "#/components/inbox/use-inbox-notification-settings";
import { resolveClientNotificationDescription } from "#/lib/inbox/client-notifications";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";

/**
 * Global client-notification switch surfaced inside Space Info.
 *
 * This controls delivery on this client. The header bell owns the current
 * conversation's account-saved message preference.

 */
export function SpaceInfoNotificationsSection() {
	const organization = useOptionalAppOrganization();
	const currentUserId = organization?.currentUserId;
	const { error, isPending, setEnabled, settings } =
		useInboxNotificationSettings(currentUserId);

	if (!(currentUserId && settings)) {
		return null;
	}
	const statusDescription = resolveSpaceInfoNotificationStatusDescription({
		enabled: settings.enabled,
		permission: settings.permission,
	});

	return (
		<section className="min-w-0 border-border/60 border-t pt-4">
			<div className="mb-3 space-y-1">
				<p className="font-medium text-sm">Notifications</p>
				<p className="text-muted-foreground text-xs/relaxed">
					{settings.permission === "unknown"
						? "Applies to all your Spaces and chats on this Mac. You can also change this in Settings > Notifications."
						: "Applies to all your Spaces and chats in this browser. You can also change this in Settings > Notifications."}
					Use the bell at the top of this conversation to choose which messages
					notify you.
				</p>
			</div>
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<p className="text-sm">
						{settings.permission === "unknown"
							? "Desktop notifications"
							: "Browser notifications"}
					</p>
					<p className="text-muted-foreground text-xs">{statusDescription}</p>
				</div>
				<ClientNotificationControl
					disabled={isPending}
					onChange={setEnabled}
					settings={settings}
				/>
			</div>
			{error ? (
				<p className="mt-2 text-destructive text-xs" role="alert">
					{error}
				</p>
			) : null}
		</section>
	);
}

function resolveSpaceInfoNotificationStatusDescription(input: {
	enabled: boolean;
	permission: Parameters<typeof resolveClientNotificationDescription>[0];
}): string {
	if (input.permission !== "granted") {
		return resolveClientNotificationDescription(input.permission);
	}
	return input.enabled
		? "On. Messages follow your default and conversation settings."
		: "Off for all conversations.";
}
