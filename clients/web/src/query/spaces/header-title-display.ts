import { queryOptions, skipToken } from "@tanstack/react-query";
import { z } from "zod/v4";
import { PERSISTED_DISPLAY_QUERY_GC_TIME_MS } from "#/query/query-config";

// Layout only. The title the conversation header last showed for a
// MemberAgent session, so a hard refresh paints it on the first frame instead
// of a fallback name that is later replaced.
export const spaceHeaderTitleDisplaySchema = z.strictObject({
	version: z.literal(1),
	title: z.string().min(1),
});
export type SpaceHeaderTitleDisplay = z.infer<
	typeof spaceHeaderTitleDisplaySchema
>;

export function spaceHeaderTitleDisplayQueryKey(
	spaceId: string,
	openMeldProfileId: string
) {
	return [
		"spaces",
		"header-title-display",
		spaceId,
		openMeldProfileId,
	] as const;
}

export function spaceHeaderTitleDisplayQueryOptions(
	spaceId: string,
	openMeldProfileId: string
) {
	return queryOptions<SpaceHeaderTitleDisplay>({
		queryKey: spaceHeaderTitleDisplayQueryKey(spaceId, openMeldProfileId),
		queryFn: skipToken,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
	});
}
