import { Button } from "@openmeld/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { cn } from "@openmeld/ui/lib/utils";
import { InfoIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ReactElement } from "react";

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
					input.buttonClassName,
					resolveMessageDetailsButtonClassName({
						hasWakeProblem: input.hasWakeProblem,
					})
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

	return "border-0 bg-transparent shadow-none hover:bg-muted";
}
