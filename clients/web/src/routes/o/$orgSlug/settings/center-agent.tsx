import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { SettingsPage } from "#/components/settings/settings-page";
import { parseCenterAgentRouteSearch } from "#/lib/organizations/center-agent-route-search";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/settings/center-agent")({
	staticData: appShellStaticData.settings,
	validateSearch: (search: Record<string, unknown>) => ({
		...parseCenterAgentRouteSearch(search),
		panel:
			search.panel === "channels" || search.panel === "memory"
				? search.panel
				: undefined,
	}),
	loader: async () => ({
		sidebarStates: await getAppSidebarStatesForRoute("settings"),
	}),
	component: CenterAgentSettingsRoute,
});

function CenterAgentSettingsRoute() {
	const { sidebarStates } = Route.useLoaderData();
	return (
		<SettingsPage
			activeSectionId="center-agent"
			initialSidebarStates={sidebarStates}
		/>
	);
}
