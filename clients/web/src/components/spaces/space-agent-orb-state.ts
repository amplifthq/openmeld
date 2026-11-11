import type {
	AgentStreamToolPart,
	AgentWorkActivity,
} from "@openmeld/schemas/types";
import type { ThinkingOrbProps } from "thinking-orbs";
import type { WakeProgressStatusKind } from "#/lib/spaces/wake-progress-status";

export type SpaceAgentOrbState = NonNullable<ThinkingOrbProps["state"]>;

export const DEFAULT_SPACE_AGENT_ORB_STATE: SpaceAgentOrbState = "solving";

/** Appearance only: the shared Wake presenter owns status and wording. */
export const WAKE_STATUS_ORB_STATE = {
	sending: "breathing",
	request_sent: "breathing",
	connecting: "breathing",
	retrying: "breathing",
	queued: "breathing",
	waiting_for_controller: "breathing",
	waiting_for_device: "breathing",
	waiting_for_owner: "listening",
	needs_input: "listening",
	confirmation_pending: "breathing",
	working: "solving",
} as const satisfies Record<WakeProgressStatusKind, SpaceAgentOrbState>;

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
