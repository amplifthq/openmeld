import type { AgentProfileOperationalContextInput } from "@openmeld/agent-profile";
import { cn } from "@openmeld/ui/lib/utils";

export type AgentProfileOperationalStatus =
	| "checking"
	| "idle"
	| "needs_attention"
	| "not_reported"
	| "waiting"
	| "working";

export type AgentProfileOperationalStatusPresentation = {
	label: string;
	status: AgentProfileOperationalStatus;
};

export function resolveAgentProfileOperationalStatus(
	operationalContext: AgentProfileOperationalContextInput | null
): AgentProfileOperationalStatusPresentation {
	if (!operationalContext) {
		return { label: "Not reported", status: "not_reported" };
	}
	if (operationalContext.status === "checking") {
		return { label: "Checking", status: "checking" };
	}
	if (operationalContext.status === "idle") {
		return { label: "Idle", status: "idle" };
	}
	if (operationalContext.status === "working") {
		return { label: "Working", status: "working" };
	}
	if (operationalContext.recoveryAction) {
		return { label: "Needs attention", status: "needs_attention" };
	}
	return { label: "Waiting", status: "waiting" };
}

export function AgentProfileOperationalStatusText(input: {
	className?: string;
	operationalContext: AgentProfileOperationalContextInput | null;
}) {
	const presentation = resolveAgentProfileOperationalStatus(
		input.operationalContext
	);
	const isWorking = presentation.status === "working";
	return (
		<span
			className={cn(
				"inline-flex min-w-0 items-center gap-1 font-medium text-muted-foreground text-xs",
				input.className
			)}
			data-agent-work-status={presentation.status}
			data-testid="agent-profile-operational-status"
		>
			{isWorking ? (
				<span aria-hidden="true" className="text-[0.95rem] leading-none">
					∞
				</span>
			) : null}
			<span className={cn("truncate", isWorking ? "shimmer-text" : null)}>
				{presentation.label}
			</span>
		</span>
	);
}
