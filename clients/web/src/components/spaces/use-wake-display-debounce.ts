import type {
	AgentWakeAvailability,
	SpaceMemberAgentSnapshot,
} from "@openmeld/schemas/types";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import { useAgentWakeAvailabilityDisplayDebounce } from "#/components/agents/use-agent-wake-availability-display-debounce";

/**
 * Display-only debounce for the Members-panel Wake badge.
 *
 * While a refresh has no new verdict, the badge may keep the last Available
 * snapshot briefly. An explicit Checking, Offline, or Unavailable verdict is
 * displayed immediately. Dispatch and actions always read the raw snapshot.
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
 * Projects a row without a fresh verdict onto its last Available visuals.
 * The caller keeps using the raw entry for every business decision.
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
