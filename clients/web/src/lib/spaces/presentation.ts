import type {
	ConversationCompactionMarker,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
	buildSpaceMemberDirectory,
	type SpaceMemberDirectory,
	type SpaceMemberDirectoryEntry,
} from "@openmeld/space";
import {
	resolveStatusToneBadgeClassName,
	resolveStatusToneOutlineBadgeClassName,
} from "@openmeld/ui/lib/status-tone";
import { AVAILABILITY_DISPLAY_LABELS } from "#/lib/availability-display";
import {
	isSpaceExecutionRecoveryNoticeItem,
	isSpaceOutcomeNoticeItem,
	type SpaceTimelineItem,
} from "./timeline";

const CONVERSATION_GROUP_WINDOW_MS = 5 * 60 * 1000;
export const SPACE_MEMBER_STATUS_BADGE_CLASS_NAMES = {
	checking: resolveStatusToneOutlineBadgeClassName("checking"),
	inactive: resolveStatusToneOutlineBadgeClassName("muted"),
	neutral: "border-border bg-muted/35 text-muted-foreground",
	positive: resolveStatusToneBadgeClassName("ready"),
} as const;

export type SpaceMemberStatusBadgeDisplay = {
	availabilityAction: string | null;
	availabilityPhase: string | null;
	availabilityReasonCode: string | null;
	className: string | null;
	isRefreshing: boolean;
	label: string;
	tooltip: string;
	variant: "secondary" | "destructive" | "outline";
};

export type SpaceConversationBubbleRun = {
	id: string;
	isSelf: boolean;
	items: readonly SpaceTimelineItem[];
	speaker: {
		controllerDisplay: string | null;
		agentControllerRef: string | null;
		avatarImageUrl: string | null;
		displayName: string;
		ownerDisplay: string | null;
		ownerUserId: string | null;
		profileId: string;
		profileKind: "human" | "agent" | "system";
		profileName: string;
		runtimeDeviceDisplayName: string | null;
	};
};

export type SpaceConversationEntry =
	| {
			item: SpaceTimelineItem;
			kind: "system_event";
	  }
	| {
			createdAtMs: number;
			id: string;
			kind: "conversation_compaction";
			marker: ConversationCompactionMarker;
			sourceSignalId: string;
	  }
	| {
			kind: "bubble_run";
			run: SpaceConversationBubbleRun;
	  };

export type SpaceMembersPreview = {
	liveSummaryText: string;
	overflowCount: number;
	totalCount: number;
	visibleEntries: readonly SpaceMemberDirectoryEntry[];
};

export function buildSpaceConversationEntries(input: {
	groupBoundarySignalIds?: ReadonlySet<string>;
	selfProfileId: string;
	timelineItems: readonly SpaceTimelineItem[];
}): readonly SpaceConversationEntry[] {
	const entries: SpaceConversationEntry[] = [];
	const timelineItems = orderSpaceTimelineItemsForConversation(
		input.timelineItems
	);

	for (const item of timelineItems) {
		if (item.signalType !== "signal.text") {
			entries.push({
				item,
				kind: "system_event",
			});
			continue;
		}

		if (item.conversationCompaction) {
			entries.push({
				createdAtMs: item.createdAtMs,
				id: `${item.id}:conversation-compaction`,
				kind: "conversation_compaction",
				marker: item.conversationCompaction,
				sourceSignalId: item.id,
			});
		}

		const previousEntry = entries.at(-1);
		const previousItem =
			previousEntry?.kind === "bubble_run"
				? (previousEntry.run.items.at(-1) ?? null)
				: null;
		const canAppendToPreviousRun =
			previousEntry?.kind === "bubble_run" &&
			previousItem !== null &&
			!input.groupBoundarySignalIds?.has(item.id) &&
			previousEntry.run.speaker.profileId === item.actorProfileId &&
			previousEntry.run.speaker.profileKind === item.actorProfileKind &&
			isSameLocalCalendarDay(previousItem.createdAtMs, item.createdAtMs) &&
			item.createdAtMs - previousItem.createdAtMs <=
				CONVERSATION_GROUP_WINDOW_MS;

		if (canAppendToPreviousRun && previousEntry.kind === "bubble_run") {
			previousEntry.run.items = [...previousEntry.run.items, item];
			continue;
		}

		entries.push({
			kind: "bubble_run",
			run: {
				id: item.id,
				isSelf: item.actorProfileId === input.selfProfileId,
				items: [item],
				speaker: {
					controllerDisplay: item.actorControllerDisplay,
					agentControllerRef: item.actorAgentControllerRef,
					avatarImageUrl: item.actorAvatarImageUrl,
					displayName: item.actorName,
					ownerDisplay: item.actorOwnerDisplay,
					ownerUserId: item.actorOwnerUserId,
					profileId: item.actorProfileId,
					profileKind: item.actorProfileKind,
					profileName: item.actorProfileName,
					runtimeDeviceDisplayName: item.actorRuntimeDeviceDisplayName,
				},
			},
		});
	}

	return entries;
}

