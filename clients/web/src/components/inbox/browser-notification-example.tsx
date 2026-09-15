"use client";

import { Button } from "@openmeld/ui/components/button";
import { useEffect, useRef, useState } from "react";
import { showInboxBrowserNotificationExample } from "#/lib/inbox/browser-notifications";

export function BrowserNotificationExample(input: {
	userId: string;
	enabled: boolean;
}) {
	const [status, setStatus] = useState<{
		error: boolean;
		message: string;
	} | null>(null);
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
		<div className="space-y-2">
			<Button
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
								setStatus({
									error: true,
									message:
										"The browser could not show the example. Check your browser and system notification settings.",
								});
							}
						};
						setStatus({
							error: false,
							message:
								"Example requested. If nothing appears, check your system notification settings and Focus or Do Not Disturb.",
						});
					} catch (error) {
						setStatus({
							error: true,
							message:
								error instanceof Error
									? error.message
									: "The example could not be shown.",
						});
					}
				}}
				size="sm"
				variant="outline"
			>
				Show an example
			</Button>
			{status ? (
				<p
					className={
						status.error
							? "text-destructive text-xs"
							: "text-muted-foreground text-xs"
					}
					role={status.error ? "alert" : "status"}
				>
					{status.message}
				</p>
			) : null}
		</div>
	);
}
