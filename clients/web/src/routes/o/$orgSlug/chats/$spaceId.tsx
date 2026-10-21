import { createFileRoute, useLocation } from "@tanstack/react-router";
import { AppMainContent } from "#/components/app/app-main-content";
import { appShellStaticData } from "#/components/app/shell-layout";
import { SpaceWindowShell } from "#/components/spaces/app-space-shell";
import { ConversationsSidebar } from "#/components/spaces/conversations-sidebar";
import { SpaceLandingLoadingShell } from "#/components/spaces/space-state-surfaces";
import { useSpacePanelWidth } from "#/components/spaces/use-space-panel-width";
import {
	APP_ROUTE_PENDING_DELAY_MS,
	APP_ROUTE_PENDING_MIN_DURATION_MS,
} from "#/lib/app-route-loading";
import { readInboxSourceFocusRequestId } from "#/lib/inbox/source-focus-request";
import {
	prefetchSpaceConversationRouteData,
	restoreSpaceConversationRouteData,
} from "#/lib/organizations/app-route-prefetch";
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
	loaderDeps: ({ search }) => ({
		profileId: search.profileId,
		focusSignalId: search.focusSignalId,
		focusThreadRootSignalId: search.focusThreadRootSignalId,
	}),
	pendingComponent: DirectMessageConversationPendingRoute,
	pendingMinMs: APP_ROUTE_PENDING_MIN_DURATION_MS,
	pendingMs: APP_ROUTE_PENDING_DELAY_MS,
	loader: async ({ context, deps, location, params }) => {
		// Paint the saved conversation before the network revalidates it, the
		// same way the Space route does.
		const restored = restoreSpaceConversationRouteData({
			organizationSlug: params.orgSlug,
			profileId: deps.profileId,
			queryClient: context.queryClient,
			queryPersistence: context.queryPersistence,
			routeFamily: location.href,
			spaceId: params.spaceId,
		});
		restored
			.then(() =>
				prefetchSpaceConversationRouteData({
					focusSignalId: deps.focusSignalId,
					focusThreadRootSignalId: deps.focusThreadRootSignalId,
					organizationSlug: params.orgSlug,
					profileId: deps.profileId,
					queryClient: context.queryClient,
					queryPersistence: context.queryPersistence,
					routeFamily: location.href,
					spaceId: params.spaceId,
				})
			)
			.catch((error: unknown) => {
				if (isQueryCancellationError(error)) {
					return;
				}
				console.error(
					"Failed to prefetch the Direct Message conversation.",
					error
				);
			});
		await restored.catch(() => undefined);
		return {
			sidebarStates: await getAppSidebarStatesForRoute("direct-messages"),
		};
	},
	component: DirectMessageConversationRoute,
});

function DirectMessageConversationPendingRoute() {
	const search = Route.useSearch();
	const { spaceId } = Route.useParams();
	const membersPanel = useSpacePanelWidth({ panel: "members", spaceId });
	return (
		<SpaceWindowShell
			initialOuterSidebarState={APP_SIDEBAR_DEFAULT_STATES.outer}
			initialSidebarState={APP_SIDEBAR_DEFAULT_STATES.inner}
			sidebar={<ConversationsSidebar />}
			sidebarPreferenceKey="direct-messages"
		>
			<AppMainContent bodyClassName="flex" showHeader={false}>
				<SpaceLandingLoadingShell
					membersPanelWidth={membersPanel.width}
					spaceId={spaceId}
					threadOpen={Boolean(search.focusThreadRootSignalId)}
				/>
			</AppMainContent>
		</SpaceWindowShell>
	);
}

function DirectMessageConversationRoute() {
	const { orgSlug, spaceId } = Route.useParams();
	const search = Route.useSearch();
	const { sidebarStates } = Route.useLoaderData();
	const focusRequestId = useLocation({
		select: (location) => readInboxSourceFocusRequestId(location.state),
	});

	return (
		<AppSpaceEntryContent
			focusInteractionId={search.focusInteractionId}
			focusRequestId={focusRequestId}
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
