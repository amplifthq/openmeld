import { queryOptions, skipToken } from "@tanstack/react-query";
import { z } from "zod/v4";
import { PERSISTED_DISPLAY_QUERY_GC_TIME_MS } from "#/query/query-config";

// Layout only. The viewer's last confirmed membership picks which composer bar
// to paint before the members read returns; it never grants or blocks actions.
// A non-member who owns the Agent in a direct message also keeps the Join
// prompt, so the bar and its Join dialog render before the members read.
export const spaceViewerMembershipDisplaySchema = z.strictObject({
	version: z.literal(1),
	membership: z.enum(["member", "nonmember"]),
	directMessageJoin: z
		.strictObject({
			defaultName: z.string(),
			prompt: z.string(),
			selectedNames: z.array(z.string()),
		})
		.optional(),
});
export type SpaceViewerMembershipDisplay = z.infer<
	typeof spaceViewerMembershipDisplaySchema
>;

export function spaceViewerMembershipDisplayQueryKey(
	spaceId: string,
	openMeldProfileId: string
) {
	return [
		"spaces",
		"viewer-membership-display",
		spaceId,
		openMeldProfileId,
	] as const;
}

export function spaceViewerMembershipDisplayQueryOptions(
	spaceId: string,
	openMeldProfileId: string
) {
	return queryOptions<SpaceViewerMembershipDisplay>({
		queryKey: spaceViewerMembershipDisplayQueryKey(spaceId, openMeldProfileId),
		queryFn: skipToken,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
	});
}

// Layout only. The Spaces each of the account's profiles belonged to when the
// account Spaces list last loaded, so a hard refresh can paint the composer of
// a conversation never opened in this browser. The server still decides every
// send and join.
export const accountMemberSpacesDisplaySchema = z.strictObject({
	version: z.literal(1),
	spaces: z.array(
		z.strictObject({
			spaceId: z.string(),
			profileIds: z.array(z.string()),
		})
	),
});
export type AccountMemberSpacesDisplay = z.infer<
	typeof accountMemberSpacesDisplaySchema
>;

export function accountMemberSpacesDisplayQueryKey(
	ownerAccountId: string,
	organizationId: string
) {
	return [
		"spaces",
		"account-member-spaces-display",
		ownerAccountId,
		organizationId,
	] as const;
}
