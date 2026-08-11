import type { WakeProgressItem } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveWakeProgressThinkingStep } from "./wake-details-view";

describe("wake details view", () => {
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
