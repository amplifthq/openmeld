import type { InboxSummaryResponse } from "@openmeld/schemas/types";
import { useQuery } from "@tanstack/react-query";
import { resolveInboxAttentionTone } from "#/lib/inbox/attention";
import { inboxSummaryQueryOptions } from "#/query/organizations/inbox";

export function resolveInboxAttention(input: {
	summary: InboxSummaryResponse | undefined;
	unavailable: boolean;
	pending: boolean;
}) {
	if (input.pending && !input.summary) {
		return {
			count: null,
			tone: null,
			label: "Inbox",
			status: null,
			indicatorTone: null,
			tabLabel: null,
		} as const;
	}
	const summary = input.summary;
	if (input.unavailable || summary?.unreadUrgentUpdateCount === undefined) {
		return {
			count: null,
			tone: null,
			label: "Inbox, attention status unavailable",
			status: "Couldn’t check for updates",
			indicatorTone: null,
			tabLabel: "Inbox unavailable",
		} as const;
	}
	const actions = summary.unresolvedActionCount;
	const urgent = summary.unreadUrgentUpdateCount;
	const count = actions + urgent;
	const tone = resolveInboxAttentionTone(summary);
	const indicatorTone =
		tone ?? (summary.totalUnreadCount > 0 ? "unread" : null);
	const tabLabel = resolveInboxTabLabel(indicatorTone, summary);
	const details = [
		...(actions > 0
			? [`${actions} pending ${actions === 1 ? "item" : "items"}`]
			: []),
		...(urgent > 0
			? [`${urgent} unread urgent ${urgent === 1 ? "update" : "updates"}`]
			: []),
	].join(", ");
	const status =
		details ||
		(summary.totalUnreadCount > 0
			? `${summary.totalUnreadCount} unread`
			: "All caught up");
	return {
		count,
		tone,
		label: `Inbox, ${status}`,
		status,
		indicatorTone,
		tabLabel,
	} as const;
}

function resolveInboxTabLabel(
	tone: "danger" | "warning" | "unread" | null,
	summary: InboxSummaryResponse
): string | null {
	switch (tone) {
		case "danger":
			return `Needs action (${summary.unresolvedActionCount})`;
		case "warning":
			return `Urgent updates (${summary.unreadUrgentUpdateCount})`;
		case "unread":
			return `${summary.totalUnreadCount} unread`;
		default:
			return null;
	}
}

export function useInboxAttention(organizationId: string, background = false) {
	const summaryQuery = useQuery({
		...inboxSummaryQueryOptions({ organizationId }),
		refetchIntervalInBackground: background,
	});
	return resolveInboxAttention({
		summary: summaryQuery.data,
		unavailable: summaryQuery.isError,
		pending: summaryQuery.isPending,
	});
}
