import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";

const SPACE_MESSAGE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
});

// Shown on hover, e.g. "Oct 29, 2026, 2:48:17 PM".
const SPACE_MESSAGE_FULL_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeStyle: "medium",
});

export function SpaceMessageTime(input: {
	createdAtMs: number;
	isDirectMessage: boolean;
	placement: "header" | "toolbar";
}) {
	if ((input.placement === "toolbar") !== input.isDirectMessage) {
		return null;
	}

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<time
						className={
							input.placement === "toolbar"
								? "ml-1 shrink-0 px-2 text-muted-foreground text-xs tabular-nums"
								: "ml-1 shrink-0 text-muted-foreground text-xs tabular-nums"
						}
						dateTime={new Date(input.createdAtMs).toISOString()}
					/>
				}
			>
				{SPACE_MESSAGE_TIME_FORMATTER.format(input.createdAtMs)}
			</TooltipTrigger>
			<TooltipContent className="motion-reduce:animate-none">
				{SPACE_MESSAGE_FULL_TIME_FORMATTER.format(input.createdAtMs)}
			</TooltipContent>
		</Tooltip>
	);
}
