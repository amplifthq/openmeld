import { createFileRoute, redirect } from "@tanstack/react-router";
import { buildOrganizationAgentCreationPath } from "#/lib/organizations/organization-routes";

export const Route = createFileRoute("/o/$orgSlug/agents_/new")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: buildOrganizationAgentCreationPath(params.orgSlug),
			replace: true,
		});
	},
});
