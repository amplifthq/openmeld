import { createFileRoute, Navigate } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationPluginsPath } from "#/lib/organizations/organization-routes";

export const Route = createFileRoute("/o/$orgSlug/settings/connected-apps")({
	staticData: appShellStaticData.settings,
	component: ConnectedAppsSettingsRoute,
});

function ConnectedAppsSettingsRoute() {
	const { currentOrganization } = useAppOrganization();
	return (
		<Navigate
			replace
			to={buildOrganizationPluginsPath(currentOrganization.slug)}
		/>
	);
}
