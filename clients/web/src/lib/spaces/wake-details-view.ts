import { WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE } from "@openmeld/schemas";
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
	if (
		item.waitReasonCode ===
		WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE
	) {
		return {
			description:
				"This Wake will start when this Codex task becomes available.",
			label: "Waiting for Codex task",
			status: "active",
		};
	}
	switch (item.phase) {
		case "sending":
			return createStartingWakeStep();
		case "request_sent":
		case "connecting":
		case "retrying":
			return createDispatchingWakeStep("active");
		case "queued":
			return {
				description: "This Wake will start when the Agent is available.",
				label: "Wake is queued",
				status: "active",
			};
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
