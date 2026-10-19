import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod/v4";
import { PersonAgentsPage } from "#/components/agents/person-agents-page";
import { appShellStaticData } from "#/components/app/shell-layout";
import { prefetchAgentsRouteIdentityData } from "#/lib/organizations/app-route-prefetch";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute(
	"/o/$orgSlug/people_/$personId_/agents_/$agentId"
)({
	staticData: appShellStaticData.people,
	validateSearch: z.object({
		from: z.literal("agents").optional().catch(undefined),
		/** The MemberAgent page the Profile was opened from, to return to. */
		memberAgentId: z.string().min(1).optional().catch(undefined),
	}),
	loader: async ({ context, location, params }) => {
		prefetchAgentsRouteIdentityData({
			organizationSlug: params.orgSlug,
			queryClient: context.queryClient,
			queryPersistence: context.queryPersistence,
			routeFamily: location.href,
		}).catch((error: unknown) => {
			console.error("Failed to prefetch the Agent detail route data.", error);
		});
		return { sidebarStates: await getAppSidebarStatesForRoute() };
	},
	component: PersonAgentRoute,
});

function PersonAgentRoute() {
	const { personId, agentId } = Route.useParams();
	const { from, memberAgentId } = Route.useSearch();
	const { sidebarStates } = Route.useLoaderData();
	return (
		<PersonAgentsPage
			agentId={agentId}
			initialSidebarStates={sidebarStates}
			personId={personId}
			returnToAgentDirectory={from === "agents"}
			returnToMemberAgentId={from === "agents" ? memberAgentId : undefined}
		/>
	);
}
