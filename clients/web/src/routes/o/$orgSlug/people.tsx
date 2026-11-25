import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod/v4";
import { appShellStaticData } from "#/components/app/shell-layout";
import { TeamDirectoryPage } from "#/components/directory/team-directory-page";
import { prefetchPeopleRouteData } from "#/lib/organizations/app-route-prefetch";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

const peopleRouteSearchSchema = z.object({
	agentId: z.string().trim().min(1).optional().catch(undefined),
	profileId: z.string().trim().min(1).optional().catch(undefined),
	view: z.literal("topics").optional().catch(undefined),
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
		<TeamDirectoryPage
			initialSidebarStates={sidebarStates}
			selection={resolveTeamSelection(search)}
			view={search.view ?? "members"}
		/>
	);
}

function resolveTeamSelection(search: z.infer<typeof peopleRouteSearchSchema>) {
	if (search.agentId) {
		return { id: search.agentId, kind: "agent" as const };
	}
	if (search.profileId) {
		return { id: search.profileId, kind: "person" as const };
	}
	return undefined;
}
