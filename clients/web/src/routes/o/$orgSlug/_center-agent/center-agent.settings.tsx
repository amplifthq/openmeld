import { createFileRoute, redirect } from "@tanstack/react-router";
import { buildOrganizationCenterAgentSettingsPath } from "#/lib/organizations/organization-routes";

/**
 * Redirect-only compatibility route. Center Agent settings now live in the
 * global App Settings destination at `/o/:orgSlug/settings/center-agent`; this
 * historical location keeps existing links and bookmarks working instead of
 * rendering a second copy of the same panel.
 */
export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/settings"
)({
	beforeLoad: ({ params }) => {
		throw redirect({
			replace: true,
			to: buildOrganizationCenterAgentSettingsPath(params.orgSlug),
		});
	},
});
