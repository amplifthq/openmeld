"use client";

import { BrowserNotificationControl } from "#/components/inbox/browser-notification-toggle";
import { useInboxBrowserNotificationSettings } from "#/components/inbox/use-inbox-browser-notification-settings";
import { resolveBrowserNotificationDescription } from "#/lib/inbox/browser-notifications";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";

/**
 * Global browser-notification switch surfaced inside Space Info.
 *
 * Phase 1 has no per-Space subscriptions: this is the same global, per-browser
 * preference as Settings -> Personal -> Notifications, shown here so members
 * can discover and flip it from any conversation. The copy must keep saying
 * "everywhere" so the control is never mistaken for a per-Space toggle.
 */
export function SpaceInfoNotificationsSection() {
	const organization = useOptionalAppOrganization();
	const currentUserId = organization?.currentUserId;
	const { error, isPending, setEnabled, settings } =
		useInboxBrowserNotificationSettings(currentUserId);

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
					Browser notifications for every Space and Direct Message in this
					browser — not just this one. Same setting as Settings → Personal →
					Notifications.
				</p>
			</div>
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<p className="text-sm">Browser notifications</p>
					<p className="text-muted-foreground text-xs">{statusDescription}</p>
				</div>
				<BrowserNotificationControl
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
	permission: Parameters<typeof resolveBrowserNotificationDescription>[0];
}): string {
	if (input.permission !== "granted") {
		return resolveBrowserNotificationDescription(input.permission);
	}
	return input.enabled
		? "On for all conversations while OpenMeld runs in the background."
		: "Off for all conversations.";
}
