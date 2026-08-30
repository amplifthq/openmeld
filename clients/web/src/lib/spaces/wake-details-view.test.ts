import type { WakeProgressItem } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveWakeProgressThinkingStep } from "./wake-details-view";

describe("wake details view", () => {
	it("tells the user when a Wake is waiting in the Agent queue", () => {
		expect(
			resolveWakeProgressThinkingStep({
				clientMessageId: "client-message-queued",
				dispatchId: "dispatch-queued",
				message: "Wake for @runner is queued.",
				phase: "queued",
				sourceSignalId: "sig-source-queued",
				targetLabel: "@runner",
				targetProfileId: "agt-runner",
				terminal: false,
				updatedAtMs: Date.UTC(2026, 5, 3, 22, 7),
			} as WakeProgressItem)
		).toEqual({
			description: "This Wake will start when the Agent is available.",
			label: "Wake is queued",
			status: "active",
		});
	});

	it("returns no thinking step once a Wake reaches a terminal stopped phase", () => {
		expect(
			resolveWakeProgressThinkingStep({
				clientMessageId: "client-message-1",
				dispatchId: "dispatch-1",
				message: "Wake was stopped.",
				phase: "stopped",
				sourceSignalId: "sig-source",
				targetLabel: "@runner",
				targetProfileId: "agt-runner",
				terminal: true,
				updatedAtMs: Date.UTC(2026, 5, 3, 22, 8),
			} as WakeProgressItem)
		).toBeNull();
	});
});
