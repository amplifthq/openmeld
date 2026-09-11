import { createFileRoute } from "@tanstack/react-router";
import { OrganizationPluginsPage } from "#/components/organizations/organization-plugins-page";
import { prefetchPluginCatalogRouteData } from "#/lib/organizations/app-route-prefetch";
export const Route = createFileRoute("/o/$orgSlug/plugins/")({
	loader: ({ context, location, params }) =>
		prefetchPluginCatalogRouteData({
			organizationSlug: params.orgSlug,
			queryClient: context.queryClient,
			queryPersistence: context.queryPersistence,
			routeFamily: location.href,
		}),
	component: () => <OrganizationPluginsPage selectedService={null} />,
});
