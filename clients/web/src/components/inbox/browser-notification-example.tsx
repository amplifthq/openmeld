"use client";

import { Button } from "@openmeld/ui/components/button";
import { useEffect, useRef } from "react";
import { showInboxBrowserNotificationExample } from "#/lib/inbox/client-notifications";

export type BrowserNotificationExampleStatus = {
	error: boolean;
	message: string;
};

export function BrowserNotificationExample(input: {
	userId: string;
	enabled: boolean;
	status: BrowserNotificationExampleStatus | null;
	onStatusChange: (status: BrowserNotificationExampleStatus) => void;
}) {
	const currentNotification = useRef<Notification | null>(null);
	useEffect(
		() => () => {
			if (currentNotification.current) {
				currentNotification.current.onerror = null;
				currentNotification.current.onshow = null;
				currentNotification.current.close();
			}
		},
		[]
	);
	return (
		<Button
			className="w-36"
			disabled={!input.enabled}
			onClick={() => {
				try {
					currentNotification.current?.close();
					const notification = showInboxBrowserNotificationExample(
						input.userId
					);
					currentNotification.current = notification;
					notification.onerror = () => {
						if (currentNotification.current === notification) {
							input.onStatusChange({
								error: true,
								message:
									"Couldn’t show the example. Check notification permissions.",
							});
						}
					};
					input.onStatusChange({
						error: false,
						message:
							"Nothing appeared? Check notification permissions and Do Not Disturb.",
					});
				} catch (error) {
					input.onStatusChange({
						error: true,
						message:
							error instanceof Error
								? error.message
								: "The example could not be shown.",
					});
				}
			}}
			size="sm"
			variant="secondary"
		>
			{input.status && !input.status.error
				? "Example requested"
				: "Show an example"}
		</Button>
	);
}
