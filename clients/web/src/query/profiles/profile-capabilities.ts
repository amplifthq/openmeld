import type { StructuredApiClientFailure } from "@openmeld/api-client";
import type { ProfileCapabilitiesResponse } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { getProfileCapabilities } from "#/lib/profiles/profile-capabilities";
import {
	baseQueryOptions,
	ROUTE_REVISIT_GC_TIME_MS,
} from "#/query/query-config";
import { startQueryKeys } from "#/query/query-keys";

type ProfileCapabilitiesQueryState = {
	data: ProfileCapabilitiesResponse | undefined;
	isError: boolean;
	isFetching: boolean;
};

export function isAdditionalHumanProfileCreationEnabled(
	query: ProfileCapabilitiesQueryState
): boolean {
	return (
		!(query.isFetching || query.isError) &&
		query.data?.additionalHumanProfileCreationEnabled === true
	);
}

export function profileCapabilitiesQueryOptions() {
	return queryOptions<ProfileCapabilitiesResponse, StructuredApiClientFailure>({
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async () => await getProfileCapabilities(),
		queryKey: startQueryKeys.profileCapabilities,
		refetchOnMount: true,
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: baseQueryOptions.staleTime,
	});
}
