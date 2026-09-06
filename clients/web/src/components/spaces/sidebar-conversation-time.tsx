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
}) {
	return (
		<time
			className={cn(
				"inline-flex shrink-0 font-normal text-[11px] text-muted-foreground tabular-nums",
				input.className
			)}
			dateTime={new Date(input.timestamp).toISOString()}
		>
			{formatDirectMessageTime(input.timestamp, input.now)}
		</time>
	);
}
