import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod/v4";
import { appShellStaticData } from "#/components/app/shell-layout";
import { PeopleAndAgentsPage } from "#/components/profiles/people-and-agents-page";
import { prefetchPeopleRouteData } from "#/lib/organizations/app-route-prefetch";
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
	loader: async ({ context, location, params }) => {
		prefetchPeopleRouteData({
			organizationSlug: params.orgSlug,
			queryClient: context.queryClient,
			queryPersistence: context.queryPersistence,
			routeFamily: location.href,
		}).catch((error: unknown) => {
			console.error("Failed to prefetch the People route data.", error);
		});
		return { sidebarStates: await getAppSidebarStatesForRoute() };
	},
	component: PeopleRoute,
});

function PeopleRoute() {
	const { sidebarStates } = Route.useLoaderData();
	const search = Route.useSearch();

	return (
		<PeopleAndAgentsPage
			activeSectionId="people"
			focusProfileId={search.profileId ?? null}
			initialSidebarStates={sidebarStates}
		/>
	);
}
