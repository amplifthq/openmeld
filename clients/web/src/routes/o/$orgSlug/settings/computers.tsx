import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod/v4";
import { appShellStaticData } from "#/components/app/shell-layout";
import {
	buildOrganizationComputerPath,
	buildOrganizationComputersPath,
} from "#/lib/organizations/organization-routes";

const legacySettingsComputersSearchSchema = z.object({
	focus: z.literal("service").optional(),
	refresh: z.literal("setup-complete").optional(),
});

export const Route = createFileRoute("/o/$orgSlug/settings/computers")({
	staticData: appShellStaticData.computers,
	validateSearch: (search) => {
		const parsed = legacySettingsComputersSearchSchema.safeParse(search);
		return parsed.success ? parsed.data : {};
	},
	beforeLoad: ({ params, search }) => {
		const deviceId = (params as Record<string, string | undefined>).deviceId;
		throw redirect({
			replace: true,
			search,
			to: deviceId
				? buildOrganizationComputerPath({ deviceId, orgSlug: params.orgSlug })
				: buildOrganizationComputersPath(params.orgSlug),
		});
	},
});
