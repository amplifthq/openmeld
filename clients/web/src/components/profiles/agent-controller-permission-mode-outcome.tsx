import type {
	AgentControllerPermissionModeDisplayMetadata,
	AgentControllerPermissionModeOption,
} from "@openmeld/agent-runtime";
import { cn } from "@openmeld/ui/lib/utils";

const AGENT_CONTROLLER_PERMISSION_MODE_SCOPE =
	"This controls the local controller for this Agent during Wakes. Space access, Agent availability, and this Computer’s file-access limits are separate.";

export function AgentControllerPermissionModeOutcome(input: {
	id: string;
	metadata: AgentControllerPermissionModeDisplayMetadata;
}) {
	return (
		<div
			className="grid gap-1.5"
			data-testid="agent-controller-permission-mode-outcome"
			id={input.id}
		>
			<div
				aria-atomic="true"
				aria-live="polite"
				className="grid gap-1.5"
				id={getAgentControllerPermissionModeOutcomeDescriptionId(input.id)}
			>
				<p
					className={cn(
						"font-medium text-sm leading-5",
						input.metadata.tone === "warning"
							? "text-destructive"
							: "text-foreground"
					)}
				>
					{input.metadata.outcomeLabel}
				</p>
				<p className="text-muted-foreground text-xs leading-5">
					{input.metadata.description}
				</p>
				<div className="rounded-md bg-muted/50 px-2.5 py-2 text-xs leading-5">
					<p className="font-medium text-foreground">Scope</p>
					<p className="text-muted-foreground">
						{AGENT_CONTROLLER_PERMISSION_MODE_SCOPE}
					</p>
				</div>
			</div>
			<details className="group text-xs">
				<summary className="cursor-pointer rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
					Technical details
				</summary>
				<div className="mt-1.5 grid gap-1.5 rounded-md border border-border/70 p-2.5 text-muted-foreground">
					<p>Native mode: {input.metadata.label}</p>
					{input.metadata.technicalDetail ? (
						<div className="grid gap-1">
							<p>Key launch settings:</p>
							<code className="break-all font-mono text-[11px] text-foreground">
								{input.metadata.technicalDetail}
							</code>
						</div>
					) : null}
				</div>
			</details>
		</div>
	);
}

export function AgentControllerPermissionModeOptionContent(input: {
	metadata: AgentControllerPermissionModeOption;
}) {
	return (
		<span className="grid min-w-0 gap-0.5 py-0.5 text-left">
			<span className="font-medium text-foreground">
				{input.metadata.outcomeLabel}
			</span>
			<span className="text-[11px] text-muted-foreground">
				Native mode: {input.metadata.label}
			</span>
		</span>
	);
}

export function getAgentControllerPermissionModeOutcomeDescriptionId(
	outcomeId: string
): string {
	return `${outcomeId}-description`;
}

export function getAgentControllerPermissionModeOptionAccessibleName(
	metadata: AgentControllerPermissionModeOption
): string {
	return `${metadata.outcomeLabel}. Native mode: ${metadata.label}`;
}
