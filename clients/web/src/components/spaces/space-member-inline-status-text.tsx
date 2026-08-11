import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	resolveStatusToneIndicatorClassName,
	type StatusTone,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { Link } from "@tanstack/react-router";

export function SpaceMemberInlineStatusText(input: {
	availabilityAction?: string | null;
	availabilityCategory?: string | null;
	availabilityPhase?: string | null;
	availabilityReasonCode?: string | null;
	className?: string | null;
	isRefreshing?: boolean;
	label: string;
	testId: string;
	to?: string;
	tooltip: string;
}) {
	const content = (
		<span
			className={cn(
				"min-w-0 truncate",
				input.isRefreshing ? "shimmer-text" : null
			)}
		>
			{input.label}
		</span>
	);
	const className = cn(
		"inline-flex min-w-0 shrink-0 items-center font-medium text-xs before:mr-2 before:text-muted-foreground/55 before:content-['·']",
		input.to ? "cursor-pointer underline-offset-4 hover:underline" : null,
		input.className
	);
	const commonProps = {
		"aria-label": input.label,
		className,
		"data-availability-action": input.availabilityAction ?? undefined,
		"data-availability-category": input.availabilityCategory ?? undefined,
		"data-availability-phase": input.availabilityPhase ?? undefined,
		"data-availability-reason-code": input.availabilityReasonCode ?? undefined,
		"data-testid": input.testId,
		title: input.tooltip,
	};
	const status = input.to ? (
		<Link to={input.to} {...commonProps}>
			{content}
		</Link>
	) : (
		<span {...commonProps}>{content}</span>
	);

	return (
		<Tooltip>
			<TooltipTrigger render={status} />
			<TooltipContent
				className="max-w-sm whitespace-normal text-left leading-5"
				side="top"
			>
				{input.tooltip}
			</TooltipContent>
		</Tooltip>
	);
}

export function SpaceAgentAvailabilityIndicator(input: {
	action?: string | null;
	category?: string | null;
	href?: string;
	isRefreshing?: boolean;
	label: string;
	phase?: string | null;
	reasonCode?: string | null;
	tone: StatusTone;
	tooltip: string;
}) {
	const indicatorDot = (
		<span
			aria-hidden="true"
			className={cn(
				"size-2 rounded-full",
				resolveStatusToneIndicatorClassName(input.tone, "solid")
			)}
			data-slot="space-agent-availability-indicator-dot"
		/>
	);
	const commonProps = {
		"aria-label": input.label,
		className:
			"relative inline-flex size-3 shrink-0 cursor-help items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
		"data-availability-action": input.action ?? undefined,
		"data-availability-category": input.category ?? undefined,
		"data-availability-phase": input.phase ?? undefined,
		"data-availability-reason-code": input.reasonCode ?? undefined,
		"data-refreshing": input.isRefreshing ? "true" : undefined,
		"data-testid": "space-agent-availability-indicator",
		title: input.tooltip,
	};
	const indicator = input.href ? (
		<Link
			to={input.href}
			{...commonProps}
			className={cn(
				commonProps.className,
				"cursor-pointer after:absolute after:-inset-1.5 after:rounded-full"
			)}
		>
			{indicatorDot}
		</Link>
	) : (
		<span {...commonProps} role="img">
			{indicatorDot}
		</span>
	);

	return (
		<Tooltip>
			<TooltipTrigger render={indicator} />
			<TooltipContent
				className="max-w-sm whitespace-normal text-left leading-5"
				side="top"
			>
				{input.tooltip}
			</TooltipContent>
		</Tooltip>
	);
}
