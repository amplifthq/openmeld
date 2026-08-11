import { Badge } from "@openmeld/ui/components/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { cn } from "@openmeld/ui/lib/utils";
import { Link } from "@tanstack/react-router";

export function AgentProfileAvailabilityBadge(input: {
	availabilityAction?: string | null;
	availabilityPhase?: string | null;
	availabilityReasonCode?: string | null;
	className?: string;
	isRefreshing?: boolean;
	label: string;
	testId?: string;
	to?: string;
	tooltip: string;
	variant?: "secondary" | "destructive" | "outline";
}) {
	const badge = (
		<Badge
			className={cn(
				"w-fit min-w-0 max-w-full justify-center px-2",
				input.to ? "cursor-pointer" : null,
				input.className
			)}
			data-availability-action={input.availabilityAction ?? undefined}
			data-availability-phase={input.availabilityPhase ?? undefined}
			data-availability-reason-code={input.availabilityReasonCode ?? undefined}
			data-testid={input.testId ?? "agent-profile-availability-badge"}
			render={input.to ? <Link to={input.to} /> : undefined}
			title={input.tooltip}
			variant={input.variant ?? "outline"}
		>
			<span
				className={cn(
					"block min-w-0 truncate",
					input.isRefreshing ? "shimmer-text" : null
				)}
			>
				{input.label}
			</span>
		</Badge>
	);

	return (
		<Tooltip>
			<TooltipTrigger render={badge} />
			<TooltipContent
				className="max-w-sm whitespace-normal text-left leading-5"
				side="top"
			>
				{input.tooltip}
			</TooltipContent>
		</Tooltip>
	);
}
