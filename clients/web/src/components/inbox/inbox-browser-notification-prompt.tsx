"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@openmeld/ui/components/alert-dialog";
import { useEffect, useState } from "react";
import {
	dismissInboxBrowserNotificationPrompt,
	readInboxBrowserNotificationPromptDismissed,
	subscribeInboxBrowserNotificationSettings,
} from "#/lib/inbox/browser-notifications";
import { useInboxBrowserNotificationSettings } from "./use-inbox-browser-notification-settings";

type PromptState = {
	dismissed: boolean;
	userId: string | null;
};

export function InboxBrowserNotificationPrompt(input: { userId: string }) {
	const { error, isPending, setEnabled, settings } =
		useInboxBrowserNotificationSettings(input.userId);
	const [promptState, setPromptState] = useState<PromptState>({
		dismissed: true,
		userId: null,
	});

	useEffect(() => {
		const refresh = () => {
			setPromptState({
				dismissed: readInboxBrowserNotificationPromptDismissed({
					userId: input.userId,
				}),
				userId: input.userId,
			});
		};
		refresh();
		return subscribeInboxBrowserNotificationSettings(refresh);
	}, [input.userId]);

	const dismissed =
		promptState.userId === input.userId && promptState.dismissed;
	const open = settings?.permission === "default" && !dismissed;
	const dismiss = () => {
		dismissInboxBrowserNotificationPrompt({ userId: input.userId });
		setPromptState({ dismissed: true, userId: input.userId });
	};

	return (
		<AlertDialog
			onOpenChange={(nextOpen) => {
				if (!(nextOpen || isPending)) {
					dismiss();
				}
			}}
			open={open}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Stay on top of important work</AlertDialogTitle>
					<AlertDialogDescription>
						Get a browser notification when someone directly addresses you,
						something needs your action, or work you requested finishes. You can
						turn this off anytime.
					</AlertDialogDescription>
				</AlertDialogHeader>
				{error ? (
					<p className="text-destructive text-sm" role="alert">
						{error}
					</p>
				) : null}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>Not now</AlertDialogCancel>
					<AlertDialogAction
						disabled={isPending}
						onClick={(event) => {
							event.preventDefault();
							setEnabled(true).catch((enableError: unknown) => {
								console.warn(
									"[openmeld.web.inbox.browser_notification_prompt_enable_failed]",
									{
										error:
											enableError instanceof Error
												? enableError.message
												: String(enableError),
									}
								);
							});
						}}
						type="button"
					>
						{isPending ? "Enabling…" : "Enable notifications"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
