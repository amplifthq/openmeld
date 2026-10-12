import { createFileRoute } from "@tanstack/react-router";
import { OrganizationPluginsPage } from "#/components/organizations/organization-plugins-page";
import { prefetchPluginsRouteData } from "#/lib/organizations/app-route-prefetch";
export const Route = createFileRoute("/o/$orgSlug/plugins/")({
	loader: ({ context, location, params }) => {
		// Warm both reads without waiting for either before rendering the page.
		prefetchPluginsRouteData({
			organizationSlug: params.orgSlug,
			queryClient: context.queryClient,
			queryPersistence: context.queryPersistence,
			routeFamily: location.href,
		}).catch((error: unknown) => {
			console.error("Failed to prefetch Plugins.", error);
		});
	},
	component: () => <OrganizationPluginsPage selectedService={null} />,
});
