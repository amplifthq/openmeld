import { z } from "zod/v4";

export const SLACK_INSTALL_INTENT = "slack-install";

const organizationEntrySearchSchema = z.object({
	intent: z.literal(SLACK_INSTALL_INTENT).optional(),
});

export type OrganizationEntrySearch = z.infer<
	typeof organizationEntrySearchSchema
>;
export type OrganizationEntryIntent = NonNullable<
	OrganizationEntrySearch["intent"]
>;

export function resolveOrganizationEntrySearch(
	search: unknown
): OrganizationEntrySearch {
	const parsed = organizationEntrySearchSchema.safeParse(search);
	return parsed.success ? parsed.data : {};
}
