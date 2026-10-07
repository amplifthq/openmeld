import { createCenterAgentApi } from "@openmeld/api-client";
import type { ListCenterAgentSessionsResponse } from "@openmeld/schemas";
import { infiniteQueryOptions } from "@tanstack/react-query";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { DISPLAY_REVISIT_GC_TIME_MS } from "#/query/query-config";

export function centerAgentSessionsQueryOptions(
	organizationId: string,
	profileId: string
) {
	return infiniteQueryOptions({
		queryKey: [
			"center-agent",
			organizationId,
			profileId,
			"sessions",
			"sidebar",
		],
		enabled: !!profileId,
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (page: ListCenterAgentSessionsResponse) =>
			page.nextCursor ?? undefined,
		queryFn: ({ signal, pageParam }) =>
			createCenterAgentApi(
				createOrganizationScopedWebOpenMeldApiFoundation({ organizationId })
			).listSessions({ limit: 100, cursor: pageParam, signal }),
		staleTime: 30_000,
		gcTime: DISPLAY_REVISIT_GC_TIME_MS,
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
	});
}
