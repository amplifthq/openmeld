import type { WebPerformancePolicy } from "@openmeld/schemas";

// One operational tuning point. Served at runtime; open clients refresh on
// their next navigation after five minutes, without a page reload.
export const WEB_PERFORMANCE_POLICY: WebPerformancePolicy = {
	version: 1,
	enabled: true,
	navigationThresholdMs: 1500,
	interactionThresholdMs: 250,
	maxReportsPerHour: 20,
};
