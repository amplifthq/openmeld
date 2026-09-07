import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { PeopleAndAgentsPage } from "#/components/profiles/people-and-agents-page";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/people_/$personId")({
	staticData: appShellStaticData.people,
	loader: async () => ({ sidebarStates: await getAppSidebarStatesForRoute() }),
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