function isSameLocalCalendarDay(leftMs: number, rightMs: number): boolean {
	const left = new Date(leftMs);
	const right = new Date(rightMs);
	return (
		left.getFullYear() === right.getFullYear() &&
		left.getMonth() === right.getMonth() &&
		left.getDate() === right.getDate()
	);
}

// Anchored terminal_failure/wake_stopped notices no longer disappear from the
// conversation: `orderSpaceTimelineItemsForConversation` still keeps them out
// of the root/system-event stream (so they don't ALSO render at their own
// timeline position), but `buildAnchoredSpaceOutcomeNoticesBySourceSignalId`
// exposes the same suppressed notices grouped by the source message they
// belong under, so the panel can project them as an outcome row anchored to
// that source instead of dropping them.
export function orderSpaceTimelineItemsForConversation(
	timelineItems: readonly SpaceTimelineItem[]
): readonly SpaceTimelineItem[] {
	const loadedSignalIds = new Set(timelineItems.map((item) => item.id));
	const rootItems: SpaceTimelineItem[] = [];
	let suppressedAnchoredOutcomeCount = 0;

	for (const item of timelineItems) {
		const sourceSignalId = resolveAnchoredOutcomeNoticeSourceSignalId({
			item,
			loadedSignalIds,
		});
		if (!sourceSignalId) {
			rootItems.push(item);
			continue;
		}

		suppressedAnchoredOutcomeCount += 1;
	}

	if (suppressedAnchoredOutcomeCount === 0) {
		return timelineItems;
	}

	return rootItems;
}

export function buildAnchoredSpaceOutcomeNoticesBySourceSignalId(
	timelineItems: readonly SpaceTimelineItem[]
): ReadonlyMap<string, readonly SpaceTimelineItem[]> {
	const loadedSignalIds = new Set(timelineItems.map((item) => item.id));
	const noticesBySourceSignalId = new Map<string, SpaceTimelineItem[]>();

	for (const item of timelineItems) {
		const sourceSignalId = resolveAnchoredOutcomeNoticeSourceSignalId({
			item,
			loadedSignalIds,
		});
		if (!sourceSignalId) {
			continue;
		}

		const existing = noticesBySourceSignalId.get(sourceSignalId);
		if (existing) {
			existing.push(item);
		} else {
			noticesBySourceSignalId.set(sourceSignalId, [item]);
		}
	}

	return noticesBySourceSignalId;
}

export function resolveSpaceConversationFocusSignalId(input: {
	signalId?: string;
	timelineItems: readonly SpaceTimelineItem[];
}): string | undefined {
	if (!input.signalId) {
		return undefined;
	}

	const targetItem = input.timelineItems.find(
		(item) => item.id === input.signalId
	);
	if (!targetItem) {
		return input.signalId;
	}

	return (
		resolveAnchoredOutcomeNoticeSourceSignalId({
			item: targetItem,
			loadedSignalIds: new Set(input.timelineItems.map((item) => item.id)),
		}) ?? input.signalId
	);
}

