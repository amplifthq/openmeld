import type { InboxSummaryResponse } from "@openmeld/schemas/types";
import { useQuery } from "@tanstack/react-query";
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
		} as const;
	}
	const summary = input.summary;
	if (input.unavailable || summary?.unreadUrgentUpdateCount === undefined) {
		return {
			count: null,
			tone: null,
			label: "Inbox, attention status unavailable",
			status: "Couldn’t check for updates",
		} as const;
	}
	const actions = summary.unresolvedActionCount;
	const urgent = summary.unreadUrgentUpdateCount;
	const count = actions + urgent;
	let tone: "danger" | "warning" | null = null;
	if (actions > 0) {
		tone = "danger";
	} else if (urgent > 0) {
		tone = "warning";
	}
	const details = [
		...(actions > 0
			? [`${actions} ${actions === 1 ? "item needs" : "items need"} action`]
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
	} as const;
}

export function useInboxAttention(organizationId: string) {
	const summaryQuery = useQuery(inboxSummaryQueryOptions({ organizationId }));
	return resolveInboxAttention({
		summary: summaryQuery.data,
		unavailable: summaryQuery.isError,
		pending: summaryQuery.isPending,
	});
}
