import { describe, expect, it } from "vitest";
import { resolveAgentProfileOperationalStatus } from "./agent-profile-operational-status-presentation";

describe("resolveAgentProfileOperationalStatus", () => {
	it("maps owner workload facts without inventing progress", () => {
		expect(resolveAgentProfileOperationalStatus(null)).toEqual({
			label: "Not reported",
			status: "not_reported",
		});
		expect(
			resolveAgentProfileOperationalStatus(createOperationalContext("checking"))
		).toEqual({ label: "Checking", status: "checking" });
		expect(
			resolveAgentProfileOperationalStatus(createOperationalContext("idle"))
		).toEqual({ label: "Idle", status: "idle" });
		expect(
			resolveAgentProfileOperationalStatus(createOperationalContext("working"))
		).toEqual({ label: "Agent is working", status: "working" });
	});

	it("distinguishes waiting from a projected owner recovery action", () => {
		expect(
			resolveAgentProfileOperationalStatus(createOperationalContext("paused"))
		).toEqual({ label: "Waiting to continue", status: "waiting" });
		expect(
			resolveAgentProfileOperationalStatus({
				...createOperationalContext("paused"),
				recoveryAction: { kind: "skip_interrupted_work" },
			})
		).toEqual({ label: "Needs your attention", status: "needs_attention" });
	});
});

function createOperationalContext(
	status: "checking" | "idle" | "paused" | "working"
) {
	return {
		currentWorkLocation: null,
		queuedWorkLocations: [],
		recoveryAction: null,
		status,
		waitingCount: 0,
	};
}
