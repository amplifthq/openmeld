import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { PeopleAndAgentsPage } from "#/components/profiles/people-and-agents-page";
import { prefetchAgentsRouteIdentityData } from "#/lib/organizations/app-route-prefetch";
import { buildOrganizationAgentCreationRequestsPath } from "#/lib/organizations/organization-routes";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/my-agents")({
	staticData: appShellStaticData.myAgents,
	loader: async ({ context, location, params }) => {
		prefetchAgentsRouteIdentityData({
			organizationSlug: params.orgSlug,
			queryClient: context.queryClient,
			queryPersistence: context.queryPersistence,
			routeFamily: location.href,
		}).catch((error: unknown) => {
			console.error("Failed to prefetch My Agents.", error);
		});
		return { sidebarStates: await getAppSidebarStatesForRoute() };
	},
	component: MyAgentsRoute,
});

function MyAgentsRoute() {
	const { orgSlug } = Route.useParams();
	const { sidebarStates } = Route.useLoaderData();
	const navigate = useNavigate();
	return (
		<PeopleAndAgentsPage
			activeSectionId="agents"
			focusProfileId={null}
			initialSidebarStates={sidebarStates}
			myAgents
			onAgentViewChange={(view, requestId) => {
				if (view === "requests") {
					navigate({
						to: buildOrganizationAgentCreationRequestsPath({
							orgSlug,
							requestId,
						}),
					}).catch(console.error);
				}
			}}
		/>
	);
}
