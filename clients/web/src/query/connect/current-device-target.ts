import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type { CurrentDeviceTargetResponse } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { resolveCurrentDeviceTarget } from "#/lib/connect/current-device-target";
import { baseQueryOptions } from "#/query/query-config";
import { startQueryKeys } from "#/query/query-keys";

export async function readCurrentDeviceTarget(): Promise<CurrentDeviceTargetResponse> {
	try {
		return await resolveCurrentDeviceTarget();
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function currentDeviceTargetQueryOptions(input: {
	enabled: boolean;
	storageScope: string;
}) {
	return queryOptions<CurrentDeviceTargetResponse, StructuredApiClientFailure>({
		queryKey: startQueryKeys.currentDeviceTarget(input.storageScope),
		queryFn: readCurrentDeviceTarget,
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		retry: baseQueryOptions.retry,
		staleTime: baseQueryOptions.staleTime,
		refetchOnMount: true,
		refetchOnWindowFocus: false,
	});
}
