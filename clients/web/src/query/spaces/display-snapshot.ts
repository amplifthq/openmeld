import { getSpaceStatusResponseSchema } from "@openmeld/schemas";
import type { GetSpaceStatusResponse } from "@openmeld/schemas/types";
import { queryOptions, skipToken } from "@tanstack/react-query";
import { z } from "zod/v4";
import { PERSISTED_DISPLAY_QUERY_GC_TIME_MS } from "#/query/query-config";
import { spaceQueryKeys } from "./status";

const spaceConversationDisplayStatusSchema = getSpaceStatusResponseSchema
	.omit({
		allowedActions: true,
		latestVisibleUpdate: true,
	})
	.strict();

export const spaceConversationDisplaySnapshotSchema = z.strictObject({
	status: spaceConversationDisplayStatusSchema,
	version: z.literal(1),
});

export type SpaceConversationDisplaySnapshot = z.infer<
	typeof spaceConversationDisplaySnapshotSchema
>;

export function createSpaceConversationDisplaySnapshot(
	status: GetSpaceStatusResponse
): SpaceConversationDisplaySnapshot {
	const {
		allowedActions: _allowedActions,
		latestVisibleUpdate: _latest,
		...safe
	} = status;
	return spaceConversationDisplaySnapshotSchema.parse({
		status: safe,
		version: 1,
	});
}

export function readOnlySpaceStatusFromDisplaySnapshot(
	snapshot: SpaceConversationDisplaySnapshot
): GetSpaceStatusResponse {
	return getSpaceStatusResponseSchema.parse({
		...snapshot.status,
		allowedActions: ["stay_silent"],
	});
}

export function spaceConversationDisplaySnapshotQueryOptions(input: {
	spaceId: string;
	openMeldProfileId: string;
}) {
	return queryOptions<SpaceConversationDisplaySnapshot>({
		gcTime: PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
		queryFn: skipToken,
		queryKey: spaceQueryKeys.displaySnapshot(
			input.spaceId,
			input.openMeldProfileId
		),
		staleTime: Number.POSITIVE_INFINITY,
	});
}
