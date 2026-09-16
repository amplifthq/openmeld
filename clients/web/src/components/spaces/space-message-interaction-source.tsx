import type { CenterAgentInteractionSource } from "@openmeld/schemas/types";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { formatCenterAgentInteractionClient } from "#/lib/organizations/center-agent-interaction-source";

export function SpaceMessageInteractionSource(input: {
	source?: CenterAgentInteractionSource;
}) {
	if (!input.source) {
		return null;
	}

	return (
		<TooltipHint content="This message was sent through a local agent.">
			<span className="text-muted-foreground text-xs">
				via {formatCenterAgentInteractionClient(input.source.client)}
			</span>
		</TooltipHint>
	);
}
