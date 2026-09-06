import type { SpaceActiveWakePresentation } from "./space-active-wake-presentation";
import { SpaceAgentOrb } from "./space-agent-orb";

export function SpaceActiveWakeIndicator({
	presentation,
}: {
	presentation: SpaceActiveWakePresentation;
}) {
	return (
		<SpaceAgentOrb
			paused={presentation.orbState === undefined}
			state={presentation.orbState ?? "listening"}
		/>
	);
}
