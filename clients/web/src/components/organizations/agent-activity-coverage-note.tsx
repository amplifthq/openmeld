import { cn } from "@openmeld/ui/lib/utils";

export function AgentActivityCoverageNote(input: { className?: string }) {
	return (
		<p className={cn("text-muted-foreground text-xs", input.className)}>
			Totals reflect the newest 500 sessions.
		</p>
	);
}
