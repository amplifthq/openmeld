import type { StructuredApiClientFailure } from "@openmeld/api-client";
import type { ComputerFileAccessPolicyResponse } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { readComputerFileAccessPolicy } from "#/lib/connect/computer-file-access";
import { baseQueryOptions } from "#/query/query-config";

export const computerFileAccessQueryKeys = {
	policy: (storageScope: string, deviceId: string) =>
		["computers", "file-access", storageScope, deviceId] as const,
};

export function computerFileAccessPolicyQueryOptions(input: {
	deviceId: string;
	storageScope: string;
}) {
	return queryOptions<
		ComputerFileAccessPolicyResponse,
		StructuredApiClientFailure
	>({
		queryKey: computerFileAccessQueryKeys.policy(
			input.storageScope,
			input.deviceId
		),
		queryFn: () =>
			readComputerFileAccessPolicy({ expectedDeviceId: input.deviceId }),
		gcTime: baseQueryOptions.gcTime,
		refetchOnMount: true,
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: baseQueryOptions.staleTime,
	});
}
