import type {
	AgentStreamToolPart,
	AgentWorkActivity,
} from "@openmeld/schemas/types";
import { cn } from "@openmeld/ui/lib/utils";
import { useReducedMotion } from "motion/react";
import { ThinkingOrb, type ThinkingOrbProps } from "thinking-orbs";

export type SpaceAgentOrbState = NonNullable<ThinkingOrbProps["state"]>;

export const DEFAULT_SPACE_AGENT_ORB_STATE: SpaceAgentOrbState = "solving";

const SEARCH_WORK_KEYS = new Set<AgentWorkActivity["key"]>([
	"github.code.search",
	"github.commits.search",
	"github.issues.search",
	"slack.messages.search",
	"source.search",
	"web.search",
]);

const SHAPING_WORK_KEYS = new Set<AgentWorkActivity["key"]>([
	"image.generate",
	"organization.document.draft",
]);

export function SpaceAgentOrb(input: {
	className?: string;
	prominent?: boolean;
	state?: SpaceAgentOrbState;
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
				paused={shouldReduceMotion}
				size={input.prominent ? 64 : 20}
				state={state}
			/>
		</span>
	);
}

export function resolveSpaceAgentWorkOrbState(input: {
	state: AgentStreamToolPart["state"];
	work: AgentWorkActivity;
}): SpaceAgentOrbState {
	if (input.state !== "input-available") {
		return DEFAULT_SPACE_AGENT_ORB_STATE;
	}
	if (SEARCH_WORK_KEYS.has(input.work.key)) {
		return "searching";
	}
	if (SHAPING_WORK_KEYS.has(input.work.key)) {
		return "shaping";
	}
	return DEFAULT_SPACE_AGENT_ORB_STATE;
}
