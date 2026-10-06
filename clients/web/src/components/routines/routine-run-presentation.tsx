import type { CenterAgentRoutineRunStatus } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import {
	resolveInformationStatusBadgeClassName,
	resolveStatusToneProminentBadgeClassName,
} from "@openmeld/ui/lib/status-tone";

export function RoutineRunStatusBadge(input: {
	status: CenterAgentRoutineRunStatus;
}) {
	const presentation = ROUTINE_RUN_STATUS_PRESENTATION[input.status];
	return <Badge className={presentation.className}>{presentation.label}</Badge>;
}

const ROUTINE_RUN_STATUS_PRESENTATION = {
	claimed: {
		className: resolveInformationStatusBadgeClassName(),
		label: "Claimed",
	},
	completed: {
		className: resolveStatusToneProminentBadgeClassName("ready"),
		label: "Completed",
	},
	failed: {
		className: "border-destructive/50 bg-destructive/10 text-destructive",
		label: "Failed",
	},
	skipped: {
		className: "border-border bg-muted/40 text-muted-foreground",
		label: "Skipped",
	},
	submitted: {
		className: resolveInformationStatusBadgeClassName(),
		label: "Submitted",
	},
} as const satisfies Record<
	CenterAgentRoutineRunStatus,
	{ className: string; label: string }
>;
