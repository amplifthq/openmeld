import { describe, expect, it } from "vitest";
import { agentTaskActivityNavigation } from "./agent-task-activity";

describe("Agent task destinations", () => {
	it("uses only work locations disclosed by the owning projection", () => {
		const context = { status: "working" as const, waitingCount: 1 };
		expect(
			agentTaskActivityNavigation({ operationalContext: context })
		).toEqual({ current: null, queued: [] });
		const spaceId = "a".repeat(64);
		expect(
			agentTaskActivityNavigation({
				operationalContext: {
					...context,
					currentWorkLocation: { spaceId, spaceName: "Release room" },
				},
			})?.current
		).toEqual({
			href: `/spaces/${spaceId}`,
			source: "space",
			title: "Release room",
		});
	});
	it.each([
		"idle",
		"checking",
	] as const)("does not invent work locations for %s", (status) => {
		const operationalContext =
			status === "idle" ? { status, waitingCount: 0 as const } : { status };
		expect(agentTaskActivityNavigation({ operationalContext })).toBeNull();
	});
});
