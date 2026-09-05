import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { SettingsPage } from "#/components/settings/settings-page";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/settings/invitations")({
	staticData: appShellStaticData.settings,
	validateSearch: (search: Record<string, unknown>) => ({
		requestId:
			typeof search.requestId === "string" ? search.requestId : undefined,
	}),
	loader: async () => ({
		sidebarStates: await getAppSidebarStatesForRoute("settings"),
	}),
	component: SettingsRoute,
});

function SettingsRoute() {
	const { sidebarStates } = Route.useLoaderData();
	return (
		<SettingsPage
			activeSectionId="invitations"
			initialSidebarStates={sidebarStates}
		/>
	);
}
