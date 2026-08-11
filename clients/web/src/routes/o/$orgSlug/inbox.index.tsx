import type { InboxView } from "@openmeld/schemas/types";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { InboxPage } from "#/components/inbox/inbox-page";

type InboxRouteView = "all" | "needs-action" | "unread";

export const Route = createFileRoute("/o/$orgSlug/inbox/")({
	validateSearch: (search: Record<string, unknown>) => {
		const item = resolveInboxItemId(search.item);
		return {
			item,
			view: item ? undefined : resolveInboxRouteView(search.view),
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
					search: { item: undefined, view: undefined },
				}).catch((error: unknown) => {
					console.error("Failed to close the dismissed Inbox item.", error);
				});
			}}
			onViewChange={(view) => {
				navigate({
					replace: true,
					search: {
						item: undefined,
						view: buildInboxRouteView(view),
					},
				}).catch((error: unknown) => {
					console.error("Failed to change the Inbox view.", error);
				});
			}}
			view={parseInboxRouteView(search.view)}
		/>
	);
}

function resolveInboxRouteView(value: unknown): InboxRouteView | undefined {
	return value === "unread" || value === "needs-action" ? value : undefined;
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
	return view === "needs-action" ? "needs_action" : (view ?? "all");
}

function buildInboxRouteView(view: InboxView): InboxRouteView | undefined {
	return view === "all"
		? undefined
		: (view.replace("_", "-") as InboxRouteView);
}
