import type { CenterAgentInteractionSource } from "@openmeld/schemas/types";
import { formatCenterAgentInteractionClient } from "#/lib/organizations/center-agent-interaction-source";

export function SpaceMessageInteractionSource(input: {
	source?: CenterAgentInteractionSource;
}) {
	if (!input.source) {
		return null;
	}

	return (
		<span
			className="text-muted-foreground text-xs"
			title="This message was sent through a local agent."
		>
			via {formatCenterAgentInteractionClient(input.source.client)}
		</span>
	);
}
