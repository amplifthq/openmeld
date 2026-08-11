import { createFileRoute, redirect } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { buildOrganizationAccountSettingsPath } from "#/lib/organizations/organization-routes";

// Bare organization Settings lands on the default leaf (Account). Deep-links to a leaf
// stay on that leaf; this index only handles the parent path itself.
export const Route = createFileRoute("/o/$orgSlug/settings/")({
	staticData: appShellStaticData.settings,
	beforeLoad: ({ params }) => {
		throw redirect({
			replace: true,
			to: buildOrganizationAccountSettingsPath(params.orgSlug),
		});
	},
});
