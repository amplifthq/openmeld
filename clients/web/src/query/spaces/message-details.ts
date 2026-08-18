import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type { GetSpaceMessageDetailsResponse } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { baseQueryOptions } from "#/query/query-config";
import { shouldRetrySpaceQuery } from "./retry";
import { spaceQueryKeys } from "./status";

export async function readSpaceMessageDetails(input: {
	spaceId: string;
	signalId: string;
	openMeldProfileId?: string;
	spacePassword?: string;
}): Promise<GetSpaceMessageDetailsResponse> {
	try {
		return await createUnscopedWebSpaceApi({
			...(input.openMeldProfileId === undefined
				? {}
				: { openMeldProfileId: input.openMeldProfileId }),
		}).getMessageDetails({
			spaceId: input.spaceId,
			signalId: input.signalId,
			...(input.spacePassword === undefined
				? {}
				: { spacePassword: input.spacePassword }),
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function spaceMessageDetailsQueryOptions(input: {
	spaceId: string;
	signalId: string;
	openMeldProfileId?: string;
	spacePassword?: string;
	enabled: boolean;
}) {
	return queryOptions<
		GetSpaceMessageDetailsResponse,
		StructuredApiClientFailure
	>({
		queryKey: spaceQueryKeys.messageDetails(
			input.spaceId,
			input.signalId,
			input.openMeldProfileId
		),
		queryFn: async () =>
			await readSpaceMessageDetails({
				spaceId: input.spaceId,
				signalId: input.signalId,
				...(input.openMeldProfileId === undefined
					? {}
					: { openMeldProfileId: input.openMeldProfileId }),
				...(input.spacePassword === undefined
					? {}
					: { spacePassword: input.spacePassword }),
			}),
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		retry: shouldRetrySpaceQuery,
		staleTime: 0,
		refetchOnMount: "always",
		refetchOnWindowFocus: false,
	});
}
