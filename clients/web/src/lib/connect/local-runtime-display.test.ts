import { describe, expect, it } from "vitest";
import { buildExecutionTargetLabel } from "./local-runtime-display";

describe("local-runtime-display", () => {
	it("summarizes all available local agents instead of naming the first agent", () => {
		expect(
			buildExecutionTargetLabel({
				capabilities: [
					{ agentControllerRef: "builtin:codex", status: "ready" },
					{ agentControllerRef: "builtin:claude-code", status: "ready" },
					{ agentControllerRef: "builtin:openclaw", status: "ready" },
				],
				runtimeLane: "dev-local",
				status: "ready",
				userFacingCommand: "openmeld-dev",
			})
		).toBe("3 local agents available");
	});

	it("keeps production execution target copy focused on readiness", () => {
		expect(
			buildExecutionTargetLabel({
				capabilities: [
					{ agentControllerRef: "builtin:codex", status: "ready" },
				],
				runtimeLane: "prod",
				status: "ready",
				userFacingCommand: "openmeld",
			})
		).toBe("1 local agent available");
	});

	it("does not expose stale runtime internals to users", () => {
		expect(
			buildExecutionTargetLabel({
				capabilities: [
					{ agentControllerRef: "builtin:codex", status: "stale" },
				],
				runtimeLane: "dev-local",
				status: "stale",
				userFacingCommand: "openmeld-dev",
			})
		).toBe("Needs a fresh check from OpenMeld Service");
	});
});
