import {
	resolveInboxAttentionLabel,
	resolveInboxAttentionTone,
} from "#/lib/inbox/attention";
import { mergeActiveWakeSummaries } from "./center-agent-sidebar-entry";
import {
	resolveSpaceActiveWakePresentation,
	type SpaceSidebarActiveWakeSummary,
} from "./space-active-wake-presentation";

/** The per-Space evidence the conversations sidebar already reads. */
export type SpaceStatusSources = {
	unreadBySpaceId: ReadonlyMap<
		string,
		{ unreadCount: number; messageUnreadCount?: number }
	>;
	activeWakeSummaryBySpaceId: ReadonlyMap<
		string,
		SpaceSidebarActiveWakeSummary
	>;
	attentionById: ReadonlyMap<
		string,
		{ unresolvedActionCount?: number; unreadUrgentUpdateCount?: number }
	>;
};

export type SpaceStatusIndicators = {
	unreadCount: number;
	messageUnreadCount?: number;
	activeWakeSummary?: SpaceSidebarActiveWakeSummary;
	attentionTone: "danger" | "warning" | null;
};

/**
 * Unread, active work and Inbox attention of one or more Spaces, combined the
 * way a sidebar row that stands for several Sessions presents them: counts
 * add up, active work merges (work waiting on the viewer leads), and any
 * attention shows.
 */
export function resolveSpaceStatusIndicators(
	spaceIds: readonly string[],
	sources: SpaceStatusSources
): SpaceStatusIndicators {
	let unreadCount = 0;
	let messageUnreadCount: number | undefined;
	let activeWakeSummary: SpaceSidebarActiveWakeSummary | undefined;
	let attentionTone: SpaceStatusIndicators["attentionTone"] = null;
	for (const spaceId of spaceIds) {
		const unread = sources.unreadBySpaceId.get(spaceId);
		unreadCount += unread?.unreadCount ?? 0;
		if (unread?.messageUnreadCount !== undefined) {
			messageUnreadCount =
				(messageUnreadCount ?? 0) + unread.messageUnreadCount;
		}
		const summary = sources.activeWakeSummaryBySpaceId.get(spaceId);
		if (summary) {
			activeWakeSummary = activeWakeSummary
				? mergeActiveWakeSummaries(activeWakeSummary, summary)
				: summary;
		}
		attentionTone ??= resolveInboxAttentionTone(
			sources.attentionById.get(spaceId) ?? {}
		);
	}
	return { unreadCount, messageUnreadCount, activeWakeSummary, attentionTone };
}

export function hasSpaceStatus(indicators: SpaceStatusIndicators): boolean {
	return Boolean(
		indicators.activeWakeSummary ||
			indicators.attentionTone ||
			indicators.unreadCount > 0
	);
}

/** Words for the indicator, in the order the sidebar row announces them. */
export function resolveSpaceStatusLabel(
	indicators: SpaceStatusIndicators
): string | null {
	const label = [
		resolveInboxAttentionLabel(indicators.attentionTone),
		indicators.unreadCount > 0 ? "unread updates" : null,
		indicators.activeWakeSummary
			? resolveSpaceActiveWakePresentation(indicators.activeWakeSummary).label
			: null,
	]
		.filter(Boolean)
		.join(", ");
	return label || null;
}
