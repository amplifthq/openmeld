import { AGENT_CONTROLLER_USAGE_LIMIT_STALE_AFTER_MS } from "@openmeld/schemas";
import type { AgentControllerUsageLimit } from "@openmeld/schemas/types";

// A current provider observation is guidance, never a promise that a past Wake can resume.
export function resolveUsageResetHint(
	limits: readonly AgentControllerUsageLimit[],
	nowMs: number
): string {
	const exhausted = limits.filter(
		(limit) =>
			limit.status === "exhausted" &&
			Date.parse(limit.observedAt) +
				AGENT_CONTROLLER_USAGE_LIMIT_STALE_AFTER_MS >
				nowMs &&
			(limit.resetsAt === null || Date.parse(limit.resetsAt) > nowMs)
	);
	if (!exhausted.length || exhausted.some((limit) => !limit.resetsAt)) {
		return "Reset time unknown";
	}
	const resetAt = Math.max(
		...exhausted.map((limit) => Date.parse(limit.resetsAt ?? ""))
	);
	return `Resets ${new Date(resetAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}
