import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	ListSpaceThreadSignalsResponse,
	ListSpaceThreadsResponse,
} from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { ROUTE_REVISIT_GC_TIME_MS } from "#/query/query-config";
import { shouldRetrySpaceQuery } from "./retry";
import { SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS, spaceQueryKeys } from "./status";

export async function readSpaceThreads(input: {
	spaceId: string;
	openMeldProfileId?: string;
}): Promise<ListSpaceThreadsResponse> {
	try {
		return await createUnscopedWebSpaceApi({
			...(input.openMeldProfileId === undefined
				? {}
				: { openMeldProfileId: input.openMeldProfileId }),
		}).listThreads({
			spaceId: input.spaceId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function readSpaceThreadSignals(input: {
	spaceId: string;
	threadId: string;
	openMeldProfileId?: string;
}): Promise<ListSpaceThreadSignalsResponse> {
	try {
		return await createUnscopedWebSpaceApi({
			...(input.openMeldProfileId === undefined
				? {}
				: { openMeldProfileId: input.openMeldProfileId }),
		}).listThreadSignals({
			includeWakeContinuation: "conversation",
			spaceId: input.spaceId,
			threadId: input.threadId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function spaceThreadsQueryOptions(input: {
	spaceId: string;
	openMeldProfileId?: string;
	enabled: boolean;
}) {
	return queryOptions<ListSpaceThreadsResponse, StructuredApiClientFailure>({
		queryKey: spaceQueryKeys.threads(input.spaceId, input.openMeldProfileId),
		queryFn: async () =>
			await readSpaceThreads({
				spaceId: input.spaceId,
				...(input.openMeldProfileId === undefined
					? {}
					: { openMeldProfileId: input.openMeldProfileId }),
			}),
		enabled: input.enabled,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		retry: shouldRetrySpaceQuery,
		staleTime: SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS,
		refetchOnMount: true,
		refetchOnWindowFocus: false,
	});
}

export function spaceThreadSignalsQueryOptions(input: {
	spaceId: string;
	threadId: string | null;
	openMeldProfileId?: string;
	enabled: boolean;
}) {
	return queryOptions<
		ListSpaceThreadSignalsResponse,
		StructuredApiClientFailure
	>({
		queryKey: spaceQueryKeys.threadSignals(
			input.spaceId,
			input.threadId ?? "none",
			input.openMeldProfileId
		),
		queryFn: async () => {
			if (!input.threadId) {
				throw new Error("Thread signals require a thread id.");
			}
			return await readSpaceThreadSignals({
				spaceId: input.spaceId,
				threadId: input.threadId,
				...(input.openMeldProfileId === undefined
					? {}
					: { openMeldProfileId: input.openMeldProfileId }),
			});
		},
		enabled: input.enabled && input.threadId !== null,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		retry: shouldRetrySpaceQuery,
		staleTime: 0,
		refetchOnMount: "always",
		refetchOnWindowFocus: false,
	});
}
