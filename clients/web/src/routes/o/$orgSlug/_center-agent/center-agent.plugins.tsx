import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	buildOrganizationPluginPath,
	buildOrganizationPluginsPath,
} from "#/lib/organizations/organization-routes";
export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/plugins"
)({
	beforeLoad: ({ params, location }) => {
		const service = location.pathname.split("/center-agent/plugins/")[1];
		const path = service
			? buildOrganizationPluginPath({
					orgSlug: params.orgSlug,
					service: decodeURIComponent(service),
				})
			: buildOrganizationPluginsPath(params.orgSlug);
		throw redirect({ href: path + location.searchStr, replace: true });
	},
});
