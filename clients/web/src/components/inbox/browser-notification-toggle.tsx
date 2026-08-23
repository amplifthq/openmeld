"use client";

import { Button } from "@openmeld/ui/components/button";
import { Switch } from "@openmeld/ui/components/switch";
import type { InboxBrowserNotificationSettings } from "#/lib/inbox/browser-notifications";

export function BrowserNotificationControl(input: {
	disabled: boolean;
	onChange: (enabled: boolean) => Promise<void> | void;
	settings: InboxBrowserNotificationSettings;
}) {
	if (
		input.settings.permission === "unsupported" ||
		input.settings.permission === "denied"
	) {
		return (
			<Switch aria-label="Browser notifications" checked={false} disabled />
		);
	}
	if (input.settings.permission === "default") {
		return (
			<Button
				disabled={input.disabled}
				onClick={() => input.onChange(true)}
				size="sm"
				variant="outline"
			>
				{input.disabled ? "Enabling…" : "Enable"}
			</Button>
		);
	}
	return (
		<Switch
			aria-label="Browser notifications"
			checked={input.settings.enabled}
			disabled={input.disabled}
			onCheckedChange={input.onChange}
		/>
	);
}

export function resolveBrowserNotificationDescription(
	permission: InboxBrowserNotificationSettings["permission"]
): string {
	if (permission === "unsupported") {
		return "This browser does not support notifications. Your Inbox is still available in OpenMeld.";
	}
	if (permission === "denied") {
		return "Notifications are blocked. Allow them in your browser’s site settings, then return here.";
	}
	return "Notify for directly addressed messages, actions, and urgent items in this browser. Applies to every Space and Direct Message.";
}
