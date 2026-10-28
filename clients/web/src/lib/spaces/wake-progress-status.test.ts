import type { WakeProgressItem } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveWakeProgressStatus } from "./wake-progress-status";

describe("resolveWakeProgressStatus", () => {
	it.each([
		["earlier_work", "runner · Waiting for earlier tasks"],
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
		).toBe("Agent · Working…");
	});
	it.each([
		["sending", "runner · Sending request…", "sending"],
		["request_sent", "runner · Waiting to start…", "request_sent"],
		["queued", "runner · Waiting for earlier tasks", "queued"],
		["connecting", "runner · Connecting…", "connecting"],
		["retrying", "runner · Retrying delivery…", "retrying"],
		["running", "runner · Working…", "working"],
		["writing", "runner · Working…", "working"],
		["publishing", "runner · Working…", "working"],
	] as const)("distinguishes %s from confirmed Agent work", (phase, label, kind) => {
		expect(
			resolveWakeProgressStatus(createWakeProgressItem({ phase }))
		).toEqual(expect.objectContaining({ kind, label }));
	});

	it("shows the pending owner interaction instead of claiming the Agent · Working…", () => {
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
				label: "runner · Waiting for another app",
				description: "Another app is using this conversation.",
			})
		);
	});

	it("shows a task queued behind another task in its folder as waiting, not working", () => {
		expect(
			resolveWakeProgressStatus(
				createWakeProgressItem({
					phase: "connecting",
					waitReasonCode: "runtime.local_queue.workspace_conflict",
				})
			)
		).toEqual(
			expect.objectContaining({
				kind: "queued",
				label: "runner · Waiting for another task in its folder",
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
		message: "runner · Working…",
		phase: "running",
		sourceSignalId: "signal-1",
		targetLabel: "@runner",
		targetProfileId: "agt-runner",
		terminal: false,
		updatedAtMs: 1,
		...overrides,
	};
}
