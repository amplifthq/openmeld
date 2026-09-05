import { createFileRoute, redirect } from "@tanstack/react-router";
import { SLACK_INSTALL_INTENT } from "#/lib/organizations/organization-entry-intent";
import { buildOrganizationOrganizationsPath } from "#/lib/organizations/organization-routes";
import { resolveOptionalActiveOrganizationSlug } from "#/lib/organizations/organization-scope";

const ADD_TO_SLACK_PATH = "/add-to-slack";

export const Route = createFileRoute("/add-to-slack")({
	beforeLoad: async ({ location }) => {
		const activeOrganizationSlug = await resolveOptionalActiveOrganizationSlug({
			data: { routeFamily: location.pathname },
		});
		if (!activeOrganizationSlug) {
			throw redirect({
				search: { redirect: ADD_TO_SLACK_PATH },
				to: "/login",
			});
		}

		throw redirect({
			replace: true,
			search: { intent: SLACK_INSTALL_INTENT },
			to: buildOrganizationOrganizationsPath(activeOrganizationSlug),
		});
	},
});
