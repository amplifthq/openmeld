import type { WakeProgressItem } from "@openmeld/schemas/types";

export type WakeFlowStepStatus = "complete" | "active" | "pending" | "failed";

export type WakeFlowStep = {
	description: string;
	label: string;
	reasonCode?: string | null;
	status: WakeFlowStepStatus;
};

export function resolveWakeProgressThinkingStep(
	item: WakeProgressItem
): WakeFlowStep | null {
	switch (item.phase) {
		case "sending":
			return createStartingWakeStep();
		case "request_sent":
		case "queued":
		case "connecting":
		case "retrying":
			return createDispatchingWakeStep("active");
		case "running":
			return {
				description: "The agent has the Wake.",
				label: "Agent is working",
				status: "active",
			};
		case "writing":
			return createAgentResponseReceivedStep(null);
		case "publishing":
			return createPublishingFinalMessageStep("active", null);
		case "failed":
		case "publication_unknown":
		case "replied":
		case "stopped":
			return null;
		default: {
			const _exhaustive: never = item.phase;
			return _exhaustive;
		}
	}
}

function createStartingWakeStep(): WakeFlowStep {
	return {
		description: "OpenMeld is starting the Wake.",
		label: "Starting Wake…",
		status: "active",
	};
}

function createDispatchingWakeStep(status: WakeFlowStepStatus): WakeFlowStep {
	return {
		description: "Finding the right computer.",
		label: "Sending to agent",
		status,
	};
}

function createAgentResponseReceivedStep(
	reasonCode: string | null
): WakeFlowStep {
	return {
		description: "The agent sent a response.",
		label: "Agent response received",
		reasonCode,
		status: "complete",
	};
}

function createPublishingFinalMessageStep(
	status: WakeFlowStepStatus,
	reasonCode: string | null
): WakeFlowStep {
	return {
		description:
			status === "active"
				? "Still trying to post it here."
				: "Posted to this Space.",
		label: "Finalizing reply",
		reasonCode,
		status,
	};
}
