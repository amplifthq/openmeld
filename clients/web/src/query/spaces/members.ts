import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { createWebSpaceApi } from "#/lib/spaces/api";
import { ROUTE_REVISIT_GC_TIME_MS } from "#/query/query-config";
import { shouldRetrySpaceQuery } from "./retry";
import { SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS, spaceQueryKeys } from "./status";

export async function readSpaceMembers(input: {
	spaceId: string;
	openMeldProfileId?: string;
	spacePassword?: string;
	signal?: AbortSignal;
}): Promise<SpaceMembersSnapshot> {
	try {
		return await createWebSpaceApi({
			...(input.openMeldProfileId === undefined
				? {}
				: { openMeldProfileId: input.openMeldProfileId }),
		}).getMembersSnapshot({
			spaceId: input.spaceId,
			...(input.spacePassword === undefined
				? {}
				: { spacePassword: input.spacePassword }),
			...(input.signal === undefined ? {} : { signal: input.signal }),
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function spaceMembersQueryOptions(input: {
	spaceId: string;
	openMeldProfileId?: string;
	enabled: boolean;
}) {
	return queryOptions<SpaceMembersSnapshot, StructuredApiClientFailure>({
		queryKey: spaceQueryKeys.members(input.spaceId, input.openMeldProfileId),
		queryFn: async ({ signal }) =>
			await readSpaceMembers({
				spaceId: input.spaceId,
				...(input.openMeldProfileId === undefined
					? {}
					: { openMeldProfileId: input.openMeldProfileId }),
				signal,
			}),
		enabled: input.enabled,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		retry: shouldRetrySpaceQuery,
		staleTime: SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS,
		refetchOnMount: true,
		refetchOnWindowFocus: false,
	});
}
