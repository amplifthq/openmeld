import { createFileRoute } from "@tanstack/react-router";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
import { OrganizationHomePage } from "#/components/organizations/organization-home-page";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/")({
	staticData: appShellStaticData.home,
	loader: async () => ({
		sidebarStates: await getAppSidebarStatesForRoute(),
	}),
	component: OrganizationHomeRoute,
});

function OrganizationHomeRoute() {
	const { sidebarStates } = Route.useLoaderData();

	return (
		<AppFullWidthLayout initialOuterSidebarState={sidebarStates.outer}>
			<OrganizationHomePage />
		</AppFullWidthLayout>
	);
}
