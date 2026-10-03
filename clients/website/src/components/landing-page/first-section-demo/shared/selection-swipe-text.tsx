import { cn } from "@openmeld/ui/lib/utils";

import {
	type DemoAgentName,
	getDemoAgentSelectionClassName,
	getDemoAgentSelectionStyle,
} from "./demo-agent-icon";

type SelectionSwipeTextProps = {
	agentName: DemoAgentName;
	children: string;
	className?: string;
	isActive: boolean;
	testId?: string;
};

export function SelectionSwipeText({
	agentName,
	children,
	className,
	isActive,
	testId,
}: SelectionSwipeTextProps) {
	return (
		<span
			className={cn(
				"terminal-demo-selection-text text-foreground/92",
				getDemoAgentSelectionClassName(agentName),
				className
			)}
			data-active={isActive ? "true" : "false"}
			data-highlighted={isActive ? "true" : "false"}
			data-testid={testId}
			style={getDemoAgentSelectionStyle(agentName)}
		>
			{children}
		</span>
	);
}
