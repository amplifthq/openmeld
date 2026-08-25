import type { SpaceTimelineItem } from "./timeline";

export const SPACE_LOCAL_PENDING_MESSAGE_DELAY_MS = 8000;
export const SPACE_WAKE_PROGRESS_STALE_WAITING_MS = 45_000;
export const SPACE_AGENT_WORKING_STATUS_TEXT = "Agent is working";

export type SpaceMessageDeliveryPresentation =
	| "delivered"
	| "send_failed"
	| "sending"
	| "sending_delayed"
	| "agent_sending"
	| "agent_starting"
	| "agent_streaming"
	| "agent_stream_failed"
	| "agent_stream_stopped"
	| "agent_stream_publish_failed";

export function resolveSpaceMessageDeliveryPresentation(input: {
	item: Pick<
		SpaceTimelineItem,
		| "agentStreamState"
		| "createdAtMs"
		| "deliveryState"
		| "optimisticAgentReplyState"
	>;
	nowMs: number;
}): SpaceMessageDeliveryPresentation | null {
	if (input.item.optimisticAgentReplyState === "sending") {
		return "agent_sending";
	}
	if (input.item.optimisticAgentReplyState === "working") {
		return "agent_starting";
	}
	if (input.item.agentStreamState) {
		switch (input.item.agentStreamState.status) {
			case "streaming":
				return "agent_streaming";
			case "failed":
				return "agent_stream_failed";
			case "stopped":
				return "agent_stream_stopped";
			case "completed_but_publish_failed":
				return "agent_stream_publish_failed";
			default: {
				const _exhaustive: never = input.item.agentStreamState.status;
				return _exhaustive;
			}
		}
	}
	if (input.item.deliveryState === "sent") {
		return "delivered";
	}
	if (input.item.deliveryState === "failed") {
		return "send_failed";
	}

	return input.nowMs - input.item.createdAtMs >=
		SPACE_LOCAL_PENDING_MESSAGE_DELAY_MS
		? "sending_delayed"
		: "sending";
}

export function resolveSpaceMessageDeliveryStatusText(
	presentation: SpaceMessageDeliveryPresentation | null
): string | null {
	if (!presentation) {
		return null;
	}
	switch (presentation) {
		case "delivered":
			return null;
		case "send_failed":
			return "Message not sent";
		case "sending":
			return null;
		case "sending_delayed":
			return "Still sending...";
		case "agent_sending":
			return "Sending to Agent…";
		case "agent_starting":
			return SPACE_AGENT_WORKING_STATUS_TEXT;
		case "agent_streaming":
			return SPACE_AGENT_WORKING_STATUS_TEXT;
		case "agent_stream_failed":
			return "Reply failed";
		case "agent_stream_stopped":
			return "Stopped";
		case "agent_stream_publish_failed":
			return "Reply could not be posted";
		default: {
			const _exhaustive: never = presentation;
			return _exhaustive;
		}
	}
}

export function isSpaceWakeProgressWaitingForFinalStatus(input: {
	lastEvidenceAtMs: number | null;
	nowMs: number;
}): boolean {
	return (
		input.lastEvidenceAtMs !== null &&
		input.nowMs - input.lastEvidenceAtMs >= SPACE_WAKE_PROGRESS_STALE_WAITING_MS
	);
}
