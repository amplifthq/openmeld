import { cn } from "@openmeld/ui/lib/utils";
import { formatDirectMessageTime } from "./direct-message-preview";

export function resolveConversationTimestamp(
	messageTimestamp: number | undefined,
	_createdAt: string | null | undefined
) {
	return messageTimestamp ?? null;
}

export function SidebarConversationTime(input: {
	timestamp: number;
	now?: Date;
	className?: string;
	hideOlderUntilHover?: boolean;
	/** The row whose hover reveals an older time: a conversation row, or a
	 *  nested sub-row such as one of an Agent's chats. A sub-row's time sits
	 *  in its own button, so a parent sub-row's hover does not reveal it. */
	hoverRow?: "conversation" | "sub-item";
}) {
	const date = new Date(input.timestamp);
	const now = input.now ?? new Date();
	const isToday =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();
	return (
		<time
			className={cn(
				"inline-flex shrink-0 font-normal text-[11px] text-muted-foreground tabular-nums",
				input.hideOlderUntilHover &&
					!isToday &&
					(input.hoverRow === "sub-item"
						? "in-[[data-sidebar=menu-sub-button]:focus-visible]:inline-flex in-[[data-sidebar=menu-sub-button]:hover]:inline-flex hidden"
						: "hidden group-has-[>[data-sidebar=menu-actions]:focus-within]/chat:inline-flex group-has-[>[data-sidebar=menu-actions]:hover]/chat:inline-flex group-has-[>[data-sidebar=menu-button]:focus-within]/chat:inline-flex group-has-[>[data-sidebar=menu-button]:hover]/chat:inline-flex"),
				input.className
			)}
			dateTime={date.toISOString()}
		>
			{isToday
				? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
				: formatDirectMessageTime(input.timestamp, now)}
		</time>
	);
}
