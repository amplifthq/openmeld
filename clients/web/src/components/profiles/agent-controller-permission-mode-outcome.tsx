import type { AgentControllerPermissionModeDisplayMetadata } from "@openmeld/agent-runtime";
import { cn } from "@openmeld/ui/lib/utils";

export function AgentControllerPermissionModeOutcome(input: {
	id: string;
	metadata: AgentControllerPermissionModeDisplayMetadata;
}) {
	return (
		<div
			className="grid min-w-0 gap-1.5"
			data-testid="agent-controller-permission-mode-outcome"
			id={input.id}
		>
			<p
				aria-atomic="true"
				aria-live="polite"
				className={cn(
					"text-xs leading-5",
					input.metadata.tone === "warning"
						? "text-destructive"
						: "text-muted-foreground"
				)}
				id={getAgentControllerPermissionModeOutcomeDescriptionId(input.id)}
			>
				{input.metadata.description}
			</p>
			<details className="group min-w-0 text-xs">
				<summary className="cursor-pointer rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
					Technical details
				</summary>
				<div className="mt-1.5 grid min-w-0 gap-1.5 text-muted-foreground">
					<p>
						These settings apply to this Agent. Space access and Computer
						file-access settings are managed separately.
					</p>
					{input.metadata.technicalDetail ? (
						<div className="grid min-w-0 gap-1">
							<p>Key launch settings:</p>
							<code className="min-w-0 whitespace-normal break-all font-mono text-[11px] text-foreground">
								{input.metadata.technicalDetail}
							</code>
						</div>
					) : null}
				</div>
			</details>
		</div>
	);
}

export function getAgentControllerPermissionModeOutcomeDescriptionId(
	outcomeId: string
): string {
	return `${outcomeId}-description`;
}
