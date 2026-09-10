import { queryOptions, skipToken } from "@tanstack/react-query";
import { z } from "zod/v4";
import { PERSISTED_DISPLAY_QUERY_GC_TIME_MS } from "#/query/query-config";
import { spaceQueryKeys } from "./status";

// Identity only. Cached directory entries never carry Wake or membership authority.
export const spaceMemberDirectoryDisplaySchema = z.strictObject({
	version: z.literal(1),
	members: z.array(
		z.strictObject({
			profileId: z.string(),
			profileName: z.string(),
			profileKind: z.enum(["human", "agent"]),
			primaryMentionLabel: z.string(),
			avatarUrl: z.string().nullable(),
			agentControllerRef: z.string().nullable(),
		})
	),
});
export type SpaceMemberDirectoryDisplay = z.infer<
	typeof spaceMemberDirectoryDisplaySchema
>;
export function spaceMemberDirectoryDisplayQueryOptions(
	spaceId: string,
	profileId: string
) {
	return queryOptions<SpaceMemberDirectoryDisplay>({
		queryKey: spaceQueryKeys.memberDirectoryDisplay(spaceId, profileId),
		queryFn: skipToken,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
	});
}
