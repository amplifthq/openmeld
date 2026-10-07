import { inboxItemSchema } from "@openmeld/schemas";
import type {
	InboxFeedCategory,
	InboxFeedQuery,
	InboxFeedResponse,
	InboxItem,
	MutateInboxFeedBody,
} from "@openmeld/schemas/types";
import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import { resolveInboxAttention } from "../../src/components/inbox/use-inbox-attention";

const InboxPage = lazy(() =>
	import("../../src/components/inbox/inbox-page").then((m) => ({
		default: m.InboxPage,
	}))
);

let items: InboxItem[] = [
	[
		"release",
		"Launch room",
		"Maya mentioned you",
		"The launch brief is ready. Can you review the rollout plan?",
		"mention",
	],
	[
		"research",
		"Customer research",
		"Customer interviews are ready",
		"James added findings from six customer interviews.",
		"update",
	],
	[
		"website",
		"Website refresh",
		"New work to review",
		"The first page is ready for your feedback.",
		"update",
	],
].map(([spaceId, contextLabel, title, preview, attention], index) =>
	inboxItemSchema.parse({
		id: `demo-inbox-${index}`,
		organizationId: "org",
		recipientUserId: "preview",
		kind: attention === "mention" ? "space_mention" : "space_message",
		attention: "update",
		importance: "normal",
		resolutionStatus: "not_applicable",
		sourceFacts: {
			version: 1,
			recipientReasons: [
				attention === "mention" ? "human_mention" : "space_member",
			],
		},
		contextLabel,
		title,
		preview,
		readAt: null,
		createdAt: "2026-10-07T10:00:00.000Z",
		updatedAt: "2026-10-07T10:00:00.000Z",
		occurredAt: "2026-10-07T10:00:00.000Z",
		sourceTarget: { kind: "space", spaceId, signalId: `demo-message-${index}` },
	})
);
const selections = new Map<string, string[]>();
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
function notifyReadChange() {
	for (const listener of listeners) {
		listener();
	}
}
export function useDemoInboxAttention() {
	const unread = useSyncExternalStore(
		subscribe,
		() => items.filter((item) => !item.readAt).length
	);
	return resolveInboxAttention({
		pending: false,
		unavailable: false,
		summary: {
			organizationId: "org",
			totalUnreadCount: unread,
			unresolvedActionCount: 0,
			unreadUrgentUpdateCount: 0,
			unreadMentionCount: items.filter(
				(i) => !i.readAt && i.kind === "space_mention"
			).length,
			ordinaryUnreadCount: items.filter(
				(i) => !i.readAt && i.kind !== "space_mention"
			).length,
		},
	});
}
let sequence = 0;
export function listCurrentInboxFeed(
	query: InboxFeedQuery
): Promise<InboxFeedResponse> {
	const selected = items.filter(
		(item) =>
			(!query.groupKey || item.id === query.groupKey) &&
			(query.unreadOnly !== "true" || !item.readAt) &&
			(!query.category ||
				query.category === "all" ||
				(query.category === "mentions" && item.kind === "space_mention")) &&
			query.agentsOnly !== "true" &&
			query.conversationType !== "direct_messages"
	);
	const snapshotId = `demo-${++sequence}`;
	selections.set(
		snapshotId,
		selected.map((item) => item.id)
	);
	return Promise.resolve<InboxFeedResponse>({
		organizationId: "org",
		snapshotId,
		snapshotExpiresAt: "2099-01-01T00:00:00.000Z",
		nextCursor: null,
		counts: {
			all: items.length,
			mentions: items.filter((i) => i.kind === "space_mention").length,
			needsAction: 0,
			needsReview: 0,
			unread: items.filter((i) => !i.readAt).length,
			priority: 0,
		},
		selectionUnreadCount: selected.filter((i) => !i.readAt).length,
		rows: selected.map((item) => ({
			item,
			groupKey: item.id,
			itemCount: 1,
			unreadCount: item.readAt ? 0 : 1,
			latestOccurredAt: item.occurredAt,
			section: "activity",
			requestCategory: null,
			dot: item.readAt ? null : "blue",
		})),
	});
}
export function markCurrentInboxItemRead(input: {
	itemId: string;
	read: boolean;
}) {
	items = items.map((item) =>
		item.id === input.itemId
			? { ...item, readAt: input.read ? new Date().toISOString() : null }
			: item
	);
	notifyReadChange();
	return getCurrentInboxItem(input);
}
export function getCurrentInboxItem(input: { itemId: string }) {
	const item = items.find((i) => i.id === input.itemId);
	if (!item) {
		throw new Error("Inbox item not found");
	}
	return Promise.resolve({ item });
}
export function dismissCurrentInboxItem(input: { itemId: string }) {
	items = items.filter((i) => i.id !== input.itemId);
	notifyReadChange();
	return Promise.resolve({ dismissedItemId: input.itemId });
}
export async function mutateCurrentInboxFeed(input: MutateInboxFeedBody) {
	const ids = selections.get(input.snapshotId) ?? [];
	const selected = items.filter(
		(i) => ids.includes(i.id) && (!input.groupKey || i.id === input.groupKey)
	);
	for (const item of selected) {
		if (input.operation === "read") {
			await markCurrentInboxItemRead({ itemId: item.id, read: true });
		} else {
			await dismissCurrentInboxItem({ itemId: item.id });
		}
	}
	return { changedCount: selected.length };
}
export function useDemoInboxExpansion() {
	const [all, setAll] = useState(false);
	const [exceptions, setExceptions] = useState(new Set<string>());
	return {
		isExpanded: (id: string) => (exceptions.has(id) ? !all : all),
		toggle: (id: string) =>
			setExceptions((current) => {
				const next = new Set(current);
				if (next.has(id)) {
					next.delete(id);
				} else {
					next.add(id);
				}
				return next;
			}),
		setAll: (value: boolean) => {
			setAll(value);
			setExceptions(new Set());
		},
	};
}
export function DemoInbox() {
	const [view, setView] = useState<InboxFeedCategory>("all");
	const [unread, setUnread] = useState(false);
	const [filters, setFilters] = useState<{
		agentsOnly: boolean;
		peopleOnly: boolean;
		conversationType: "all" | "spaces" | "direct_messages";
	}>({ agentsOnly: false, peopleOnly: false, conversationType: "all" });
	return (
		<div className="mx-auto w-full max-w-6xl overflow-auto p-8 lg:px-16 lg:py-10">
			<Suspense fallback={null}>
				<InboxPage
					onUnreadOnlyChange={setUnread}
					onViewChange={setView}
					searchEnabled={false}
					unreadOnly={unread}
					view={view}
					{...filters}
					onFiltersChange={setFilters}
				/>
			</Suspense>
		</div>
	);
}
