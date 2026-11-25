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
	if (
		input.unavailable ||
		summary?.unreadUrgentUpdateCount === undefined ||
		summary.unreadMentionCount === undefined ||
		summary.ordinaryUnreadCount === undefined
	) {
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
	const urgent =
		summary.unreadPriorityUpdateCount ?? summary.unreadUrgentUpdateCount;
	const count = summary.priorityCount ?? actions + urgent;
	const tone = resolveCurrentAttentionTone(summary);
	// An older response cannot light the personal indicator. The Inbox preview
	// still shows its confirmed total, including ordinary unread activity.
	const personal = Math.min(
		summary.totalUnreadCount,
		summary.personalUnreadCount ?? 0
	);
	const indicatorTone = tone ?? (personal > 0 ? "unread" : null);
	const tabLabel = resolveInboxTabLabel(indicatorTone, summary, personal);
	const details = [
		...(actions > 0
			? [`${actions} pending ${actions === 1 ? "item" : "items"}`]
			: []),
		...(urgent > 0
			? [
					`${urgent} unread ${summary.priorityCount === undefined ? "urgent" : "priority"} ${urgent === 1 ? "update" : "updates"}`,
				]
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
		label: `Inbox, ${indicatorTone === "unread" ? tabLabel : status}`,
		status,
		indicatorTone,
		tabLabel,
	} as const;
}

function resolveCurrentAttentionTone(
	summary: InboxSummaryResponse
): "warning" | null {
	if (summary.priorityCount === undefined) {
		return resolveInboxAttentionTone(summary);
	}
	return summary.priorityCount > 0 ? "warning" : null;
}

function resolveInboxTabLabel(
	tone: "warning" | "unread" | null,
	summary: InboxSummaryResponse,
	personal: number
): string | null {
	switch (tone) {
		case "warning":
			if (summary.priorityCount !== undefined) {
				return `Priority attention (${summary.priorityCount})`;
			}
			return summary.unresolvedActionCount > 0
				? `Needs action (${summary.unresolvedActionCount})`
				: `Urgent updates (${summary.unreadUrgentUpdateCount})`;
		case "unread":
			return `${personal} unread for you`;
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
