import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod/v4";
import { appShellStaticData } from "#/components/app/shell-layout";
import { PeopleAndAgentsPage } from "#/components/profiles/people-and-agents-page";
import { buildOrganizationPeoplePath } from "#/lib/organizations/organization-routes";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

const peopleRouteSearchSchema = z.object({
	profileId: z.string().trim().min(1).optional(),
});

export const Route = createFileRoute("/o/$orgSlug/people")({
	staticData: appShellStaticData.people,
	validateSearch: (search) => {
		const parsed = peopleRouteSearchSchema.safeParse(search);
		return parsed.success ? parsed.data : {};
	},
	loader: async () => ({ sidebarStates: await getAppSidebarStatesForRoute() }),
	component: PeopleRoute,
});

function PeopleRoute() {
	const { sidebarStates } = Route.useLoaderData();
	const { orgSlug } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate();

	return (
		<PeopleAndAgentsPage
			activeSectionId="people"
			focusProfileId={search.profileId ?? null}
			initialSidebarStates={sidebarStates}
			onFocusConsumed={() => {
				if (!search.profileId) {
					return;
				}
				navigate({
					replace: true,
					search: {},
					to: buildOrganizationPeoplePath(orgSlug),
				}).catch((error: unknown) => {
					console.error(
						"Failed to clear consumed Human Profile focus route state.",
						error
					);
				});
			}}
		/>
	);
}
