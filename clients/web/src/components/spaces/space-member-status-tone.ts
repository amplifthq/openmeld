import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import {
	resolveStatusToneTextClassName,
	type StatusTone,
} from "@openmeld/ui/lib/status-tone";

export function resolveSpaceMemberInlineStatusTextClassName(
	entry: SpaceMemberDirectoryEntry
): string {
	return resolveStatusToneTextClassName(resolveSpaceMemberStatusTone(entry));
}

export function resolveSpaceMemberStatusTone(
	entry: SpaceMemberDirectoryEntry
): StatusTone {
	if (entry.profileKind === "human") {
		return entry.liveNow || entry.presenceStatus === "live" ? "ready" : "muted";
	}

	switch (entry.availabilityCategory) {
		case "available":
			return "ready";
		case "checking":
			return "checking";
		case "unavailable":
			return "warning";
		case "offline":
			return "muted";
		default:
			break;
	}

	if (entry.presenceStatus === "wakeable" || entry.presenceStatus === "live") {
		return "ready";
	}

	if (entry.presenceStatus === "checking_connection") {
		return "checking";
	}

	if (entry.presenceStatus === "unavailable") {
		return "warning";
	}

	return "muted";
}
