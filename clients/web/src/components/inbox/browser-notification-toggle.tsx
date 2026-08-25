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
