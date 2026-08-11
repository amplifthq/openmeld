import {
	createFileRoute,
	Outlet,
	useRouterState,
} from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import {
	AgentActivityPage,
	type AgentActivitySectionId,
} from "#/components/organizations/agent-activity-page";
import { agentActivitySearchSchema } from "#/lib/organizations/agent-activity-search";
import {
	buildOrganizationAgentActivityChangesPath,
	buildOrganizationAgentActivityPath,
	buildOrganizationAgentActivitySessionsPath,
} from "#/lib/organizations/organization-routes";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/agent-activity")({
	staticData: appShellStaticData.agentActivity,
	validateSearch: agentActivitySearchSchema,
	loader: async () => ({
		sidebarStates: await getAppSidebarStatesForRoute("agent-activity"),
	}),
	component: AgentActivityLayoutRoute,
});

function AgentActivityLayoutRoute() {
	const { sidebarStates } = Route.useLoaderData();
	const { orgSlug } = Route.useParams();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const routes = {
		changes: buildOrganizationAgentActivityChangesPath(orgSlug),
		overview: buildOrganizationAgentActivityPath(orgSlug),
		sessions: buildOrganizationAgentActivitySessionsPath(orgSlug),
	};
	return (
		<AgentActivityPage
			activeSectionId={resolveActivitySection(pathname)}
			initialSidebarStates={sidebarStates}
			routes={routes}
		>
			<Outlet />
		</AgentActivityPage>
	);
}

function resolveActivitySection(pathname: string): AgentActivitySectionId {
	if (pathname.endsWith("/sessions")) {
		return "sessions";
	}
	if (pathname.endsWith("/changes")) {
		return "changes";
	}
	return "overview";
}
