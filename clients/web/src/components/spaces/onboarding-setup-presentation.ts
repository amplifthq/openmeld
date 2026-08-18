import type { OnboardingFacts, OnboardingPlan } from "@openmeld/schemas/types";

type OnboardingDecision = OnboardingPlan["decisions"][number];
type OnboardingDecisionId = OnboardingDecision["id"];
type DeviceStatus = OnboardingFacts["device"]["status"];

export type OnboardingSetupPresentation = "banner" | "empty-state";

export type OnboardingSetupActionVisibility = {
	bringAgentsFirstAgent: boolean;
	showBringAgents: boolean;
	showConnect: boolean;
};

export function resolveDeviceStatus(input: {
	serviceConnected: boolean | null;
	pending: boolean;
	noConnectedComputer: boolean;
}): DeviceStatus {
	if (input.serviceConnected === true) {
		return "connected";
	}
	// Definitive: this account has no connected computer at all. The reply
	// readiness query is disabled in that state (it only runs once a computer
	// exists), so its perpetual isPending must NOT be read as "still checking".
	if (input.noConnectedComputer) {
		return "not_connected";
	}
	if (input.pending) {
		// A device IS resolved but its readiness is still loading (e.g. a connected
		// user refreshing): report unknown so the planner blocks connect_this_computer
		// instead of speculatively flashing "Connect this computer" before the
		// connected fact arrives on first paint.
		return "unknown";
	}
	if (input.serviceConnected === false) {
		return "not_connected";
	}
	return "unknown";
}

const EMPTY_DISMISSED_SETUP_DECISIONS: ReadonlySet<OnboardingDecisionId> =
	new Set();

function findDecision(
	plan: OnboardingPlan,
	id: OnboardingDecisionId
): OnboardingDecision | null {
	return plan.decisions.find((decision) => decision.id === id) ?? null;
}

/**
 * One presentation-independent interpretation of the planner decisions. The
 * banner and empty Space cards must never drift on which setup actions exist;
 * they differ only in layout and dismissal behavior.
 */
export function resolveOnboardingSetupActionVisibility(input: {
	canAddAgents: boolean;
	dismissedIds?: ReadonlySet<OnboardingDecisionId>;
	plan: OnboardingPlan;
}): OnboardingSetupActionVisibility {
	const dismissedIds = input.dismissedIds ?? EMPTY_DISMISSED_SETUP_DECISIONS;
	const connect = findDecision(input.plan, "connect_this_computer");
	const bringAgents = findDecision(input.plan, "bring_agents");
	const bringAgentsFirstAgent =
		bringAgents?.status === "blocked" &&
		bringAgents.reason === "agents.none_yet";

	return {
		bringAgentsFirstAgent,
		showBringAgents:
			input.canAddAgents &&
			(bringAgents?.status === "available" || bringAgentsFirstAgent) &&
			!dismissedIds.has("bring_agents"),
		showConnect:
			connect?.status === "available" &&
			!dismissedIds.has("connect_this_computer"),
	};
}
