import type { AgentControllerUsageLimit } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveAgentUsageAttention } from "./agent-usage-attention";

describe("team-facing usage attention", () => {
	const now = Date.parse("2026-10-20T10:00:00Z");
	const limit: AgentControllerUsageLimit = {
		key: "weekly",
		label: "Weekly usage",
		status: "available",
		usedPercent: 77,
		observedAt: new Date(now).toISOString(),
		resetsAt: new Date(now + 6 * 86_400_000).toISOString(),
	};

	it("shows nothing while the Agent has room", () => {
		expect(resolveAgentUsageAttention([limit], now)).toBeNull();
		expect(resolveAgentUsageAttention([], now)).toBeNull();
	});

	it("warns near the limit at the Low threshold, without a percent", () => {
		expect(
			resolveAgentUsageAttention([{ ...limit, usedPercent: 80 }], now)
		).toEqual({ kind: "near", label: "Near usage limit" });
		expect(
			resolveAgentUsageAttention([{ ...limit, usedPercent: 79 }], now)
		).toBeNull();
	});

	it("reports a reached limit with its reset distance", () => {
		expect(
			resolveAgentUsageAttention(
				[limit, { ...limit, key: "5h", status: "exhausted", usedPercent: 100 }],
				now
			)
		).toEqual({
			kind: "reached",
			label: "Usage limit reached · resets in 6 days",
		});
		expect(
			resolveAgentUsageAttention(
				[
					{
						...limit,
						status: "exhausted",
						resetsAt: new Date(now + 3 * 3_600_000).toISOString(),
					},
				],
				now
			)?.label
		).toBe("Usage limit reached · resets in 3 hours");
		expect(
			resolveAgentUsageAttention(
				[{ ...limit, status: "exhausted", resetsAt: null }],
				now
			)?.label
		).toBe("Usage limit reached");
	});

	it("ignores stale, past, and unquantified limits", () => {
		expect(
			resolveAgentUsageAttention(
				[
					{ ...limit, status: "stale", usedPercent: 99 },
					{
						...limit,
						status: "exhausted",
						resetsAt: new Date(now - 1).toISOString(),
					},
					{ ...limit, usedPercent: null },
					{
						...limit,
						usedPercent: 95,
						observedAt: new Date(now - 30 * 86_400_000).toISOString(),
					},
				],
				now
			)
		).toBeNull();
	});
});
