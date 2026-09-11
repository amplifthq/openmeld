import { createFileRoute } from "@tanstack/react-router";
import { OrganizationPluginsPage } from "#/components/organizations/organization-plugins-page";
import { findPluginDefinition } from "#/components/organizations/plugin-catalog";
import { prefetchAppDetailRouteData } from "#/lib/organizations/app-route-prefetch";
export const Route = createFileRoute("/o/$orgSlug/plugins/$service")({
	loader: ({ context, location, params }) => {
		const plugin = findPluginDefinition(params.service);
		if (plugin?.availability === "available") {
			return prefetchAppDetailRouteData({
				organizationSlug: params.orgSlug,
				queryClient: context.queryClient,
				queryPersistence: context.queryPersistence,
				routeFamily: location.href,
				service: plugin.service,
			});
		}
	},
	component: PluginRoute,
});
function PluginRoute() {
	return (
		<OrganizationPluginsPage selectedService={Route.useParams().service} />
	);
}
