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
	delegationCursor?: string;
}): Promise<GetSpaceMessageDetailsResponse> {
	try {
		return await createUnscopedWebSpaceApi({
			...(input.openMeldProfileId === undefined
				? {}
				: { openMeldProfileId: input.openMeldProfileId }),
		}).getMessageDetails({
			spaceId: input.spaceId,
			signalId: input.signalId,
			executionContextVersion: 1,
			delegationVersion: 1,
			delegationCursor: input.delegationCursor,
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
	delegationCursor?: string;
	enabled: boolean;
}) {
	return queryOptions<
		GetSpaceMessageDetailsResponse,
		StructuredApiClientFailure
	>({
		queryKey: [
			...spaceQueryKeys.messageDetails(
				input.spaceId,
				input.signalId,
				input.openMeldProfileId
			),
			...(input.delegationCursor ? [input.delegationCursor] : []),
		],
		queryFn: async () =>
			await readSpaceMessageDetails({
				spaceId: input.spaceId,
				signalId: input.signalId,
				delegationCursor: input.delegationCursor,
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
		refetchOnWindowFocus: true,
		refetchOnReconnect: "always",
		refetchInterval: (query) => {
			const data = query.state.data;
			return data?.wakeContext.targets.some(
				(target) => target.status === "pending" || target.status === "running"
			) ||
				data?.delegations?.groups.some((group) =>
					group.children.some(
						(child) =>
							child.availability === "readable" &&
							!child.outcome &&
							(child.progress
								? !child.progress.terminal
								: child.coordinationState === "planned" ||
									child.coordinationState === "active")
					)
				)
				? 5000
				: false;
		},
	});
}
