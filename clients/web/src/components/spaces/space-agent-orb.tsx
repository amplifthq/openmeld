import { cn } from "@openmeld/ui/lib/utils";
import { useReducedMotion } from "motion/react";
import { ThinkingOrb } from "thinking-orbs";
import {
	DEFAULT_SPACE_AGENT_ORB_STATE,
	type SpaceAgentOrbState,
} from "./space-agent-orb-state";

export function SpaceAgentOrb(input: {
	className?: string;
	prominent?: boolean;
	state?: SpaceAgentOrbState;
	paused?: boolean;
	"data-testid"?: string;
}) {
	const state = input.state ?? DEFAULT_SPACE_AGENT_ORB_STATE;
	const shouldReduceMotion = useReducedMotion() === true;
	return (
		<span
			aria-hidden="true"
			className={cn(
				"inline-flex shrink-0 items-center justify-center",
				input.prominent ? "size-8" : "size-4",
				input.className
			)}
			data-slot="space-agent-orb"
		>
			<ThinkingOrb
				aria-hidden="true"
				className={cn(
					"max-w-none shrink-0",
					input.prominent ? "scale-50" : "scale-80"
				)}
				data-space-agent-orb-state={state}
				data-testid={input["data-testid"]}
				paused={shouldReduceMotion || input.paused}
				size={input.prominent ? 64 : 20}
				state={state}
			/>
		</span>
	);
}
