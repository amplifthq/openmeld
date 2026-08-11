import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import { parseEnvelope } from "@openmeld/protocol";
import type { SpaceBootstrapResponse } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { createWebSpaceApi } from "#/lib/spaces/api";
import { ROUTE_REVISIT_GC_TIME_MS } from "#/query/query-config";
import {
	SPACE_HISTORY_SIGNAL_KINDS,
	SPACE_INITIAL_HISTORY_MAX_MESSAGES,
	type SpaceHistorySnapshot,
} from "./history";
import { shouldRetrySpaceQuery } from "./retry";
import { SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS, spaceQueryKeys } from "./status";

// Keep bootstrap snapshots alive well past the default 5min gcTime so
// returning to a recently viewed Space paints from cache instead of a
// blocking skeleton. Staleness is bounded by
// SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS plus the live invalidation path.
export const SPACE_BOOTSTRAP_GC_TIME_MS = ROUTE_REVISIT_GC_TIME_MS;

export type SpaceBootstrapSnapshot = Omit<SpaceBootstrapResponse, "history"> & {
	history: SpaceHistorySnapshot;
};

export async function readSpaceBootstrap(input: {
	spaceId: string;
	openMeldProfileId?: string;
	signal?: AbortSignal;
}): Promise<SpaceBootstrapSnapshot> {
	try {
		const response = await createWebSpaceApi({
			...(input.openMeldProfileId === undefined
				? {}
				: { openMeldProfileId: input.openMeldProfileId }),
		}).getBootstrap({
			spaceId: input.spaceId,
			includeAgentStreamPresence: true,
			historyQuery: {
				recent: true,
				limit: SPACE_INITIAL_HISTORY_MAX_MESSAGES,
				kinds: SPACE_HISTORY_SIGNAL_KINDS,
			},
			...(input.signal === undefined ? {} : { signal: input.signal }),
		});
		return {
			...response,
			history: {
				envelopes: response.history.signals.flatMap((item) => {
					const envelope = parseEnvelope(item);
					return envelope ? [envelope] : [];
				}),
				nextCursor: response.history.nextCursor,
			},
		};
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function spaceBootstrapQueryOptions(input: {
	spaceId: string;
	openMeldProfileId?: string;
	enabled: boolean;
}) {
	return queryOptions<SpaceBootstrapSnapshot, StructuredApiClientFailure>({
		queryKey: spaceQueryKeys.bootstrap(input.spaceId, input.openMeldProfileId),
		queryFn: async ({ signal }) =>
			await readSpaceBootstrap({
				spaceId: input.spaceId,
				...(input.openMeldProfileId === undefined
					? {}
					: { openMeldProfileId: input.openMeldProfileId }),
				signal,
			}),
		enabled: input.enabled,
		gcTime: SPACE_BOOTSTRAP_GC_TIME_MS,
		retry: shouldRetrySpaceQuery,
		staleTime: SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS,
		refetchOnMount: true,
		refetchOnWindowFocus: false,
	});
}
