import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import { useNowMs } from "./use-now-ms";

export function formatMemberActivityTime(
	lastSeenAt: string | null | undefined,
	nowMs: number
): string | null {
	if (!lastSeenAt) {
		return null;
	}
	const timestamp = Date.parse(lastSeenAt);
	if (!Number.isFinite(timestamp)) {
		return null;
	}
	const minutes = Math.floor(Math.max(0, nowMs - timestamp) / 60_000);
	if (minutes < 1) {
		return "Now";
	}
	if (minutes < 60) {
		return `${minutes}m ago`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${hours}h ago`;
	}
	return `${Math.floor(hours / 24)}d ago`;
}

export function useMemberActivityTime(
	entry: Pick<SpaceMemberDirectoryEntry, "lastSeenAt" | "liveNow">
): string | null {
	const nowMs = useNowMs(entry.lastSeenAt && !entry.liveNow ? 60_000 : null);
	return entry.liveNow
		? "Now"
		: formatMemberActivityTime(entry.lastSeenAt, nowMs);
}
