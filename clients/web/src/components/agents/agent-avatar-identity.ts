import {
	HOSTED_CENTER_AGENT_CONTROLLER_REF,
	parseAgentControllerRef,
} from "@openmeld/agent-runtime";
import type { AuthProfileView } from "@openmeld/schemas/types";
import { hasLocalAgentLogo } from "@openmeld/ui/components/local-agent-logo-utils";

// Avatar identity belongs to the Profile, never its selected model or surface.
export function resolveAgentAvatarIdentity(profile: {
	agentControllerRef?: string | null;
	avatarStyle?: AuthProfileView["avatarStyle"];
	isCenterAgent?: boolean;
}) {
	const style = profile.avatarStyle ?? "automatic";
	const center =
		profile.agentControllerRef === HOSTED_CENTER_AGENT_CONTROLLER_REF ||
		profile.isCenterAgent === true;
	const controllerId =
		parseAgentControllerRef(profile.agentControllerRef)?.id ?? null;
	return {
		style,
		shape: center ? ("circle" as const) : ("rounded-square" as const),
		icon:
			!center &&
			style === "automatic" &&
			controllerId &&
			hasLocalAgentLogo(controllerId)
				? controllerId
				: "agent",
	};
}
