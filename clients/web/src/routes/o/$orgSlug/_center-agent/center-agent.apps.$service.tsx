import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { findAppDefinition } from "#/components/organizations/app-catalog";
import { prefetchAppDetailRouteData } from "#/lib/organizations/app-route-prefetch";

export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/apps/$service"
)({
	staticData: appShellStaticData.centerAgent,
	loader: ({ context, location, params }) => {
		const app = findAppDefinition(params.service);
		if (app?.availability === "available") {
			prefetchAppDetailRouteData({
				organizationSlug: params.orgSlug,
				queryClient: context.queryClient,
				queryPersistence: context.queryPersistence,
				routeFamily: location.href,
				service: app.service,
			}).catch((error: unknown) => {
				console.error("Failed to prefetch the App detail route data.", error);
			});
		}
	},
});
