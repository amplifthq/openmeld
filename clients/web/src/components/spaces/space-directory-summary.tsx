import { normalizeMessagePreview } from "@openmeld/protocol";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { cn } from "@openmeld/ui/lib/utils";
import { ChatCircleTextIcon, LockKeyIcon } from "@phosphor-icons/react";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { SpaceDeletedLabel } from "./space-deleted-label";
import { WelcomeSpaceLabel } from "./welcome-space-guide";

/** Identity and latest-message preview shared by browsing and picking a Space. */
export function SpaceDirectorySummary(input: {
	item: AccountSpaceItem;
	preview: { text: string } | null | undefined;
	unread?: boolean;
	layout?: "card" | "row";
}) {
	const previewText =
		input.preview === undefined
			? "Message preview unavailable"
			: (input.preview?.text ??
				input.item.spacePurpose ??
				(input.layout === "card" ? null : "No messages yet"));
	return (
		<>
			<span
				className={cn(
					"flex min-h-5 items-center gap-2 text-sm leading-5",
					input.unread ? "font-semibold text-foreground" : "font-medium"
				)}
			>
				{input.layout !== "card" && (
					<ChatCircleTextIcon
						aria-hidden
						className="size-4 shrink-0 text-muted-foreground"
					/>
				)}
				<TooltipHint content={input.item.spaceName}>
					<span
						className={
							input.layout === "card"
								? "relative z-10 min-w-0 truncate"
								: "truncate"
						}
					>
						{input.item.spaceName}
					</span>
				</TooltipHint>
				<WelcomeSpaceLabel spaceId={input.item.spaceId} />
				{input.item.deletedAt && <SpaceDeletedLabel />}
				{input.item.visibility === "private" && (
					<LockKeyIcon
						aria-label="Invite-only in this organization"
						className="block size-3 shrink-0 self-center text-muted-foreground"
					/>
				)}
			</span>
			{previewText && input.layout !== "card" && (
				<span className="mt-1 block truncate pl-6 text-muted-foreground text-xs">
					{input.item.recentMessagePreviews
						? previewText
						: normalizeMessagePreview(previewText)}
				</span>
			)}
		</>
	);
}
