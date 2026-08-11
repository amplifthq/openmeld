import { describe, expect, it } from "vitest";
import { groupAgentWorkParts } from "./space-agent-tool-activity-state";

describe("Space Agent work activity state", () => {
	it("hides compatibility connected App work until it has a concrete subject", () => {
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