function resolveAnchoredOutcomeNoticeSourceSignalId(input: {
	item: SpaceTimelineItem;
	loadedSignalIds: ReadonlySet<string>;
}): string | null {
	if (
		!(
			(isSpaceOutcomeNoticeItem(input.item) ||
				isSpaceExecutionRecoveryNoticeItem(input.item)) &&
			input.item.replyToSignalId
		) ||
		input.item.replyToSignalId === input.item.id ||
		!input.loadedSignalIds.has(input.item.replyToSignalId)
	) {
		return null;
	}

	return input.item.replyToSignalId;
}

export function buildSpaceMembersPreview(input: {
	limit: number;
	selfProfileId: string;
	snapshot: SpaceMembersSnapshot;
}): SpaceMembersPreview {
	const directory = buildSpaceMemberDirectory(input.snapshot);
	const flattenedEntries = directory.sections.flatMap(
		(section) => section.entries
	);

	return {
		liveSummaryText: resolveLiveSummaryText(input.snapshot),
		overflowCount: Math.max(0, flattenedEntries.length - input.limit),
		totalCount: flattenedEntries.length,
		visibleEntries: flattenedEntries.slice(0, input.limit).map((entry) =>
			entry.profileId === input.selfProfileId
				? {
						...entry,
						presenceLabel: entry.liveNow
							? "you · live now"
							: (entry.presenceLabel ?? "you"),
					}
				: entry
		),
	};
}

export function filterSpaceMemberDirectory(input: {
	directory: SpaceMemberDirectory;
	query: string;
}): SpaceMemberDirectory {
	const normalizedQuery = input.query.trim().toLowerCase();
	if (!normalizedQuery) {
		return input.directory;
	}

	const sections: SpaceMemberDirectory["sections"][number][] = [];
	for (const section of input.directory.sections) {
		const entries = section.entries.filter((entry) =>
			entry.searchText.includes(normalizedQuery)
		);
		if (entries.length > 0) {
			sections.push({ ...section, entries });
		}
	}

	return { sections };
}

export function buildSpaceMemberDirectoryForStatusOrder(
	directory: SpaceMemberDirectory
): SpaceMemberDirectory {
	return {
		sections: directory.sections.map((section) => ({
			...section,
			entries: sortSpaceMemberEntriesForStatusOrder(section.entries),
		})),
	};
}

export function sortSpaceMemberEntriesForStatusOrder(
	entries: readonly SpaceMemberDirectoryEntry[]
): readonly SpaceMemberDirectoryEntry[] {
	return entries
		.map((entry, index) => ({ entry, index }))
		.sort((left, right) => {
			const priorityComparison =
				resolveSpaceMemberStatusOrderPriority(left.entry) -
				resolveSpaceMemberStatusOrderPriority(right.entry);
			return priorityComparison === 0
				? left.index - right.index
				: priorityComparison;
		})
		.map(({ entry }) => entry);
}

export function resolveSpaceMemberStatusOrderPriority(
	entry: SpaceMemberDirectoryEntry
): number {
	if (entry.profileKind === "human") {
		return entry.liveNow ? 0 : 1;
	}

	if (isAvailableAgentStatusEntry(entry)) {
		return 0;
	}

	return isOfflineAgentStatusEntry(entry) ? 2 : 1;
}

export function resolveSpaceMemberStatusBadgeDisplay(
	entry: SpaceMemberDirectoryEntry
): SpaceMemberStatusBadgeDisplay | null {
	const label = resolveSpaceMemberStatusBadgeLabel(entry);
	if (!label) {
		return null;
	}

	return {
		availabilityAction:
			entry.profileKind === "agent" ? entry.availabilityAction : null,
		availabilityPhase:
			entry.profileKind === "agent" ? entry.availabilityPhase : null,
		availabilityReasonCode:
			entry.profileKind === "agent" ? entry.availabilityReasonCode : null,
		className: resolveSpaceMemberStatusBadgeClassName(entry),
		isRefreshing: resolveSpaceMemberStatusBadgeIsRefreshing(entry),
		label,
		tooltip: resolveSpaceMemberStatusBadgeTooltip(entry),
		variant: "outline",
	};
}

