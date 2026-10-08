import { createFileRoute, redirect } from "@tanstack/react-router";
import { buildOrganizationCenterAgentSettingsPath } from "#/lib/organizations/organization-routes";
export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/memory"
)({
	beforeLoad: ({ params, location }) => {
		const search = new URLSearchParams(location.searchStr);
		search.set("panel", "memory");
		throw redirect({
			replace: true,
			href: `${buildOrganizationCenterAgentSettingsPath(params.orgSlug)}?${search}`,
		});
	},
});
