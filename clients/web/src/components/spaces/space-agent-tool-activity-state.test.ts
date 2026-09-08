import { describe, expect, it } from "vitest";
import { groupAgentWorkParts } from "./space-agent-tool-activity-state";

describe("Space Agent work activity state", () => {
	it("retains terminal confirmation and keeps it separate from executed work", () => {
		const work = {
			v: 1 as const,
			key: "connected_app.action.execute" as const,
			subject: {
				kind: "connected_app" as const,
				label: "Cloudflare R2: delete bucket",
			},
		};
		const base = {
			type: "tool" as const,
			toolName: "openmeld_execute_app_action",
			work,
		};
		const steps = groupAgentWorkParts([
			{ ...base, toolCallId: "proposal", state: "input-available" },
			{
				...base,
				toolCallId: "proposal",
				state: "output-available",
				work: { ...work, outcome: "confirmation_required" },
			},
			{ ...base, toolCallId: "executed", state: "output-available" },
		]);
		expect(steps).toHaveLength(2);
		expect(steps[0]?.work.outcome).toBe("confirmation_required");
		expect(steps[1]?.work.outcome).toBeUndefined();
	});
	it("hides compatibility connected Plugin work until it has a concrete subject", () => {
		expect(
			groupAgentWorkParts([
				{
					type: "tool",
					toolCallId: "legacy-connected-app",
					toolName: "openmeld_execute_app_action",
					state: "output-available",
					work: { v: 1, key: "connected_app.action.execute" },
				},
				{
					type: "tool",
					toolCallId: "specific-connected-app",
					toolName: "openmeld_execute_app_action",
					state: "output-available",
					work: {
						v: 1,
						key: "connected_app.action.execute",
						subject: {
							kind: "connected_app",
							label: "PostHog: list projects",
						},
					},
				},
			])
		).toEqual([
			{
				count: 1,
				id: "specific-connected-app",
				state: "output-available",
				work: {
					v: 1,
					key: "connected_app.action.execute",
					subject: {
						kind: "connected_app",
						label: "PostHog: list projects",
					},
				},
			},
		]);
	});
});
