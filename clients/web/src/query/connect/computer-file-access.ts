import type { StructuredApiClientFailure } from "@openmeld/api-client";
import type {
	ComputerFileAccessPolicyResponse,
	DaemonServiceLane,
} from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { readComputerFileAccessPolicy } from "#/lib/connect/computer-file-access";
import { baseQueryOptions } from "#/query/query-config";

export const computerFileAccessQueryKeys = {
	policy: (
		storageScope: string,
		deviceId: string,
		runtimeLane: DaemonServiceLane
	) =>
		[
			"people-computers",
			"file-access",
			storageScope,
			deviceId,
			runtimeLane,
		] as const,
};

export function computerFileAccessPolicyQueryOptions(input: {
	deviceId: string;
	runtimeLane: DaemonServiceLane;
	storageScope: string;
}) {
	return queryOptions<
		ComputerFileAccessPolicyResponse,
		StructuredApiClientFailure
	>({
		queryKey: computerFileAccessQueryKeys.policy(
			input.storageScope,
			input.deviceId,
			input.runtimeLane
		),
		queryFn: () =>
			readComputerFileAccessPolicy({
				deviceId: input.deviceId,
				runtimeLane: input.runtimeLane,
			}),
		gcTime: baseQueryOptions.gcTime,
		refetchOnMount: true,
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: baseQueryOptions.staleTime,
	});
}
