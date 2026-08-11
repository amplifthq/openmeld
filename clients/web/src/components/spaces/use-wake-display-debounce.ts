import type {
	AgentWakeAvailability,
	SpaceMemberAgentSnapshot,
} from "@openmeld/schemas/types";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import { useAgentWakeAvailabilityDisplayDebounce } from "#/components/agents/use-agent-wake-availability-display-debounce";

/**
 * Display-only debounce for the Members-panel Wake badge.
 *
 * Backend `checking_connection` is honest: a 1006 socket drop blocks dispatch
 * (grace-period dispatch hard-fails, it is NOT buffered), so this debounce is
 * purely visual smoothing of the row badge. It never changes dispatch, button
 * availability, recovery, passive refresh, mention authoring, or any real
 * verdict -- those all read the raw snapshot. When a route flickers
 * available -> checking -> available within the window, the row keeps replaying
 * the last Available snapshot so the badge does not strobe. A terminal
 * offline/unavailable, a cold-start checking (no Available anchor), or a
 * checking that outlives the window all surface the real state immediately.
 */

export type { AgentWakeAvailabilityDisplayOverrideByProfileId as WakeDisplayOverrideByProfileId } from "#/components/agents/use-agent-wake-availability-display-debounce";

/**
 * Owns one debounce timer for the whole Members surface (mounted once in
 * SpaceLanding) so desktop SidePanel and mobile Drawer share a single override
 * and never count down independently.
 */
export function useWakeDisplayDebounce(
	agents: readonly SpaceMemberAgentSnapshot[]
): ReturnType<typeof useAgentWakeAvailabilityDisplayDebounce> {
	return useAgentWakeAvailabilityDisplayDebounce(agents);
}

/**
 * Projects a debounced agent row entry onto its last-Available snapshot for
 * VISUAL rendering only. Mirrors the directory's own availability projection so
 * the smoothed badge is identical to the real Available badge. The caller keeps
 * using the raw entry for every business path (recovery, wake action, mention,
 * passive refresh, diagnostics); only the row's badge/inline visuals read this.
 */
export function applyWakeAvailabilityDisplayOverride(
	entry: SpaceMemberDirectoryEntry,
	snapshot: AgentWakeAvailability
): SpaceMemberDirectoryEntry {
	if (entry.profileKind !== "agent") {
		return entry;
	}
	return {
		...entry,
		availabilityAction: snapshot.action,
		availabilityBadgeLabel: snapshot.badgeLabel,
		availabilityCategory: snapshot.category,
		availabilityIsRefreshing: snapshot.isRefreshing,
		availabilityPhase: snapshot.phase,
		availabilityReasonCode: snapshot.reasonCode,
		availabilitySummary: snapshot.summary,
		availabilityTooltip: snapshot.tooltip,
		presenceStatus: "wakeable",
	};
}
