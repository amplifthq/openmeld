import { createFileRoute, redirect } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { buildOrganizationPeoplePath } from "#/lib/organizations/organization-routes";

export const Route = createFileRoute("/o/$orgSlug/directory/")({
	staticData: appShellStaticData.people,
	beforeLoad: ({ params }) => {
		throw redirect({
			replace: true,
			to: buildOrganizationPeoplePath(params.orgSlug),
		});
	},
});
