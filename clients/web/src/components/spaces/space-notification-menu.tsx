"use client";

import { inboxConversationNotificationModeSchema } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuRadioGroup,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuRadioItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { BellIcon, BellSlashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { ClientNotificationControl } from "#/components/inbox/client-notification-control";
import { useInboxNotificationSettings } from "#/components/inbox/use-inbox-notification-settings";
import {
	MESSAGE_NOTIFICATION_LABELS,
	useMessageNotificationPreferences,
} from "#/components/inbox/use-message-notification-preferences";
import { useAppSettings } from "#/components/settings/use-app-settings";
import { resolveClientNotificationDescription } from "#/lib/inbox/client-notifications";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";

export function SpaceNotificationMenu(input: {
	spaceId: string;
	isGuest?: boolean;
}) {
	const organization = useOptionalAppOrganization();
	if (input.isGuest || !organization?.currentUserId) {
		return null;
	}
	return (
		<ConversationNotificationMenu
			key={`${organization.currentUserId}:${organization.currentOrganization.id}:${input.spaceId}`}
			spaceId={input.spaceId}
			userId={organization.currentUserId}
		/>
	);
}

function ConversationNotificationMenu(input: {
	spaceId: string;
	userId: string;
}) {
	const { query, mutation } = useMessageNotificationPreferences(input.spaceId);
	const {
		settings,
		setEnabled,
		isPending: notificationPending,
		error: notificationError,
	} = useInboxNotificationSettings(input.userId);
	const openSettings = useAppSettings();
	const [navigationError, setNavigationError] = useState<string | null>(null);
	const muted = query.data?.effectiveMode === "muted";
	const error = mutation.error ?? query.error;
	let summary = "Notification settings unavailable";
	if (query.data) {
		summary =
			query.data.overrideMode === null
				? `Use default · ${MESSAGE_NOTIFICATION_LABELS[query.data.defaultMode]}`
				: MESSAGE_NOTIFICATION_LABELS[query.data.overrideMode];
	}
	return (
		<DropdownMenu
			onOpenChange={(open) => {
				if (open) {
					query.refetch();
				}
			}}
		>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label={`Conversation notifications: ${summary}`}
						className="hidden sm:inline-flex"
						size="icon-sm"
						title={summary}
						variant="ghost"
					>
						{muted ? <BellSlashIcon /> : <BellIcon />}
					</Button>
				}
			/>
			<FluidDropdownMenuContent
				align="end"
				className="w-80 max-w-[calc(100vw-2rem)]"
				sideOffset={8}
			>
				<p className="px-2 py-2 font-medium text-sm">Notify you about</p>
				{query.data ? (
					<DropdownMenuRadioGroup
						onValueChange={(value) => {
							if (value === "default") {
								mutation.mutate({
									scope: "conversation",
									spaceId: input.spaceId,
									mode: null,
								});
								return;
							}
							const mode =
								inboxConversationNotificationModeSchema.safeParse(value);
							if (mode.success) {
								mutation.mutate({
									scope: "conversation",
									spaceId: input.spaceId,
									mode: mode.data,
								});
							}
						}}
						value={query.data.overrideMode ?? "default"}
					>
						<FluidDropdownMenuRadioItem
							disabled={mutation.isPending || query.isError}
							index={0}
							value="default"
						>
							Use default ·{" "}
							{MESSAGE_NOTIFICATION_LABELS[query.data.defaultMode]}
						</FluidDropdownMenuRadioItem>
						{Object.entries(MESSAGE_NOTIFICATION_LABELS).map(
							([value, label], index) => (
								<FluidDropdownMenuRadioItem
									disabled={mutation.isPending || query.isError}
									index={index + 1}
									key={value}
									value={value}
								>
									{label}
								</FluidDropdownMenuRadioItem>
							)
						)}
					</DropdownMenuRadioGroup>
				) : (
					<p className="px-2 text-muted-foreground text-sm">
						{query.isPending
							? "Loading notification preferences…"
							: "Notification preferences could not be loaded."}
					</p>
				)}
				{mutation.isPending ? (
					<output className="px-2 text-muted-foreground text-xs">
						Saving…
					</output>
				) : null}
				{error ? (
					<div className="px-2 py-2">
						<p className="text-destructive text-xs" role="alert">
							{error.message}
						</p>
						<Button
							onClick={() => {
								mutation.reset();
								query.refetch();
							}}
							size="sm"
							variant="ghost"
						>
							Try again
						</Button>
					</div>
				) : null}
				<DropdownMenuSeparator />
				{settings ? (
					<>
						<div className="flex items-center justify-between gap-3 px-2 py-3">
							<span className="text-sm">
								{settings.permission === "unknown"
									? "Desktop notifications"
									: "Browser notifications"}
							</span>
							<ClientNotificationControl
								disabled={notificationPending}
								onChange={setEnabled}
								settings={settings}
							/>
						</div>
						{settings.permission === "denied" ||
						settings.permission === "unsupported" ? (
							<p className="px-2 pb-2 text-muted-foreground text-xs">
								{resolveClientNotificationDescription(settings.permission)}
							</p>
						) : null}
					</>
				) : null}
				{notificationError ? (
					<p className="px-2 pb-2 text-destructive text-xs" role="alert">
						{notificationError}
					</p>
				) : null}
				<Button
					className="w-full"
					onClick={() =>
						openSettings("notifications").catch((error: unknown) =>
							setNavigationError(
								error instanceof Error
									? error.message
									: "Could not open notification settings."
							)
						)
					}
					size="sm"
					variant="default"
				>
					Open notification settings
				</Button>
				{navigationError ? (
					<p className="px-2 text-destructive text-xs" role="alert">
						{navigationError}
					</p>
				) : null}
			</FluidDropdownMenuContent>
		</DropdownMenu>
	);
}
