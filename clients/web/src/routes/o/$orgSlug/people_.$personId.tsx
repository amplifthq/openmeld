import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { PeopleAndAgentsPage } from "#/components/profiles/people-and-agents-page";
import { prefetchPeopleRouteData } from "#/lib/organizations/app-route-prefetch";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/people_/$personId")({
	staticData: appShellStaticData.people,
	loader: async ({ context, location, params }) => {
		prefetchPeopleRouteData({
			organizationSlug: params.orgSlug,
			queryClient: context.queryClient,
			queryPersistence: context.queryPersistence,
			routeFamily: location.href,
		}).catch((error: unknown) => {
			console.error("Failed to prefetch the member route data.", error);
		});
		return { sidebarStates: await getAppSidebarStatesForRoute() };
	},
	component: PersonRoute,
});

function PersonRoute() {
	const { personId } = Route.useParams();
	const { sidebarStates } = Route.useLoaderData();
	return (
		<PeopleAndAgentsPage
			activeSectionId="people"
			focusProfileId={personId}
			initialSidebarStates={sidebarStates}
		/>
	);
}
