import {
	HOSTED_CENTER_AGENT_CONTROLLER_REF,
	HOSTED_REMOTE_AGENT_CONTROLLER_REF,
	parseAgentControllerRef,
} from "@openmeld/agent-runtime";
import type { AuthProfileView } from "@openmeld/schemas/types";
import { hasLocalAgentLogo } from "@openmeld/ui/components/local-agent-logo-utils";
import { modelProviderBrandName } from "#/components/models/model-brand";
import { hasModelBrandIcon } from "#/components/models/model-brand-icon";

// Saved avatar choices belong to the Profile. Automatic Remote logos identify
// the model provider; Local logos identify the Controller product.
export function resolveAgentAvatarIdentity(profile: {
	agentControllerRef?: string | null;
	avatarStyle?: AuthProfileView["avatarStyle"];
	isCenterAgent?: boolean;
	modelId?: string | null;
}) {
	const style = profile.avatarStyle ?? "automatic";
	const center =
		profile.agentControllerRef === HOSTED_CENTER_AGENT_CONTROLLER_REF ||
		profile.isCenterAgent === true;
	const controller = parseAgentControllerRef(profile.agentControllerRef);
	const remote = controller?.kind === HOSTED_REMOTE_AGENT_CONTROLLER_REF;
	const brand =
		remote && !center && style === "automatic"
			? modelProviderBrandName(profile.modelId ?? null)
			: null;
	const providerBrand = hasModelBrandIcon(brand) ? brand : null;
	return {
		style,
		shape: center ? ("circle" as const) : ("rounded-square" as const),
		providerBrand,
		icon:
			providerBrand ??
			(!(center || remote) &&
			style === "automatic" &&
			controller &&
			hasLocalAgentLogo(controller.id)
				? controller.id
				: "agent"),
	};
}
