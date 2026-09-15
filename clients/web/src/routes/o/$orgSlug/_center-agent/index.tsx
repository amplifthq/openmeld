import { createFileRoute, redirect } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import {
	buildOrganizationCenterAgentChatPath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";

export const Route = createFileRoute("/o/$orgSlug/_center-agent/")({
	staticData: appShellStaticData.home,
	beforeLoad: ({ search, params }) => {
		if (search.session || search.draft || search.focusSignalId || search.view) {
			throw redirect({
				to: buildOrganizationCenterAgentChatPath(params.orgSlug, search),
				replace: true,
			});
		}
		throw redirect({
			to: buildOrganizationSpacesPath(params.orgSlug),
			replace: true,
		});
	},
});
