import type { AgentProfileOperationalContextInput } from "@openmeld/agent-profile";
import { cn } from "@openmeld/ui/lib/utils";
import { resolveAgentProfileOperationalStatus } from "./agent-profile-operational-status-presentation";

export function AgentProfileOperationalStatusText(input: {
	className?: string;
	operationalContext: AgentProfileOperationalContextInput | null;
}) {
	const presentation = resolveAgentProfileOperationalStatus(
		input.operationalContext
	);
	const isWorking = presentation.status === "working";
	const needsAttention = presentation.status === "needs_attention";
	return (
		<span
			className={cn(
				"inline-flex min-w-0 items-center gap-1 font-medium text-muted-foreground text-xs",
				input.className
			)}
			data-agent-work-status={presentation.status}
			data-testid="agent-profile-operational-status"
		>
			{needsAttention ? (
				<span
					aria-hidden="true"
					className="size-1.5 shrink-0 rounded-full bg-amber-500"
					data-agent-needs-attention-indicator="true"
				/>
			) : null}
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