function resolveSpaceMemberStatusBadgeLabel(
	entry: SpaceMemberDirectoryEntry
): string | null {
	if (entry.profileKind === "agent" && entry.availabilityBadgeLabel) {
		return entry.availabilityBadgeLabel;
	}

	switch (entry.presenceStatus) {
		case "live":
			return AVAILABILITY_DISPLAY_LABELS.live;
		case "wakeable":
			return AVAILABILITY_DISPLAY_LABELS.available;
		case "checking_connection":
			return AVAILABILITY_DISPLAY_LABELS.checking;
		case "unavailable":
			return AVAILABILITY_DISPLAY_LABELS.unavailable;
		case "offline":
			return AVAILABILITY_DISPLAY_LABELS.offline;
		default:
			return null;
	}
}

function resolveSpaceMemberStatusBadgeTooltip(
	entry: SpaceMemberDirectoryEntry
): string {
	if (entry.profileKind === "agent" && entry.availabilityTooltip) {
		return entry.availabilityTooltip;
	}

	switch (entry.presenceStatus) {
		case "live":
			return entry.profileKind === "agent" ? "Live agent" : "Live human";
		case "wakeable":
			return "Available for Wake";
		case "checking_connection":
			return "Checking Wake availability";
		case "offline":
			return "Offline for Wake";
		case "unavailable":
			return "Unavailable for Wake";
		default:
			return entry.presenceLabel ?? "Profile status";
	}
}

function resolveSpaceMemberStatusBadgeClassName(
	entry: SpaceMemberDirectoryEntry
): string | null {
	if (isAvailableAgentStatusEntry(entry) || entry.presenceStatus === "live") {
		return SPACE_MEMBER_STATUS_BADGE_CLASS_NAMES.positive;
	}

	if (
		entry.availabilityCategory === "checking" ||
		entry.presenceStatus === "checking_connection"
	) {
		return SPACE_MEMBER_STATUS_BADGE_CLASS_NAMES.checking;
	}

	if (
		isOfflineAgentStatusEntry(entry) ||
		entry.availabilityCategory === "unavailable" ||
		entry.presenceStatus === "unavailable"
	) {
		return SPACE_MEMBER_STATUS_BADGE_CLASS_NAMES.inactive;
	}

	return null;
}

function resolveSpaceMemberStatusBadgeIsRefreshing(
	entry: SpaceMemberDirectoryEntry
): boolean {
	return (
		(entry.profileKind === "agent" && entry.availabilityIsRefreshing) ||
		entry.presenceStatus === "checking_connection"
	);
}

function isAvailableAgentStatusEntry(
	entry: SpaceMemberDirectoryEntry
): boolean {
	return (
		entry.profileKind === "agent" &&
		(entry.presenceStatus === "wakeable" ||
			entry.availabilityCategory === "available")
	);
}

function isOfflineAgentStatusEntry(entry: SpaceMemberDirectoryEntry): boolean {
	return (
		entry.profileKind === "agent" &&
		(entry.presenceStatus === "offline" ||
			entry.availabilityCategory === "offline")
	);
}

function resolveLiveSummaryText(snapshot: SpaceMembersSnapshot): string {
	const liveHumanCount = snapshot.humans.filter(
		(member) => member.liveNow
	).length;
	const liveAgentCount = snapshot.agents.filter(
		(member) => member.liveNow
	).length;
	const parts: string[] = [];

	if (liveAgentCount > 0) {
		parts.push(
			`${String(liveAgentCount)} live agent${liveAgentCount === 1 ? "" : "s"}`
		);
	}
	if (liveHumanCount > 0) {
		parts.push(
			`${String(liveHumanCount)} live human${liveHumanCount === 1 ? "" : "s"}`
		);
	}

	return parts.length > 0 ? parts.join(" · ") : "No one is live right now";
}
