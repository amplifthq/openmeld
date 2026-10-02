import { createFileRoute, redirect } from "@tanstack/react-router";
import { buildOrganizationSkillPath } from "#/lib/organizations/organization-routes";

export const Route = createFileRoute(
	"/o/$orgSlug/center-agent/skills/$skillId"
)({
	beforeLoad: ({ params, location, search }) => {
		throw redirect({
			to: buildOrganizationSkillPath(params),
			search: { appSettings: search.appSettings },
			hash: location.hash,
			replace: true,
		});
	},
});
