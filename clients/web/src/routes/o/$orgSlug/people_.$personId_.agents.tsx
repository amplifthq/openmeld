import { createFileRoute } from "@tanstack/react-router";
import { PersonAgentsPage } from "#/components/agents/person-agents-page";
import { appShellStaticData } from "#/components/app/shell-layout";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/people_/$personId_/agents")({
	staticData: appShellStaticData.people,
	loader: async () => ({ sidebarStates: await getAppSidebarStatesForRoute() }),
	component: PersonAgentsRoute,
});

function PersonAgentsRoute() {
	const { personId } = Route.useParams();
	const { sidebarStates } = Route.useLoaderData();
	return (
		<PersonAgentsPage
			initialSidebarStates={sidebarStates}
			personId={personId}
		/>
	);
}
