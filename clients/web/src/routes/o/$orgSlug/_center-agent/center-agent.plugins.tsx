import { createFileRoute, useParams } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { CenterAgentSectionFrame } from "#/components/organizations/center-agent-section-frame";
import { OrganizationPluginsPage } from "#/components/organizations/organization-plugins-page";
import { prefetchPluginCatalogRouteData } from "#/lib/organizations/app-route-prefetch";
import { buildOrganizationPluginsPath } from "#/lib/organizations/organization-routes";

const TRAILING_SLASHES_PATTERN = /\/+$/u;

export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/plugins"
)({
	staticData: appShellStaticData.centerAgent,
	loader: ({ context, location, params }) => {
		if (
			location.pathname.replace(TRAILING_SLASHES_PATTERN, "") ===
			buildOrganizationPluginsPath(params.orgSlug)
		) {
			prefetchPluginCatalogRouteData({
				organizationSlug: params.orgSlug,
				queryClient: context.queryClient,
				queryPersistence: context.queryPersistence,
				routeFamily: location.href,
			}).catch((error: unknown) => {
				console.error("Failed to prefetch the Plugins route data.", error);
			});
		}
	},
	component: PluginsRoute,
});

function PluginsRoute() {
	const params = useParams({ strict: false });
	const selectedService =
		typeof params.service === "string" ? params.service : null;
	return (
		<CenterAgentSectionFrame
			routeState={{ pluginsSelectedService: selectedService }}
		>
			<OrganizationPluginsPage />
		</CenterAgentSectionFrame>
	);
}
