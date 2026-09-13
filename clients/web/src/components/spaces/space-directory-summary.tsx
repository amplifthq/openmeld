import { cn } from "@openmeld/ui/lib/utils";
import { ChatCircleTextIcon, LockKeyIcon } from "@phosphor-icons/react";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { WelcomeSpaceLabel } from "./welcome-space-guide";

/** Identity and latest-message preview shared by browsing and picking a Space. */
export function SpaceDirectorySummary(input: {
	item: AccountSpaceItem;
	preview: { text: string } | null | undefined;
	unread?: boolean;
}) {
	return (
		<>
			<span
				className={cn(
					"flex items-center gap-2 text-sm",
					input.unread ? "font-semibold text-foreground" : "font-medium"
				)}
			>
				<ChatCircleTextIcon
					aria-hidden
					className="size-4 shrink-0 text-muted-foreground"
				/>
				<span className="truncate">{input.item.spaceName}</span>
				<WelcomeSpaceLabel spaceId={input.item.spaceId} />
				{input.item.visibility === "private" && (
					<LockKeyIcon
						aria-label="Invite-only in this organization"
						className="size-3 shrink-0 text-muted-foreground"
					/>
				)}
			</span>
			<span className="mt-1 block truncate pl-6 text-muted-foreground text-xs">
				{input.preview === undefined
					? "Message preview unavailable"
					: (input.preview?.text ??
						input.item.spacePurpose ??
						"No messages yet")}
			</span>
		</>
	);
}
