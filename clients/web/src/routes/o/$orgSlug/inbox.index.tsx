import type { InboxFeedQuery } from "@openmeld/schemas/types";
import { createFileRoute } from "@tanstack/react-router";
import { parseAsString, useQueryStates } from "nuqs";
import { InboxAvatarProvider } from "#/components/inbox/inbox-avatars";
import { InboxPage } from "#/components/inbox/inbox-page";
import { prefetchInboxRouteData } from "#/lib/organizations/app-route-prefetch";
import { inboxViewParser } from "#/lib/page-tab-search";

type InboxRouteView =
	| "todo"
	| "all"
	| "mentions"
	| "needs-action"
	| "needs-review";

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
			view:
				search.view === "unread" ? "all" : resolveInboxRouteView(search.view),
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
	loaderDeps: () => ({
		category: "todo" as const,
		unreadOnly: false,
		agentsOnly: false,
		peopleOnly: false,
		conversationType: "all" as const,
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
	const [search, setSearch] = useQueryStates({
		item: parseAsString,
		requestId: parseAsString,
	});
	const itemId = resolveInboxItemId(search.item);
	return (
		<InboxAvatarProvider>
			<InboxPage
				itemId={itemId}
				onItemDismissed={(dismissedItemId) => {
					if (itemId === dismissedItemId) {
						setSearch(
							{ item: null, requestId: null },
							{ history: "replace", scroll: false }
						);
					}
				}}
				onViewChange={() => undefined}
				requestId={resolveInboxItemId(search.requestId)}
				view="todo"
			/>
		</InboxAvatarProvider>
	);
}

function resolveInboxRouteView(value: unknown): InboxRouteView | undefined {
	const parsed =
		typeof value === "string" ? inboxViewParser.parse(value) : null;
	return parsed === "todo" ? undefined : (parsed ?? undefined);
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
