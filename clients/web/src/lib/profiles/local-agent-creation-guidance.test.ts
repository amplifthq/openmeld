import { describe, expect, it } from "vitest";
import { resolveLocalAgentCreationGuidance } from "./local-agent-creation-guidance";

const target = { deviceId: "old-computer", runtimeLane: "prod" } as const;
const readiness = {
	currentTarget: { availability: "resolved", ...target },
	service: { connected: true, matchingCurrentRuntime: true },
	status: "blocked",
	nextAction: "run_setup",
} as const;

describe("Agent creation guidance", () => {
	it("does not treat a saved target as a live connection", () => {
		expect(
			resolveLocalAgentCreationGuidance({
				target,
				queryFailed: false,
				readiness: {
					...readiness,
					service: { connected: false, matchingCurrentRuntime: false },
				},
			})
		).toBe("connect_computer");
	});
	it("does not use another computer's live connection", () => {
		expect(
			resolveLocalAgentCreationGuidance({
				target,
				queryFailed: false,
				readiness: {
					...readiness,
					currentTarget: {
						...readiness.currentTarget,
						deviceId: "new-computer",
					},
				},
			})
		).toBe("check_failed");
	});
	it("offers setup only after a matching current connection is confirmed", () => {
		expect(
			resolveLocalAgentCreationGuidance({
				target,
				queryFailed: false,
				readiness,
			})
		).toBe("set_up_local_agents");
	});
	it("keeps failed or missing checks distinct from missing installations", () => {
		expect(
			resolveLocalAgentCreationGuidance({
				target,
				queryFailed: true,
				readiness,
			})
		).toBe("check_failed");
		expect(
			resolveLocalAgentCreationGuidance({
				target,
				queryFailed: false,
				readiness: undefined,
			})
		).toBe("check_failed");
	});
	it("does not call an incomplete catalog check a missing installation", () => {
		expect(
			resolveLocalAgentCreationGuidance({
				target,
				queryFailed: false,
				readiness: { ...readiness, nextAction: "check_status" },
			})
		).toBe("check_failed");
	});
});
