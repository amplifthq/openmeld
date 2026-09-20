import { createFileRoute, redirect } from "@tanstack/react-router";
import { buildOrganizationSkillsPath } from "#/lib/organizations/organization-routes";

export const Route = createFileRoute("/o/$orgSlug/center-agent/skills/")({
	beforeLoad: ({ params, location, search }) => {
		throw redirect({
			to: buildOrganizationSkillsPath(params.orgSlug),
			// Only the parent app's validated settings overlay is shared. Skills
			// has no URL query state; draft/group/session must not survive.
			search: { appSettings: search.appSettings },
			hash: location.hash,
			replace: true,
		});
	},
});
