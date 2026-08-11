import { createFileRoute, useParams } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { CenterAgentSectionFrame } from "#/components/organizations/center-agent-section-frame";
import { OrganizationAppsPage } from "#/components/organizations/organization-apps-page";
import { prefetchAppCatalogRouteData } from "#/lib/organizations/app-route-prefetch";
import { buildOrganizationAppsPath } from "#/lib/organizations/organization-routes";

const TRAILING_SLASHES_PATTERN = /\/+$/u;

export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/apps"
)({
	staticData: appShellStaticData.centerAgent,
	loader: ({ context, location, params }) => {
		if (
			location.pathname.replace(TRAILING_SLASHES_PATTERN, "") ===
			buildOrganizationAppsPath(params.orgSlug)
		) {
			prefetchAppCatalogRouteData({
				organizationSlug: params.orgSlug,
				queryClient: context.queryClient,
				queryPersistence: context.queryPersistence,
				routeFamily: location.href,
			}).catch((error: unknown) => {
				console.error("Failed to prefetch the Apps route data.", error);
			});
		}
	},
	component: AppsRoute,
});

function AppsRoute() {
	const params = useParams({ strict: false });
	const selectedService =
		typeof params.service === "string" ? params.service : null;
	return (
		<CenterAgentSectionFrame
			routeState={{ appsSelectedService: selectedService }}
		>
			<OrganizationAppsPage />
		</CenterAgentSectionFrame>
	);
}
