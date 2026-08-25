import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { useStartFlowState } from "#/components/app/start-flow-state";
import { CenterAgentPage } from "#/components/organizations/center-agent-page";
import { CenterAgentPendingConversation } from "#/components/organizations/center-agent-route-pending";
import {
	APP_ROUTE_PENDING_DELAY_MS,
	APP_ROUTE_PENDING_MIN_DURATION_MS,
} from "#/lib/app-route-loading";
import { loadCenterAgentRouteData } from "#/lib/organizations/center-agent-route-loader";
import { useAppOrganization } from "#/lib/organizations/organization-context";

export const Route = createFileRoute("/o/$orgSlug/_center-agent/")({
	staticData: appShellStaticData.home,
	preload: false,
	loader: async ({ context, location, params }) => {
		return await loadCenterAgentRouteData({
			organizationSlug: params.orgSlug,
			queryClient: context.queryClient,
			routeFamily: location.href,
			shouldOpenDirectMessage: true,
		});
	},
	pendingComponent: CenterAgentConversationPending,
	pendingMinMs: APP_ROUTE_PENDING_MIN_DURATION_MS,
	pendingMs: APP_ROUTE_PENDING_DELAY_MS,
	component: CenterAgentHomeRoute,
});

function CenterAgentConversationPending() {
	const { storageScope } = useStartFlowState();
	const { currentOrganization } = useAppOrganization();
	const { orgSlug } = Route.useParams();

	return (
		<CenterAgentPendingConversation
			organizationId={currentOrganization.id}
			organizationSlug={orgSlug}
			ownerAccountId={storageScope}
		/>
	);
}

function CenterAgentHomeRoute() {
	const directMessageRouteData = Route.useLoaderData();
	const { focusSignalId, view } = Route.useSearch();
	return (
		<CenterAgentPage
			directMessageRouteData={directMessageRouteData}
			initialFocusSignalId={focusSignalId}
			initialSpaceView={view}
		/>
	);
}
