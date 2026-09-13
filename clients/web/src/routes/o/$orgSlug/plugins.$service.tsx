import { createFileRoute } from "@tanstack/react-router";
import { OrganizationPluginsPage } from "#/components/organizations/organization-plugins-page";
export const Route = createFileRoute("/o/$orgSlug/plugins/$service")({
	component: PluginRoute,
});
function PluginRoute() {
	return (
		<OrganizationPluginsPage selectedService={Route.useParams().service} />
	);
}
