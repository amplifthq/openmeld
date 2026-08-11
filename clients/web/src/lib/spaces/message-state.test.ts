import { describe, expect, it } from "vitest";
import {
	isSpaceWakeProgressWaitingForFinalStatus,
	resolveSpaceMessageDeliveryPresentation,
	resolveSpaceMessageDeliveryStatusText,
	SPACE_LOCAL_PENDING_MESSAGE_DELAY_MS,
	SPACE_WAKE_PROGRESS_STALE_WAITING_MS,
} from "./message-state";

const CREATED_AT_MS = Date.UTC(2026, 4, 27, 10);

describe("message-state", () => {
	it("keeps the initial sending presentation visually silent", () => {
		const presentation = resolveSpaceMessageDeliveryPresentation({
			item: {
				createdAtMs: CREATED_AT_MS,
				deliveryState: "pending",
			},
			nowMs: CREATED_AT_MS + SPACE_LOCAL_PENDING_MESSAGE_DELAY_MS - 1,
		});

		expect(presentation).toBe("sending");
		expect(resolveSpaceMessageDeliveryStatusText(presentation)).toBeNull();
	});

	it("moves a local pending message to the delayed sending copy after eight seconds", () => {
		const presentation = resolveSpaceMessageDeliveryPresentation({
			item: {
				createdAtMs: CREATED_AT_MS,
				deliveryState: "pending",
			},
			nowMs: CREATED_AT_MS + SPACE_LOCAL_PENDING_MESSAGE_DELAY_MS,
		});

		expect(presentation).toBe("sending_delayed");
		expect(resolveSpaceMessageDeliveryStatusText(presentation)).toBe(
			"Still sending..."
		);
	});

	it("does not show local sending copy for a sent message", () => {
		const presentation = resolveSpaceMessageDeliveryPresentation({
			item: {
				createdAtMs: CREATED_AT_MS,
				deliveryState: "sent",
			},
			nowMs: CREATED_AT_MS + SPACE_LOCAL_PENDING_MESSAGE_DELAY_MS,
		});

		expect(presentation).toBe("delivered");
		expect(resolveSpaceMessageDeliveryStatusText(presentation)).toBeNull();
	});

	it("uses the thinking status for admitted optimistic work", () => {
		const presentation = resolveSpaceMessageDeliveryPresentation({
			item: {
				createdAtMs: CREATED_AT_MS,
				deliveryState: "pending",
				optimisticAgentReplyState: "working",
			},
			nowMs: CREATED_AT_MS,
		});

		expect(presentation).toBe("agent_starting");
		expect(resolveSpaceMessageDeliveryStatusText(presentation)).toBe(
			"Agent is working"
		);
	});

	it("maps an active Center Agent stream to the canonical working status", () => {
		const presentation = resolveSpaceMessageDeliveryPresentation({
			item: {
				agentStreamState: {
					reasonCode: null,
					sequence: 2,
					status: "streaming",
					streamId: "stream:submission-1",
				},
				createdAtMs: CREATED_AT_MS,
				deliveryState: "sent",
			},
			nowMs: CREATED_AT_MS,
		});

		expect(presentation).toBe("agent_streaming");
		expect(resolveSpaceMessageDeliveryStatusText(presentation)).toBe(
			"Agent is working"
		);
	});

	it.each([
		["failed", "agent_stream_failed", "Reply failed"],
		["stopped", "agent_stream_stopped", "Stopped"],
		[
			"completed_but_publish_failed",
			"agent_stream_publish_failed",
			"Reply could not be posted",
		],
	] as const)("maps the %s Center Agent stream state into the shared message status presentation", (status, expectedPresentation, expectedText) => {
		const presentation = resolveSpaceMessageDeliveryPresentation({
			item: {
				agentStreamState: {
					reasonCode: "remote_agent.test",
					sequence: 2,
					status,
					streamId: "stream:submission-1",
				},
				createdAtMs: CREATED_AT_MS,
				deliveryState: "sent",
			},
			nowMs: CREATED_AT_MS,
		});

		expect(presentation).toBe(expectedPresentation);
		expect(resolveSpaceMessageDeliveryStatusText(presentation)).toBe(
			expectedText
		);
	});

	it("only switches Wake progress to final-status waiting copy after forty-five seconds without evidence", () => {
		expect(
			isSpaceWakeProgressWaitingForFinalStatus({
				lastEvidenceAtMs: CREATED_AT_MS,
				nowMs: CREATED_AT_MS + SPACE_WAKE_PROGRESS_STALE_WAITING_MS - 1,
			})
		).toBe(false);
		expect(
			isSpaceWakeProgressWaitingForFinalStatus({
				lastEvidenceAtMs: CREATED_AT_MS,
				nowMs: CREATED_AT_MS + SPACE_WAKE_PROGRESS_STALE_WAITING_MS,
			})
		).toBe(true);
		expect(
			isSpaceWakeProgressWaitingForFinalStatus({
				lastEvidenceAtMs: null,
				nowMs: CREATED_AT_MS + SPACE_WAKE_PROGRESS_STALE_WAITING_MS,
			})
		).toBe(false);
	});
});
