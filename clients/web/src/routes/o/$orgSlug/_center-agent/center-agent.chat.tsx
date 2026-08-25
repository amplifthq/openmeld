import { createFileRoute, redirect } from "@tanstack/react-router";
import { buildOrganizationDefaultPath } from "#/lib/organizations/organization-routes";

export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/chat"
)({
	beforeLoad: ({ params, search }) => {
		throw redirect({
			replace: true,
			search,
			to: buildOrganizationDefaultPath(params.orgSlug),
		});
	},
});
