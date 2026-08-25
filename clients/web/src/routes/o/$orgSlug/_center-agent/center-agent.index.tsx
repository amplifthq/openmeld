import { createFileRoute, redirect } from "@tanstack/react-router";
import { buildOrganizationDefaultPath } from "#/lib/organizations/organization-routes";

export const Route = createFileRoute("/o/$orgSlug/_center-agent/center-agent/")(
	{
		beforeLoad: ({ params }) => {
			throw redirect({
				replace: true,
				to: buildOrganizationDefaultPath(params.orgSlug),
			});
		},
	}
);
