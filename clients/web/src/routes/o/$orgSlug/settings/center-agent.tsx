import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { SettingsPage } from "#/components/settings/settings-page";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/settings/center-agent")({
	staticData: appShellStaticData.settings,
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
