export type AgentActivityWindowPreset = "1h" | "4h" | "today";

const HOUR_MS = 60 * 60_000;

export function resolveAgentActivityWindowMs(
	preset: AgentActivityWindowPreset,
	nowMs: number
) {
	if (preset === "1h") {
		return HOUR_MS;
	}
	if (preset === "4h") {
		return 4 * HOUR_MS;
	}
	const startOfToday = new Date(nowMs);
	startOfToday.setHours(0, 0, 0, 0);
	return Math.max(60_000, nowMs - startOfToday.getTime());
}
