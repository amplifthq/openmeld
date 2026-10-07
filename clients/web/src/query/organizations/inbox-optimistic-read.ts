import type {
	GetInboxItemResponse,
	InboxFeedQuery,
	InboxFeedResponse,
	InboxFeedRow,
	InboxItem,
	InboxSummaryResponse,
	ListInboxItemsResponse,
	MutateInboxFeedBody,
} from "@openmeld/schemas/types";
import type {
	InfiniteData,
	QueryClient,
	QueryKey,
} from "@tanstack/react-query";
import { resolveInboxItemIndicator } from "#/lib/inbox/attention";
import { inboxQueryKeys } from "./inbox";

type ReadChange = { item: InboxItem; read: boolean } | MutateInboxFeedBody;
type Patch = (key: QueryKey, data: unknown) => unknown;
type Layer = {
	patch: Patch;
	pending: boolean;
	refreshedSummaries: Set<string>;
};
type Session = {
	base: Map<string, { key: QueryKey; data: unknown }>;
	layers: Layer[];
	writing: boolean;
	unsubscribe: () => void;
};
const sessions = new WeakMap<QueryClient, Map<string, Session>>();

// Short-lived cache layers let a failed read roll back without undoing a
// different read that completed meanwhile. No separate durable read ledger.
export function optimisticallyReadInbox(
	queryClient: QueryClient,
	organizationId: string,
	change: ReadChange
) {
	let organizations = sessions.get(queryClient);
	if (!organizations) {
		organizations = new Map();
		sessions.set(queryClient, organizations);
	}
	let session = organizations.get(organizationId);
	if (!session) {
		session = {
			base: new Map(),
			layers: [],
			writing: false,
			unsubscribe: () => undefined,
		};
		organizations.set(organizationId, session);
		const active = session;
		active.unsubscribe = queryClient.getQueryCache().subscribe((event) => {
			if (
				active.writing ||
				event.type !== "updated" ||
				event.action.type !== "success" ||
				event.query.queryKey[0] !== "inbox" ||
				event.query.queryKey[1] !== organizationId
			) {
				return;
			}
			active.base.set(event.query.queryHash, {
				key: event.query.queryKey,
				data: event.query.state.data,
			});
			// A refreshed server total may already include the pending write.
			if (event.query.queryKey[2] === "attention-summary") {
				for (const layer of active.layers) {
					layer.refreshedSummaries.add(event.query.queryHash);
				}
			}
			renderLayers(queryClient, active);
		});
	}
	for (const query of queryClient
		.getQueryCache()
		.findAll({ queryKey: inboxQueryKeys.organization(organizationId) })) {
		if (!session.base.has(query.queryHash)) {
			session.base.set(query.queryHash, {
				key: query.queryKey,
				data: query.state.data,
			});
		}
	}
	const layer = {
		patch: createReadPatch(queryClient, organizationId, change),
		pending: true,
		refreshedSummaries: new Set<string>(),
	};
	session.layers.push(layer);
	renderLayers(queryClient, session);
	const active = session;
	return {
		settle(success: boolean) {
			if (!layer.pending) {
				return;
			}
			layer.pending = false;
			if (!success) {
				active.layers = active.layers.filter(
					(candidate) => candidate !== layer
				);
				renderLayers(queryClient, active);
			}
			if (!active.layers.some((candidate) => candidate.pending)) {
				active.unsubscribe();
				organizations.delete(organizationId);
			}
		},
	};
}

export function hasPendingInboxReads(
	queryClient: QueryClient,
	organizationId: string
) {
	return sessions.get(queryClient)?.has(organizationId) ?? false;
}

function renderLayers(queryClient: QueryClient, session: Session) {
	session.writing = true;
	try {
		for (const [hash, { key, data }] of session.base) {
			if (data !== undefined) {
				queryClient.setQueryData(
					key,
					session.layers.reduce<unknown>(
						(value, layer) =>
							layer.refreshedSummaries.has(hash)
								? value
								: layer.patch(key, value),
						data
					)
				);
			}
		}
	} finally {
		session.writing = false;
	}
}

function collectReadTargets(
	queryClient: QueryClient,
	organizationId: string,
	change: ReadChange
) {
	const items = new Map<string, InboxItem>();
	const groups = new Map<string, Set<string>>();
	const feeds = queryClient.getQueriesData<InfiniteData<InboxFeedResponse>>({
		queryKey: inboxQueryKeys.feeds(organizationId),
	});
	let selectedUnread = 0;
	if ("item" in change) {
		items.set(change.item.id, change.item);
	}
	// Capture only rows in the selected frozen snapshot, never a later arrival.
	for (const [key, feed] of feeds) {
		const query = key.at(-1) as InboxFeedQuery;
		let feedUnread = 0;
		for (const page of feed?.pages ?? []) {
			if ("item" in change || page.snapshotId !== change.snapshotId) {
				continue;
			}
			const selected = page.rows.filter(
				(row) =>
					!change.groupKey ||
					row.groupKey === change.groupKey ||
					query.groupKey === change.groupKey
			);
			feedUnread += selected.reduce((sum, row) => sum + row.unreadCount, 0);
			if (!(change.groupKey || query.groupKey)) {
				selectedUnread = Math.max(
					selectedUnread,
					page.selectionUnreadCount ?? 0
				);
			}
			const keys = groups.get(page.snapshotId) ?? new Set<string>();
			for (const row of selected) {
				keys.add(row.groupKey);
				items.set(row.item.id, row.item);
			}
			groups.set(page.snapshotId, keys);
		}
		selectedUnread = Math.max(selectedUnread, feedUnread);
	}
	return {
		items,
		groups,
		selectedUnread,
		parents: collectParents(feeds, items),
	};
}

