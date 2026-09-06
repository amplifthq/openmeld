import {
	createFileRoute,
	Outlet,
	useRouterState,
} from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { useStartFlowState } from "#/components/app/start-flow-state";
import { CenterAgentLayout } from "#/components/organizations/center-agent-layout";
import { CenterAgentRoutePendingPage } from "#/components/organizations/center-agent-route-pending";
import {
	APP_ROUTE_PENDING_DELAY_MS,
	APP_ROUTE_PENDING_MIN_DURATION_MS,
} from "#/lib/app-route-loading";
import { resolveCenterAgentSectionId } from "#/lib/organizations/center-agent-navigation";
import { loadCenterAgentRouteContext } from "#/lib/organizations/center-agent-route-context";
import { parseCenterAgentRouteSearch } from "#/lib/organizations/center-agent-route-search";
import { useAppOrganization } from "#/lib/organizations/organization-context";

export const Route = createFileRoute("/o/$orgSlug/_center-agent")({
	staticData: appShellStaticData.centerAgent,
	validateSearch: parseCenterAgentRouteSearch,
	beforeLoad: loadCenterAgentRouteContext,
	pendingComponent: CenterAgentRoutePending,
	pendingMinMs: APP_ROUTE_PENDING_MIN_DURATION_MS,
	pendingMs: APP_ROUTE_PENDING_DELAY_MS,
	component: CenterAgentRouteLayout,
});

function CenterAgentRouteLayout() {
	const { initialOuterSidebarState } = Route.useRouteContext();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});

	return (
		<CenterAgentLayout
			currentPathname={pathname}
			initialOuterSidebarState={initialOuterSidebarState}
		>
			<Outlet />
		</CenterAgentLayout>
	);
}

function CenterAgentRoutePending() {
	const { session } = Route.useSearch();
	const { storageScope } = useStartFlowState();
	const { currentOrganization } = useAppOrganization();
	const { initialOuterSidebarState } = Route.useRouteContext();
	const { orgSlug } = Route.useParams();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});

	return (
		<CenterAgentRoutePendingPage
			initialOuterSidebarState={initialOuterSidebarState}
			organizationId={currentOrganization.id}
			organizationSlug={orgSlug}
			ownerAccountId={storageScope}
			section={resolveCenterAgentSectionId(pathname)}
			sessionId={session}
		/>
	);
}
