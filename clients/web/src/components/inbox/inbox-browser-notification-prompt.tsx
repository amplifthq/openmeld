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
import { XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import {
	dismissInboxBrowserNotificationPrompt,
	readInboxBrowserNotificationPromptDismissed,
	subscribeInboxNotificationSettings,
} from "#/lib/inbox/client-notifications";
import { useInboxNotificationSettings } from "./use-inbox-notification-settings";

type PromptState = {
	dismissed: boolean;
	userId: string | null;
};

export function InboxBrowserNotificationPrompt(input: { userId: string }) {
	const { error, isPending, setEnabled, settings } =
		useInboxNotificationSettings(input.userId);
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
		return subscribeInboxNotificationSettings(refresh);
	}, [input.userId]);

	const dismissed =
		promptState.userId === input.userId && promptState.dismissed;
	const open = settings?.permission === "default" && !dismissed;
	const dismiss = () => {
		dismissInboxBrowserNotificationPrompt({ userId: input.userId });
		setPromptState({ dismissed: true, userId: input.userId });
	};
	if (!open) {
		return null;
	}

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
				<AlertDialogCancel
					className="absolute top-2 right-2"
					disabled={isPending}
					onClick={dismiss}
					size="icon-sm"
					variant="ghost"
				>
					<XIcon aria-hidden="true" />
					<span className="sr-only">Close notification setup</span>
				</AlertDialogCancel>
				<AlertDialogHeader>
					<AlertDialogTitle>Stay on top of important work</AlertDialogTitle>
					<AlertDialogDescription>
						Get a browser notification when someone directly addresses you,
						something needs your action, or work you requested finishes. If you
						choose Not now, you can enable notifications later in Settings &gt;
						Notifications.
					</AlertDialogDescription>
				</AlertDialogHeader>
				{error ? (
					<p className="text-destructive text-sm" role="alert">
						{error}
					</p>
				) : null}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending} onClick={dismiss}>
						Not now
					</AlertDialogCancel>
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
