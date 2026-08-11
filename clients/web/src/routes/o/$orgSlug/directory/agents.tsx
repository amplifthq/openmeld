import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod/v4";
import { appShellStaticData } from "#/components/app/shell-layout";
import { buildOrganizationAgentsPath } from "#/lib/organizations/organization-routes";

const legacyDirectoryAgentsSearchSchema = z.object({
	profileId: z.string().trim().min(1).optional(),
});

export const Route = createFileRoute("/o/$orgSlug/directory/agents")({
	staticData: appShellStaticData.agents,
	validateSearch: (search) => {
		const parsed = legacyDirectoryAgentsSearchSchema.safeParse(search);
		return parsed.success ? parsed.data : {};
	},
	beforeLoad: ({ params, search }) => {
		throw redirect({
			replace: true,
			search: search.profileId ? { profileId: search.profileId } : {},
			to: buildOrganizationAgentsPath(params.orgSlug),
		});
	},
});
