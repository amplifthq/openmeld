import { Button } from "@openmeld/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { cn } from "@openmeld/ui/lib/utils";
import { InfoIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ReactElement } from "react";

export function MessageHoverActionSlot(input: {
	children: ReactElement;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"pointer-events-none opacity-0 transition-opacity duration-150 ease-out group-focus-within/message-row:pointer-events-auto group-focus-within/message-row:opacity-100 group-hover/message-row:pointer-events-auto group-hover/message-row:opacity-100 motion-reduce:transition-none",
				input.className
			)}
			data-message-action-slot="hover"
		>
			{input.children}
		</div>
	);
}

export function MessageActionTooltip(input: {
	children: ReactElement;
	label: string;
}) {
	return (
		<Tooltip>
			<TooltipTrigger render={input.children} />
			<TooltipContent>{input.label}</TooltipContent>
		</Tooltip>
	);
}

export function MessageDetailsActionButton(input: {
	buttonClassName?: string;
	hasWakeProblem: boolean;
	onClick: () => void;
}) {
	return (
		<MessageActionTooltip label="Message details">
			<Button
				aria-label="Message details"
				className={cn(
					"size-8 shadow-sm",
					resolveMessageDetailsButtonClassName({
						hasWakeProblem: input.hasWakeProblem,
					}),
					input.buttonClassName
				)}
				onClick={input.onClick}
				size="icon-sm"
				type="button"
				variant="outline"
			>
				{input.hasWakeProblem ? (
					<WarningCircleIcon aria-hidden="true" />
				) : (
					<InfoIcon aria-hidden="true" />
				)}
			</Button>
		</MessageActionTooltip>
	);
}

function resolveMessageDetailsButtonClassName(input: {
	hasWakeProblem: boolean;
}): string {
	if (input.hasWakeProblem) {
		return "border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive";
	}

	return "border-border bg-background/95";
}
