import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type { GetSpaceEntryResolutionResponse } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { ROUTE_REVISIT_GC_TIME_MS } from "#/query/query-config";
import { shouldRetrySpaceQuery } from "./retry";
import { SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS } from "./status";

export const spaceEntryResolutionQueryKey = (input: {
	openMeldProfileId?: string | null;
	signalId?: string | null;
	spaceId: string;
	threadRootSignalId?: string | null;
}) =>
	[
		"spaces",
		"entry-resolution",
		input.spaceId,
		input.openMeldProfileId ?? null,
		input.signalId ?? null,
		input.threadRootSignalId ?? null,
	] as const;

export async function readSpaceEntryResolution(input: {
	openMeldProfileId?: string;
	signal?: AbortSignal;
	signalId?: string;
	spaceId: string;
	threadRootSignalId?: string;
}): Promise<GetSpaceEntryResolutionResponse> {
	try {
		return await createUnscopedWebSpaceApi({
			...(input.openMeldProfileId === undefined
				? {}
				: { openMeldProfileId: input.openMeldProfileId }),
		}).resolveEntry({
			spaceId: input.spaceId,
			...(input.signalId === undefined ? {} : { signalId: input.signalId }),
			...(input.threadRootSignalId === undefined
				? {}
				: { threadRootSignalId: input.threadRootSignalId }),
			...(input.signal === undefined ? {} : { signal: input.signal }),
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function spaceEntryResolutionQueryOptions(input: {
	enabled: boolean;
	openMeldProfileId?: string;
	signalId?: string;
	spaceId: string;
	threadRootSignalId?: string;
}) {
	return queryOptions<
		GetSpaceEntryResolutionResponse,
		StructuredApiClientFailure
	>({
		queryKey: spaceEntryResolutionQueryKey(input),
		queryFn: async ({ signal }) =>
			await readSpaceEntryResolution({
				spaceId: input.spaceId,
				...(input.openMeldProfileId === undefined
					? {}
					: { openMeldProfileId: input.openMeldProfileId }),
				...(input.signalId === undefined ? {} : { signalId: input.signalId }),
				...(input.threadRootSignalId === undefined
					? {}
					: { threadRootSignalId: input.threadRootSignalId }),
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
