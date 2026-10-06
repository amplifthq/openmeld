import type { CenterAgentRoutineRunStatus } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import {
	resolveStatusToneProminentBadgeClassName,
	resolveStatusToneTextClassName,
	type StatusTone,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";

export function RoutineRunStatusBadge(input: {
	status: CenterAgentRoutineRunStatus;
}) {
	const presentation = ROUTINE_RUN_STATUS_PRESENTATION[input.status];
	return (
		<Badge
			className={cn(
				resolveStatusToneProminentBadgeClassName(presentation.tone),
				"h-4.5 px-1.5 py-0 text-[11px]"
			)}
		>
			{presentation.label}
		</Badge>
	);
}

export function resolveRoutineRunStatusTextClassName(
	status: CenterAgentRoutineRunStatus
) {
	return resolveStatusToneTextClassName(
		ROUTINE_RUN_STATUS_PRESENTATION[status].tone
	);
}

const ROUTINE_RUN_STATUS_PRESENTATION = {
	claimed: {
		tone: "checking",
		label: "Preparing",
	},
	completed: {
		tone: "ready",
		label: "Completed",
	},
	failed: {
		tone: "danger",
		label: "Failed",
	},
	skipped: {
		tone: "muted",
		label: "Skipped",
	},
	submitted: {
		tone: "checking",
		label: "Awaiting result",
	},
} as const satisfies Record<
	CenterAgentRoutineRunStatus,
	{ tone: StatusTone; label: string }
>;
