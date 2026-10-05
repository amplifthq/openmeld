import type {
	InboxFeedCategory,
	InboxFeedQuery,
} from "@openmeld/schemas/types";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { InboxAvatarProvider } from "#/components/inbox/inbox-avatars";
import { InboxPage } from "#/components/inbox/inbox-page";
import { prefetchInboxRouteData } from "#/lib/organizations/app-route-prefetch";

type InboxRouteView = "all" | "mentions" | "needs-action" | "needs-review";

export const Route = createFileRoute("/o/$orgSlug/inbox/")({
	validateSearch: (
		search: Record<string, unknown>
	): {
		item?: string;
		requestId?: string;
		view?: InboxRouteView;
		unread?: boolean;
		agents?: boolean;
		people?: boolean;
		conversation?: InboxFeedQuery["conversationType"];
	} => {
		const item = resolveInboxItemId(search.item);
		return {
			item,
			requestId: resolveInboxItemId(search.requestId),
			view: resolveInboxRouteView(search.view),
			people:
				!(search.agents === true || search.agents === "true") &&
				(search.people === true || search.people === "true")
					? true
					: undefined,
			conversation:
				search.conversation === "direct_messages" ||
				search.conversation === "spaces"
					? search.conversation
					: undefined,
			agents:
				search.agents === true || search.agents === "true" ? true : undefined,
			unread:
				search.unread === true ||
				search.unread === "true" ||
				search.view === "unread"
					? true
					: undefined,
		};
	},
	loaderDeps: ({ search }) => ({
		grouping: "space" as const,
		category: parseInboxRouteView(search.view),
		unreadOnly: search.unread === true,
		agentsOnly: search.agents === true,
		peopleOnly: search.people === true,
		conversationType: search.conversation ?? "all",
	}),
	loader: ({ context, params, location, deps }) => {
		prefetchInboxRouteData({
			organizationSlug: params.orgSlug,
			queryClient: context.queryClient,
			queryPersistence: context.queryPersistence,
			routeFamily: location.href,
			filters: deps,
		}).catch((error: unknown) => {
			console.error("Failed to prefetch Inbox data.", error);
		});
	},
	component: InboxIndexRoute,
});

function InboxIndexRoute() {
	const navigate = useNavigate({ from: Route.fullPath });
	const search = Route.useSearch();
	return (
		<InboxAvatarProvider>
			<InboxPage
				agentsOnly={search.agents === true}
				conversationType={search.conversation}
				itemId={search.item}
				onFiltersChange={({ agentsOnly, peopleOnly, conversationType }) => {
					navigate({
						replace: true,
						search: {
							...search,
							item: undefined,
							requestId: undefined,
							agents: agentsOnly || undefined,
							people: peopleOnly || undefined,
							conversation:
								conversationType === "all" ? undefined : conversationType,
						},
					}).catch((error: unknown) => {
						console.error("Failed to change Inbox filters.", error);
					});
				}}
				onItemDismissed={(itemId) => {
					if (search.item !== itemId) {
						return;
					}
					navigate({
						replace: true,
						search: { ...search, item: undefined, requestId: undefined },
					}).catch((error: unknown) => {
						console.error("Failed to close the dismissed Inbox item.", error);
					});
				}}
				onUnreadOnlyChange={(unreadOnly) => {
					navigate({
						replace: true,
						search: {
							...search,
							item: undefined,
							requestId: undefined,
							unread: unreadOnly || undefined,
						},
					}).catch((error: unknown) => {
						console.error("Failed to change the Inbox unread filter.", error);
					});
				}}
				onViewChange={(view) => {
					navigate({
						replace: true,
						search: {
							...search,
							item: undefined,
							requestId: undefined,
							view: buildInboxRouteView(view),
						},
					}).catch((error: unknown) => {
						console.error("Failed to change the Inbox view.", error);
					});
				}}
				peopleOnly={search.people === true}
				requestId={search.requestId}
				unreadOnly={search.unread === true}
				view={parseInboxRouteView(search.view)}
			/>
		</InboxAvatarProvider>
	);
}

function resolveInboxRouteView(value: unknown): InboxRouteView | undefined {
	return value === "needs-action" ||
		value === "needs-review" ||
		value === "mentions"
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

function parseInboxRouteView(
	view: InboxRouteView | undefined
): InboxFeedCategory {
	if (view === "needs-review") {
		return "needs_review";
	}
	return view === "needs-action" ? "needs_action" : (view ?? "all");
}

function buildInboxRouteView(
	view: InboxFeedCategory
): InboxRouteView | undefined {
	return view === "all"
		? undefined
		: (view.replace("_", "-") as InboxRouteView);
}
