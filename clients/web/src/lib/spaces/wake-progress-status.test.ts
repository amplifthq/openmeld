import type { WakeProgressItem } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveWakeProgressStatus } from "./wake-progress-status";

describe("resolveWakeProgressStatus", () => {
	it.each([
		["Monica’s MacBook", "runner is working · Monica’s MacBook"],
		[null, "runner is working"],
		["  ", "runner is working"],
	])("only shows a supplied execution location (%s)", (runtimeDeviceDisplayName, label) => {
		expect(
			resolveWakeProgressStatus(
				createWakeProgressItem({ runtimeDeviceDisplayName })
			)?.label
		).toBe(label);
	});
	it.each([
		["earlier_work", "runner is queued · Waiting for earlier tasks"],
		["device_offline", "Waiting for runner’s computer to come online"],
	] as const)("preserves the authoritative waiting reason %s", (reason, label) => {
		expect(
			resolveWakeProgressStatus(
				createWakeProgressItem({
					phase: "queued",
					deviceWait: { reason, deadlineAtMs: 2000 },
				})
			)?.label
		).toBe(label);
	});
	it("does not expose a legacy Profile ID as a working name", () => {
		expect(
			resolveWakeProgressStatus(
				createWakeProgressItem({ targetLabel: "@agt_legacy_name" })
			)?.label
		).toBe("Agent is working");
	});
	it.each([
		["sending", "Starting Wake for runner…", "starting"],
		["request_sent", "Wake sent to runner", "sent"],
		["queued", "runner is queued · Waiting for earlier tasks", "queued"],
		["connecting", "Preparing runner…", "connecting"],
		["retrying", "Trying to reach runner…", "retrying"],
		["running", "runner is working", "working"],
		["writing", "runner is replying", "replying"],
		["publishing", "runner · Posting reply…", "posting"],
	] as const)("maps %s without collapsing its meaning", (phase, label, kind) => {
		expect(
			resolveWakeProgressStatus(createWakeProgressItem({ phase }))
		).toEqual(expect.objectContaining({ kind, label }));
	});

	it("shows the pending owner interaction instead of claiming the Agent is working", () => {
		expect(
			resolveWakeProgressStatus(
				createWakeProgressItem({
					pendingInteraction: {
						canRespond: true,
						expiresAtMs: 2,
						interactionId: "interaction-1",
						kind: "question",
						request: null,
						requestedAtMs: 1,
					},
				})
			)
		).toEqual(
			expect.objectContaining({
				kind: "needs_input",
				label: "runner needs your input",
				status: "pending",
			})
		);
	});

	it("shows the safe owner-waiting state to other members", () => {
		expect(
			resolveWakeProgressStatus(
				createWakeProgressItem({
					pendingInteraction: {
						canRespond: false,
						expiresAtMs: 2,
						interactionId: "interaction-1",
						kind: "permission",
						request: null,
						requestedAtMs: 1,
					},
				})
			)
		).toEqual(
			expect.objectContaining({
				kind: "waiting_for_owner",
				label: "runner is waiting for its owner",
				status: "pending",
			})
		);
	});

	it("keeps the controller conversation wait distinct from generic connecting", () => {
		expect(
			resolveWakeProgressStatus(
				createWakeProgressItem({
					phase: "connecting",
					waitReasonCode: "runtime.agent_controller_conversation.occupied",
				})
			)
		).toEqual(
			expect.objectContaining({
				kind: "waiting_for_controller",
				label: "runner is queued · Another task is running",
			})
		);
	});

	it.each([
		"failed",
		"publication_unknown",
		"replied",
		"stopped",
	] satisfies WakeProgressItem["phase"][])("does not turn terminal %s into active progress", (phase) => {
		expect(
			resolveWakeProgressStatus(createWakeProgressItem({ phase }))
		).toBeNull();
	});

	it.each([
		"failed",
		"publication_unknown",
		"replied",
		"stopped",
	] as const)("does not revive terminal %s from an earlier controller wait", (phase) => {
		expect(
			resolveWakeProgressStatus(
				createWakeProgressItem({
					phase,
					waitReasonCode: "runtime.agent_controller_conversation.occupied",
				})
			)
		).toBeNull();
	});
});

function createWakeProgressItem(
	overrides: Partial<WakeProgressItem> = {}
): WakeProgressItem {
	return {
		clientMessageId: "client-message-1",
		dispatchId: "dispatch-1",
		message: "runner is working",
		phase: "running",
		sourceSignalId: "signal-1",
		targetLabel: "@runner",
		targetProfileId: "agt-runner",
		terminal: false,
		updatedAtMs: 1,
		...overrides,
	};
}
