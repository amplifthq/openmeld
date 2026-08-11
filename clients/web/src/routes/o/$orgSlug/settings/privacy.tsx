import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { SettingsPage } from "#/components/settings/settings-page";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/settings/privacy")({
	staticData: appShellStaticData.settings,
	loader: async () => ({
		sidebarStates: await getAppSidebarStatesForRoute("settings"),
	}),
	component: PrivacySettingsRoute,
});

function PrivacySettingsRoute() {
	const { sidebarStates } = Route.useLoaderData();
	return (
		<SettingsPage
			activeSectionId="privacy"
			initialSidebarStates={sidebarStates}
		/>
	);
}
