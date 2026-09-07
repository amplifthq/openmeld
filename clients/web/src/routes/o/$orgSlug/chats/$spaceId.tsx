import { createFileRoute } from "@tanstack/react-router";
import { AppMainContent } from "#/components/app/app-main-content";
import { appShellStaticData } from "#/components/app/shell-layout";
import { SpaceWindowShell } from "#/components/spaces/app-space-shell";
import { SpaceLandingLoadingShell } from "#/components/spaces/space-state-surfaces";
import {
	APP_ROUTE_PENDING_DELAY_MS,
	APP_ROUTE_PENDING_MIN_DURATION_MS,
} from "#/lib/app-route-loading";
import { prefetchSpaceConversationRouteData } from "#/lib/organizations/app-route-prefetch";
import {
	APP_SIDEBAR_DEFAULT_STATES,
	getAppSidebarStatesForRoute,
} from "#/lib/sidebar-width-cookie";
import { parseDirectMessageRouteSearch } from "#/lib/spaces/direct-message-route-search";
import { isQueryCancellationError } from "#/query/query-cancellation";
import { AppSpaceEntryContent } from "../spaces/$spaceId";

export const Route = createFileRoute("/o/$orgSlug/chats/$spaceId")({
	staticData: appShellStaticData.directMessages,
	validateSearch: parseDirectMessageRouteSearch,
	loaderDeps: ({ search }) => ({ profileId: search.profileId }),
	pendingComponent: DirectMessageConversationPendingRoute,
	pendingMinMs: APP_ROUTE_PENDING_MIN_DURATION_MS,
	pendingMs: APP_ROUTE_PENDING_DELAY_MS,
	loader: async ({ context, deps, location, params }) => {
		prefetchSpaceConversationRouteData({
			organizationSlug: params.orgSlug,
			profileId: deps.profileId,
			queryClient: context.queryClient,
			queryPersistence: context.queryPersistence,
			routeFamily: location.href,
			spaceId: params.spaceId,
		}).catch((error: unknown) => {
			if (isQueryCancellationError(error)) {
				return;
			}
			console.error(
				"Failed to prefetch the Direct Message conversation.",
				error
			);
		});
		return {
			sidebarStates: await getAppSidebarStatesForRoute("direct-messages"),
		};
	},
	component: DirectMessageConversationRoute,
});

function DirectMessageConversationPendingRoute() {
	return (
		<SpaceWindowShell
			initialOuterSidebarState={APP_SIDEBAR_DEFAULT_STATES.outer}
			initialSidebarState={APP_SIDEBAR_DEFAULT_STATES.inner}
			sidebarPreferenceKey="direct-messages"
		>
			<AppMainContent bodyClassName="flex" header={null}>
				<SpaceLandingLoadingShell />
			</AppMainContent>
		</SpaceWindowShell>
	);
}

function DirectMessageConversationRoute() {
	const { orgSlug, spaceId } = Route.useParams();
	const search = Route.useSearch();
	const { sidebarStates } = Route.useLoaderData();

	return (
		<AppSpaceEntryContent
			focusInteractionId={search.focusInteractionId}
			focusSignalId={search.focusSignalId}
			focusThreadRootSignalId={search.focusThreadRootSignalId}
			initialSidebarStates={sidebarStates}
			navigationSurface="directMessages"
			orgSlug={orgSlug}
			profileId={search.profileId}
			spaceId={spaceId}
		/>
	);
}
