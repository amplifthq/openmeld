import { describe, expect, it } from "vitest";
import {
	isSpaceMessageAgentWorking,
	resolveSpaceMessageDeliveryPresentation,
	resolveSpaceMessageDeliveryStatusText,
	SPACE_LOCAL_PENDING_MESSAGE_DELAY_MS,
} from "./message-state";

const CREATED_AT_MS = Date.UTC(2026, 4, 27, 10);

describe("message-state", () => {
	it.each([
		["running", true],
		["writing", true],
		["publishing", true],
		["sending", false],
		["request_sent", false],
		["connecting", false],
		["retrying", false],
		["queued", false],
		["stopped", false],
		["failed", false],
		["replied", false],
	] as const)("animates an Agent reply only during work: %s", (phase, expected) => {
		expect(
			isSpaceMessageAgentWorking({
				actorProfileKind: "agent",
				activeWakeProgress: {
					clientMessageId: "client-1",
					dispatchId: "dispatch-1",
					failureReasonCode: null,
					message: "Agent progress",
					phase,
					sourceSignalId: "source-1",
					startedAtMs: CREATED_AT_MS,
					targetLabel: "Review Partner",
					targetProfileId: "remote-1",
					terminal: false,
					updatedAtMs: CREATED_AT_MS,
				},
			})
		).toBe(expected);
	});
	it("stops after a stream ends and leaves published messages still", () => {
		for (const status of [
			"streaming",
			"stopped",
			"failed",
			"completed_but_publish_failed",
		] as const) {
			expect(
				isSpaceMessageAgentWorking({
					actorProfileKind: "agent",
					agentStreamState: {
						status,
						sequence: 1,
						streamId: "stream-1",
						reasonCode: null,
					},
				})
			).toBe(status === "streaming");
		}
		expect(isSpaceMessageAgentWorking({ actorProfileKind: "agent" })).toBe(
			false
		);
	});
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

	it("keeps a definitively failed local submission visible as not sent", () => {
		const presentation = resolveSpaceMessageDeliveryPresentation({
			item: {
				createdAtMs: CREATED_AT_MS,
				deliveryState: "failed",
			},
			nowMs: CREATED_AT_MS + SPACE_LOCAL_PENDING_MESSAGE_DELAY_MS,
		});

		expect(presentation).toBe("send_failed");
		expect(resolveSpaceMessageDeliveryStatusText(presentation)).toBe(
			"Message not sent"
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
			"Working…"
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
});
