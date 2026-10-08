import { createFileRoute, redirect } from "@tanstack/react-router";
import { resolveOptionalActiveOrganizationEntryPath } from "#/lib/organizations/organization-scope";

export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		const entry = await resolveOptionalActiveOrganizationEntryPath({
			data: { routeFamily: "/" },
		});
		throw redirect({ href: entry ?? "/login" });
	},
});
