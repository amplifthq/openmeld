import { createFileRoute, redirect } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { DeskPage } from "#/components/desk/desk-page";
import { buildOrganizationCenterAgentChatPath } from "#/lib/organizations/organization-routes";

export const Route = createFileRoute("/o/$orgSlug/_center-agent/")({
	staticData: appShellStaticData.home,
	beforeLoad: ({ search, params }) => {
		if (search.session || search.draft || search.focusSignalId || search.view) {
			throw redirect({
				to: buildOrganizationCenterAgentChatPath(params.orgSlug, search),
				replace: true,
			});
		}
	},
	component: DeskPage,
});
