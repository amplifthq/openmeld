import { AGENT_CONTROLLER_USAGE_LIMIT_STALE_AFTER_MS } from "@openmeld/schemas";
import type { AgentControllerUsageLimit } from "@openmeld/schemas/types";
import { LOW_CAPACITY_REMAINING_THRESHOLD_PERCENT } from "@openmeld/ui/components/settings-computers";

export type AgentUsageAttention =
	| { kind: "near"; label: string }
	| { kind: "reached"; label: string };

const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat("en-US", {
	numeric: "always",
});

/**
 * Team-facing usage stays quiet: no percent is shown. Only a fresh limit that
 * is exhausted, or at or below the Low threshold, returns a short warning.
 */
export function resolveAgentUsageAttention(
	limits: readonly AgentControllerUsageLimit[],
	nowMs: number
): AgentUsageAttention | null {
	const fresh = limits.filter(
		(limit) =>
			Date.parse(limit.observedAt) +
				AGENT_CONTROLLER_USAGE_LIMIT_STALE_AFTER_MS >
				nowMs &&
			(limit.resetsAt === null || Date.parse(limit.resetsAt) > nowMs)
	);
	const reached = fresh.filter(
		(limit) =>
			limit.status === "exhausted" ||
			(limit.status === "available" && (limit.usedPercent ?? 0) >= 100)
	);
	if (reached.length > 0) {
		const resetTimes = reached.map((limit) =>
			limit.resetsAt === null ? null : Date.parse(limit.resetsAt)
		);
		const resetAt = resetTimes.includes(null)
			? null
			: Math.max(...(resetTimes as number[]));
		return {
			kind: "reached",
			label:
				resetAt === null
					? "Usage limit reached"
					: `Usage limit reached · resets ${formatResetDistance(resetAt - nowMs)}`,
		};
	}
	const near = fresh.some(
		(limit) =>
			limit.status === "available" &&
			limit.usedPercent !== null &&
			100 - limit.usedPercent <= LOW_CAPACITY_REMAINING_THRESHOLD_PERCENT
	);
	return near ? { kind: "near", label: "Near usage limit" } : null;
}

function formatResetDistance(distanceMs: number): string {
	const minutes = Math.max(1, Math.ceil(distanceMs / 60_000));
	if (minutes < 60) {
		return RELATIVE_TIME_FORMATTER.format(minutes, "minute");
	}
	const hours = Math.round(minutes / 60);
	if (hours < 24) {
		return RELATIVE_TIME_FORMATTER.format(hours, "hour");
	}
	return RELATIVE_TIME_FORMATTER.format(Math.round(hours / 24), "day");
}
