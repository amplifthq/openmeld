import { createFileRoute, redirect } from "@tanstack/react-router";
import { buildOrganizationCenterAgentSettingsPath } from "#/lib/organizations/organization-routes";
export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/channels"
)({
	beforeLoad: ({ params, location }) => {
		const search = new URLSearchParams(location.searchStr);
		search.set("panel", "channels");
		throw redirect({
			replace: true,
			href: `${buildOrganizationCenterAgentSettingsPath(params.orgSlug)}?${search}`,
		});
	},
});
