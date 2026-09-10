import { describe, expect, it } from "vitest";
import { resolveAgentProfileUsage } from "./agent-profile-usage";

const limits = [
	{
		key: "weekly",
		label: "Weekly usage",
		usedPercent: 38,
		status: "stale" as const,
		observedAt: "2026-09-10T00:00:00.000Z",
		resetsAt: null,
	},
];
const computers: Parameters<typeof resolveAgentProfileUsage>[1] = [
	{
		computerId: "laptop",
		ownerUserId: "alice",
		deviceDisplayName: "Alice's laptop",
		localAgents: [
			{
				agentControllerRef: "builtin:codex",
				enabled: true,
				status: "stale",
				details: {
					capabilities: {
						approvals: true,
						cancel: true,
						interrupt: true,
						modelSelection: true,
						nativeEventStream: true,
						permissionModes: true,
						structuredUserInput: false,
					},
					checkedAt: "2026-09-10T00:00:00.000Z",
					launch: { installChoiceCount: 1, status: "ready" },
					models: [],
					nativeInterface: "local-cli",
					status: "ready",
					version: null,
					usageLimits: limits,
				},
			},
		],
	},
];
const target = {
	routeDeviceId: "laptop",
	ownerUserId: "alice",
	agentControllerRef: "builtin:codex",
};

describe("Agent Profile usage", () => {
	it("keeps the exact reported windows, including stale evidence, for the bound Computer", () => {
		expect(resolveAgentProfileUsage(target, computers)).toEqual({
			computerName: "Alice's laptop",
			limits,
		});
	});
	it.each([
		{ ...target, ownerUserId: "bob" },
		{ ...target, routeDeviceId: "desktop" },
		{ ...target, agentControllerRef: "builtin:claude-code" },
		{ ...target, routeDeviceId: null },
	])("does not borrow another owner, Computer, or controller's quota", (readiness) => {
		expect(resolveAgentProfileUsage(readiness, computers)).toBeNull();
	});
});
