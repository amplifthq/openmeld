import { cn } from "@openmeld/ui/lib/utils";
import { formatDirectMessageTime } from "./direct-message-preview";

export function resolveConversationTimestamp(
	messageTimestamp: number | undefined,
	createdAt: string | null | undefined
) {
	if (messageTimestamp !== undefined) {
		return messageTimestamp;
	}
	if (!createdAt) {
		return null;
	}
	const timestamp = Date.parse(createdAt);
	return Number.isFinite(timestamp) ? timestamp : null;
}

export function SidebarConversationTime(input: {
	timestamp: number;
	now?: Date;
	className?: string;
	hideOlderUntilHover?: boolean;
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
					"hidden group-focus-within/chat:inline-flex group-hover/chat:inline-flex",
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
