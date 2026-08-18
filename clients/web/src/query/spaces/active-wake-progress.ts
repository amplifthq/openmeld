import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	GetActiveSpaceWakeProgressResponse,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { SPACE_WAKE_PROGRESS_TIMEOUT_MS } from "#/lib/spaces/request-timeouts";
import { ROUTE_REVISIT_GC_TIME_MS } from "#/query/query-config";
import { spaceQueryKeys } from "./status";

export function spaceActiveWakeProgressSummaryQueryOptions(input: {
	enabled: boolean;
	spaceId: string;
	openMeldProfileId: string;
}) {
	return queryOptions<
		GetActiveSpaceWakeProgressResponse,
		StructuredApiClientFailure
	>({
		queryKey: spaceQueryKeys.activeWakeProgressSummary(
			input.spaceId,
			input.openMeldProfileId
		),
		queryFn: async () => {
			try {
				return await createUnscopedWebSpaceApi({
					openMeldProfileId: input.openMeldProfileId,
				}).getActiveWakeProgress({
					includeTiming: true,
					includeWakeStopEligibility: false,
					spaceId: input.spaceId,
					timeoutMs: SPACE_WAKE_PROGRESS_TIMEOUT_MS,
				});
			} catch (error) {
				throw toStructuredApiClientFailure(error);
			}
		},
		enabled: input.enabled,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		retry: false,
		staleTime: 0,
		refetchOnMount: "always",
		refetchOnWindowFocus: false,
	});
}

export function spaceWakeProgressPresentationQueryOptions(input: {
	spaceId: string;
	openMeldProfileId: string;
}) {
	return queryOptions<WakeProgressItem[]>({
		queryKey: spaceQueryKeys.wakeProgressPresentation(
			input.spaceId,
			input.openMeldProfileId
		),
		queryFn: () => [],
		enabled: false,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		initialData: [],
		staleTime: Number.POSITIVE_INFINITY,
	});
}

type WakeProgressPresentationItemsUpdate =
	| WakeProgressItem[]
	| ((currentItems: WakeProgressItem[]) => WakeProgressItem[]);

export function setSpaceWakeProgressPresentationItems(input: {
	items: WakeProgressPresentationItemsUpdate;
	queryClient: QueryClient;
	spaceId: string;
	openMeldProfileId: string;
}): void {
	input.queryClient.setQueryData<WakeProgressItem[]>(
		spaceQueryKeys.wakeProgressPresentation(
			input.spaceId,
			input.openMeldProfileId
		),
		(currentItems) =>
			typeof input.items === "function"
				? input.items(currentItems ?? [])
				: input.items
	);
}
