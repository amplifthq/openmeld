import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod/v4";
import { appShellStaticData } from "#/components/app/shell-layout";
import { buildOrganizationPeoplePath } from "#/lib/organizations/organization-routes";

const directoryLegacyMembersRouteSearchSchema = z.object({
	profileId: z.string().trim().min(1).optional(),
});

export const Route = createFileRoute("/o/$orgSlug/directory/members")({
	staticData: appShellStaticData.people,
	validateSearch: (search) => {
		const parsed = directoryLegacyMembersRouteSearchSchema.safeParse(search);
		return parsed.success ? parsed.data : {};
	},
	beforeLoad: ({ params, search }) => {
		throw redirect({
			replace: true,
			search: search.profileId ? { profileId: search.profileId } : {},
			to: buildOrganizationPeoplePath(params.orgSlug),
		});
	},
});
