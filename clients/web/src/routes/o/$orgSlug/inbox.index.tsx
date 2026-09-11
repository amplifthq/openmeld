import type { InboxView } from "@openmeld/schemas/types";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { InboxPage } from "#/components/inbox/inbox-page";

type InboxRouteView = "all" | "needs-action" | "needs-review";

export const Route = createFileRoute("/o/$orgSlug/inbox/")({
	validateSearch: (
		search: Record<string, unknown>
	): {
		item?: string;
		requestId?: string;
		view?: InboxRouteView;
		unread?: boolean;
	} => {
		const item = resolveInboxItemId(search.item);
		return {
			item,
			requestId: resolveInboxItemId(search.requestId),
			view: item ? undefined : resolveInboxRouteView(search.view),
			unread:
				!item &&
				(search.unread === true ||
					search.unread === "true" ||
					search.view === "unread")
					? true
					: undefined,
		};
	},
	component: InboxIndexRoute,
});

function InboxIndexRoute() {
	const navigate = useNavigate({ from: Route.fullPath });
	const search = Route.useSearch();
	return (
		<InboxPage
			itemId={search.item}
			onItemDismissed={(itemId) => {
				if (search.item !== itemId) {
					return;
				}
				navigate({
					replace: true,
					search: { item: undefined, requestId: undefined, view: undefined },
				}).catch((error: unknown) => {
					console.error("Failed to close the dismissed Inbox item.", error);
				});
			}}
			onUnreadOnlyChange={(unreadOnly) => {
				navigate({
					replace: true,
					search: { view: search.view, unread: unreadOnly || undefined },
				}).catch((error: unknown) => {
					console.error("Failed to change the Inbox unread filter.", error);
				});
			}}
			onViewChange={(view) => {
				navigate({
					replace: true,
					search: {
						item: undefined,
						requestId: undefined,
						view: buildInboxRouteView(view),
						unread: search.unread,
					},
				}).catch((error: unknown) => {
					console.error("Failed to change the Inbox view.", error);
				});
			}}
			requestId={search.requestId}
			unreadOnly={search.unread === true}
			view={parseInboxRouteView(search.view)}
		/>
	);
}

function resolveInboxRouteView(value: unknown): InboxRouteView | undefined {
	return value === "needs-action" || value === "needs-review"
		? value
		: undefined;
}

function resolveInboxItemId(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const normalized = value.trim();
	return normalized.length > 0 && normalized.length <= 256
		? normalized
		: undefined;
}

function parseInboxRouteView(view: InboxRouteView | undefined): InboxView {
	if (view === "needs-review") {
		return "needs_review";
	}
	return view === "needs-action" ? "needs_action" : (view ?? "all");
}

function buildInboxRouteView(view: InboxView): InboxRouteView | undefined {
	return view === "all"
		? undefined
		: (view.replace("_", "-") as InboxRouteView);
}
