import type {
	InboxFeedCategory,
	InboxFeedQuery,
} from "@openmeld/schemas/types";
import { createFileRoute } from "@tanstack/react-router";
import {
	parseAsBoolean,
	parseAsString,
	parseAsStringLiteral,
	useQueryStates,
} from "nuqs";
import { InboxAvatarProvider } from "#/components/inbox/inbox-avatars";
import { InboxPage } from "#/components/inbox/inbox-page";
import { prefetchInboxRouteData } from "#/lib/organizations/app-route-prefetch";
import { inboxViewParser } from "#/lib/page-tab-search";

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
	// Read the same immediate URL state that the controls update. Router search
	// can lag behind while unrelated route loaders are still in flight.
	const [search, setSearch] = useQueryStates({
		// Keep the legacy view=unread spelling readable; category validation below
		// still uses the canonical Inbox view parser.
		view: parseAsString
			.withDefault("all")
			.withOptions({ history: "push", scroll: false }),
		unread: parseAsBoolean.withDefault(false),
		agents: parseAsBoolean.withDefault(false),
		people: parseAsBoolean.withDefault(false),
		conversation: parseAsStringLiteral([
			"all",
			"direct_messages",
			"spaces",
		]).withDefault("all"),
		item: parseAsString,
		requestId: parseAsString,
	});
	const view = resolveInboxRouteView(search.view);
	const unreadOnly = search.unread || search.view === "unread";
	const itemId = resolveInboxItemId(search.item);
	return (
		<InboxAvatarProvider>
			<InboxPage
				agentsOnly={search.agents === true}
				conversationType={search.conversation}
				itemId={itemId}
				onFiltersChange={({ agentsOnly, peopleOnly, conversationType }) => {
					setSearch(
						{
							item: null,
							requestId: null,
							agents: agentsOnly,
							people: peopleOnly,
							conversation: conversationType,
						},
						{ history: "replace", scroll: false }
					);
				}}
				onItemDismissed={(dismissedItemId) => {
					if (itemId !== dismissedItemId) {
						return;
					}
					setSearch(
						{ item: null, requestId: null },
						{ history: "replace", scroll: false }
					);
				}}
				onUnreadOnlyChange={(unreadOnly) => {
					setSearch(
						{
							view: view ?? "all",
							item: null,
							requestId: null,
							unread: unreadOnly,
						},
						{ history: "replace", scroll: false }
					);
				}}
				onViewChange={(view) => {
					setSearch({
						view: buildInboxRouteView(view) ?? "all",
						unread: unreadOnly,
						item: null,
						requestId: null,
					});
				}}
				peopleOnly={!search.agents && search.people}
				requestId={resolveInboxItemId(search.requestId)}
				unreadOnly={unreadOnly}
				view={parseInboxRouteView(view)}
			/>
		</InboxAvatarProvider>
	);
}

function resolveInboxRouteView(value: unknown): InboxRouteView | undefined {
	const parsed =
		typeof value === "string" ? inboxViewParser.parse(value) : null;
	return parsed === "all" ? undefined : (parsed ?? undefined);
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
