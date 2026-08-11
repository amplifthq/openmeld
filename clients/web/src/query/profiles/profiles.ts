import type { StructuredApiClientFailure } from "@openmeld/api-client";
import type { AuthProfileView } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { listStartProfiles } from "#/lib/profiles/existing-profiles";
import {
	baseQueryOptions,
	PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
} from "#/query/query-config";
import { startQueryKeys } from "#/query/query-keys";

export function buildStartProfilesQueryOptions(input: {
	enabled: boolean;
	storageScope: string;
}) {
	return queryOptions<readonly AuthProfileView[], StructuredApiClientFailure>({
		queryKey: startQueryKeys.profilesForStorageScope(input.storageScope),
		queryFn: async () => await listStartProfiles(),
		enabled: input.enabled,
		gcTime: PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
		retry: baseQueryOptions.retry,
		staleTime: baseQueryOptions.staleTime,
		refetchOnMount: true,
		refetchOnWindowFocus: false,
	});
}

export function startProfilesQueryOptions(input: {
	enabled: boolean;
	storageScope: string;
}) {
	return buildStartProfilesQueryOptions({
		enabled: input.enabled,
		storageScope: input.storageScope,
	});
}
