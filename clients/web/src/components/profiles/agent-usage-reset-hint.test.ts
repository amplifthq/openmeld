import type { AgentControllerUsageLimit } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveUsageResetHint } from "./agent-usage-reset-hint";

describe("provider reset guidance", () => {
	const now = Date.parse("2026-09-15T10:00:00Z");
	const limit: AgentControllerUsageLimit = {
		key: "weekly",
		label: "Weekly",
		status: "exhausted",
		usedPercent: 100,
		observedAt: new Date(now).toISOString(),
		resetsAt: new Date(now + 3_600_000).toISOString(),
	};
	it("waits for all exhausted windows, ignoring healthy windows", () => {
		const later = {
			...limit,
			key: "weekly",
			resetsAt: new Date(now + 7_200_000).toISOString(),
		};
		expect(
			resolveUsageResetHint(
				[
					limit,
					later,
					{
						...limit,
						status: "available",
						resetsAt: new Date(now + 86_400_000).toISOString(),
					},
				],
				now
			)
		).toBe(
			`Resets ${new Date("2026-09-15T12:00:00Z").toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
		);
	});
	it.each([
		[],
		[{ ...limit, status: "stale" }],
		[{ ...limit, observedAt: new Date(now - 86_400_000).toISOString() }],
		[{ ...limit, resetsAt: null }],
		[{ ...limit, resetsAt: new Date(now - 1).toISOString() }],
	] as AgentControllerUsageLimit[][])("does not promise a reset from absent or outdated evidence (%j)", (...limits) => {
		expect(resolveUsageResetHint(limits, now)).toBe("Reset time unknown");
	});
});
