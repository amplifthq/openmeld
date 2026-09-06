import { cn } from "@openmeld/ui/lib/utils";
import { formatDirectMessageTime } from "./direct-message-preview";

export function SidebarConversationTime(input: {
	timestamp: number;
	now?: Date;
	className?: string;
}) {
	return (
		<time
			className={cn(
				"@[13rem]/conversation-row:inline-flex hidden shrink-0 font-normal text-[11px] text-muted-foreground tabular-nums",
				input.className
			)}
			dateTime={new Date(input.timestamp).toISOString()}
		>
			{formatDirectMessageTime(input.timestamp, input.now)}
		</time>
	);
}
