import type { AgentProfileOperationalContextInput } from "@openmeld/agent-profile";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { resolveStatusToneIconClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { ClockCountdownIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { SpaceAgentOrb } from "#/components/spaces/space-agent-orb";
import { resolveAgentProfileOperationalStatus } from "./agent-profile-operational-status-presentation";

export function AgentProfileOperationalStatusIndicator(input: {
	className?: string;
	operationalContext: AgentProfileOperationalContextInput | null;
}) {
	const presentation = resolveAgentProfileOperationalStatus(
		input.operationalContext
	);
	if (
		presentation.status === "idle" ||
		presentation.status === "not_reported" ||
		presentation.status === "checking"
	) {
		return null;
	}
	const isWorking = presentation.status === "working";
	const needsAttention = presentation.status === "needs_attention";
	const waitingCount = input.operationalContext?.waitingCount ?? 0;
	const currentWorkLocation = input.operationalContext?.currentWorkLocation;
	const queueLabel =
		waitingCount > 0
			? `${waitingCount} ${waitingCount === 1 ? "task" : "tasks"} queued`
			: null;
	const tooltip = [
		isWorking && currentWorkLocation
			? `Agent is working in ${currentWorkLocation}`
			: presentation.label,
		queueLabel,
	]
		.filter(Boolean)
		.join(" · ");
	let statusIcon = <ClockCountdownIcon aria-hidden="true" className="size-4" />;
	if (isWorking) {
		statusIcon = <SpaceAgentOrb data-testid="agent-profile-working-orb" />;
	} else if (needsAttention) {
		statusIcon = (
			<WarningCircleIcon
				aria-hidden="true"
				className="size-4"
				data-agent-needs-attention-indicator="true"
				weight="fill"
			/>
		);
	}
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<span
						className={cn(
							"inline-flex min-w-0 shrink-0 items-center gap-1 text-muted-foreground",
							needsAttention ? resolveStatusToneIconClassName("warning") : null,
							input.className
						)}
						data-agent-work-status={presentation.status}
						data-testid="agent-profile-operational-status"
					/>
				}
			>
				{statusIcon}
				{waitingCount > 0 ? (
					<span className="font-medium text-[0.6875rem] tabular-nums">
						+{waitingCount}
					</span>
				) : null}
				<span className="sr-only">{tooltip}</span>
			</TooltipTrigger>
			<TooltipContent side="top">{tooltip}</TooltipContent>
		</Tooltip>
	);
}
