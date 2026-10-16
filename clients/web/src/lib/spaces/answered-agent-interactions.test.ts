import type { WakeProgressItem } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	presentAnsweredAgentInteractions,
	resolveAgentInteractionAnswerKey,
} from "./answered-agent-interactions";
import { resolveWakeProgressStatus } from "./wake-progress-status";

function waitingItem(input: {
	interactionId: string;
	runtimeCoordinatorExecutionId: string;
}): WakeProgressItem {
	return {
		clientMessageId: `client-${input.interactionId}`,
		dispatchId: `dispatch-${input.interactionId}`,
		failureReasonCode: null,
		message: "The Agent is waiting for your response.",
		pendingInteraction: {
			canRespond: true,
			expiresAtMs: Date.UTC(2026, 9, 18),
			interactionId: input.interactionId,
			kind: "permission",
			request: null,
			requestedAtMs: Date.UTC(2026, 9, 17),
		},
		phase: "running",
		runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
		sourceSignalId: `signal-${input.interactionId}`,
		targetLabel: "@Grok",
		targetProfileId: "agt_grok",
		terminal: false,
		updatedAtMs: Date.UTC(2026, 9, 17),
	};
}

describe("presentAnsweredAgentInteractions", () => {
	it("shows an answered request as running everywhere and leaves others waiting", () => {
		const answered = waitingItem({
			interactionId: "interaction-answered",
			runtimeCoordinatorExecutionId: "rce-1",
		});
		const waiting = waitingItem({
			interactionId: "interaction-waiting",
			runtimeCoordinatorExecutionId: "rce-2",
		});

		const presented = presentAnsweredAgentInteractions(
			[answered, waiting],
			new Set([
				resolveAgentInteractionAnswerKey({
					interactionId: "interaction-answered",
					runtimeCoordinatorExecutionId: "rce-1",
				}),
			])
		);

		expect(presented[0]?.pendingInteraction).toBeNull();
		expect(
			resolveWakeProgressStatus(presented[0] as WakeProgressItem)?.kind
		).not.toBe("needs_input");
		expect(presented[1]).toBe(waiting);
		expect(resolveWakeProgressStatus(waiting)?.kind).toBe("needs_input");
	});

	it("does not treat a later request in the same execution as answered", () => {
		const nextRequest = waitingItem({
			interactionId: "interaction-next",
			runtimeCoordinatorExecutionId: "rce-1",
		});
		const items = [nextRequest];

		expect(
			presentAnsweredAgentInteractions(
				items,
				new Set([
					resolveAgentInteractionAnswerKey({
						interactionId: "interaction-answered",
						runtimeCoordinatorExecutionId: "rce-1",
					}),
				])
			)
		).toBe(items);
	});
});