function collectParents(
	feeds: [QueryKey, InfiniteData<InboxFeedResponse> | undefined][],
	items: Map<string, InboxItem>
) {
	// Expanded item reads also update their loaded parent group's count.
	const parents = new Map<string, Set<string>>();
	for (const [key, feed] of feeds) {
		const query = key.at(-1) as InboxFeedQuery;
		if (!query.groupKey) {
			continue;
		}
		for (const page of feed?.pages ?? []) {
			if (page.rows.some((row) => items.has(row.item.id))) {
				const keys = parents.get(page.snapshotId) ?? new Set<string>();
				keys.add(query.groupKey);
				parents.set(page.snapshotId, keys);
			}
		}
	}
	return parents;
}

function createReadPatch(
	queryClient: QueryClient,
	organizationId: string,
	change: ReadChange
): Patch {
	const readAt =
		"item" in change && !change.read ? null : new Date().toISOString();
	const { items, groups, parents, selectedUnread } = collectReadTargets(
		queryClient,
		organizationId,
		change
	);
	const updateItem = (item: InboxItem) =>
		items.has(item.id) ? { ...item, readAt } : item;
	const deltaFor = (item: InboxItem) =>
		(readAt === null ? 1 : 0) - (item.readAt === null ? 1 : 0);
	const knownDelta = "item" in change ? deltaFor(change.item) : -selectedUnread;
	const urgentDelta = [...items.values()]
		.filter(
			(item) => item.attention === "update" && item.importance === "urgent"
		)
		.reduce((sum, item) => sum + deltaFor(item), 0);
	return (key, data) => {
		if (!data) {
			return data;
		}
		if (key[2] === "item") {
			const detail = data as GetInboxItemResponse;
			return { ...detail, item: updateItem(detail.item) };
		}
		if (key[2] === "list") {
			const list = data as InfiniteData<ListInboxItemsResponse>;
			const unreadOnly = [
				"unread",
				"urgent_updates",
				"recent_updates",
			].includes(String(key.at(-1)));
			return {
				...list,
				pages: list.pages.map((page) => ({
					...page,
					items: page.items
						.map(updateItem)
						.filter((item) => !unreadOnly || item.readAt === null),
				})),
			};
		}
		if (key[2] === "attention-summary") {
			const summary = data as InboxSummaryResponse;
			return {
				...summary,
				totalUnreadCount: Math.max(0, summary.totalUnreadCount + knownDelta),
				unreadUrgentUpdateCount: Math.max(
					0,
					(summary.unreadUrgentUpdateCount ?? 0) + urgentDelta
				),
			};
		}
		if (key[2] !== "feed") {
			return data;
		}
		const feed = data as InfiniteData<InboxFeedResponse>;
		const query = key.at(-1) as InboxFeedQuery;
		const updated = feed.pages.map((page) => {
			let delta = 0;
			const rows = page.rows.map((row) => {
				const wholeGroup = groups.get(page.snapshotId)?.has(row.groupKey);
				const item = updateItem(row.item);
				let rowDelta = 0;
				if (wholeGroup) {
					rowDelta = -row.unreadCount;
				} else if (items.has(row.item.id)) {
					rowDelta = deltaFor(row.item);
				} else if (parents.get(page.snapshotId)?.has(row.groupKey)) {
					rowDelta = knownDelta;
				}
				if (!rowDelta && item === row.item) {
					return row;
				}
				const unreadCount = Math.max(0, row.unreadCount + rowDelta);
				delta += unreadCount - row.unreadCount;
				return {
					...row,
					item,
					unreadCount,
					dot: readRowDot(item, unreadCount),
				};
			});
			return { page, rows, delta };
		});
		const frozenView =
			!("item" in change || change.groupKey) &&
			feed.pages[0]?.snapshotId === change.snapshotId;
		const delta = frozenView
			? -(feed.pages[0]?.selectionUnreadCount ?? selectedUnread)
			: updated.reduce((sum, page) => sum + page.delta, 0);
		return {
			...feed,
			pages: updated.map(({ page, rows }) => ({
				...page,
				rows: rows.filter(
					(row) => query.unreadOnly !== "true" || row.unreadCount > 0
				),
				selectionUnreadCount:
					page.selectionUnreadCount === undefined
						? undefined
						: Math.max(0, page.selectionUnreadCount + delta),
				counts: {
					...page.counts,
					unread: Math.max(0, page.counts.unread + delta),
					...(query.unreadOnly === "true"
						? { all: Math.max(0, page.counts.all + delta) }
						: {}),
				},
			})),
		};
	};
}

function readRowDot(item: InboxItem, unreadCount: number): InboxFeedRow["dot"] {
	if (
		item.attention === "action_required" &&
		item.resolutionStatus === "open"
	) {
		return "yellow";
	}
	if (unreadCount === 0) {
		return null;
	}
	return resolveInboxItemIndicator(item) === "warning" ? "yellow" : "blue";
}
