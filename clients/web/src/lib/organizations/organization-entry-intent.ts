import { z } from "zod/v4";
import {
	buildOrganizationChannelsPath,
	buildOrganizationDefaultPath,
	buildOrganizationSettingsRootPath,
} from "./organization-routes";

export const SLACK_INSTALL_INTENT = "slack-install";
export const INVITE_PEOPLE_INTENT = "invite-people";

const organizationEntrySearchSchema = z.object({
	intent: z.enum([SLACK_INSTALL_INTENT, INVITE_PEOPLE_INTENT]).optional(),
});

export type OrganizationEntrySearch = z.infer<
	typeof organizationEntrySearchSchema
>;
export type OrganizationEntryIntent = NonNullable<
	OrganizationEntrySearch["intent"]
>;

export function resolveOrganizationEntryDestination(
	orgSlug: string,
	intent?: OrganizationEntryIntent
): string {
	if (intent === SLACK_INSTALL_INTENT) {
		return buildOrganizationChannelsPath(orgSlug);
	}
	if (intent === INVITE_PEOPLE_INTENT) {
		return `${buildOrganizationSettingsRootPath(orgSlug)}/invitations`;
	}
	return buildOrganizationDefaultPath(orgSlug);
}

export function resolveOrganizationEntrySearch(
	search: unknown
): OrganizationEntrySearch {
	const parsed = organizationEntrySearchSchema.safeParse(search);
	return parsed.success ? parsed.data : {};
}
