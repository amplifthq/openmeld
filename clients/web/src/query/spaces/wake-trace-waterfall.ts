import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type { GetSpaceWakeTraceWaterfallResponse } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { baseQueryOptions } from "#/query/query-config";
import { shouldRetrySpaceQuery } from "./retry";
import { spaceQueryKeys } from "./status";

export async function readSpaceWakeTraceWaterfall(input: {
	spaceId: string;
	clientMessageId?: string | null;
	sourceSignalId?: string | null;
	targetProfileId?: string;
	openMeldProfileId?: string;
	spacePassword?: string;
}): Promise<GetSpaceWakeTraceWaterfallResponse> {
	const selector = resolveWakeTraceWaterfallSelector(input);
	try {
		return await createUnscopedWebSpaceApi({
			...(input.openMeldProfileId === undefined
				? {}
				: { openMeldProfileId: input.openMeldProfileId }),
		}).getWakeTraceWaterfall({
			spaceId: input.spaceId,
			...(selector.kind === "client_message"
				? { clientMessageId: selector.id }
				: { sourceSignalId: selector.id }),
			...(input.targetProfileId === undefined
				? {}
				: { targetProfileId: input.targetProfileId }),
			...(input.spacePassword === undefined
				? {}
				: { spacePassword: input.spacePassword }),
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function spaceWakeTraceWaterfallQueryOptions(input: {
	spaceId: string;
	clientMessageId?: string | null;
	sourceSignalId?: string | null;
	targetProfileId?: string;
	openMeldProfileId?: string;
	spacePassword?: string;
	enabled: boolean;
}) {
	const selector = resolveOptionalWakeTraceWaterfallSelector(input);
	return queryOptions<
		GetSpaceWakeTraceWaterfallResponse,
		StructuredApiClientFailure
	>({
		queryKey: spaceQueryKeys.wakeTraceWaterfall(
			input.spaceId,
			selector?.kind ?? null,
			selector?.id ?? null,
			input.targetProfileId,
			input.openMeldProfileId
		),
		queryFn: async () =>
			await readSpaceWakeTraceWaterfall({
				spaceId: input.spaceId,
				...(input.clientMessageId === undefined
					? {}
					: { clientMessageId: input.clientMessageId }),
				...(input.sourceSignalId === undefined
					? {}
					: { sourceSignalId: input.sourceSignalId }),
				...(input.targetProfileId === undefined
					? {}
					: { targetProfileId: input.targetProfileId }),
				...(input.openMeldProfileId === undefined
					? {}
					: { openMeldProfileId: input.openMeldProfileId }),
				...(input.spacePassword === undefined
					? {}
					: { spacePassword: input.spacePassword }),
			}),
		enabled: input.enabled && selector !== null,
		gcTime: baseQueryOptions.gcTime,
		retry: shouldRetrySpaceQuery,
		staleTime: 0,
		refetchOnMount: "always",
		refetchOnWindowFocus: false,
	});
}

function resolveWakeTraceWaterfallSelector(input: {
	clientMessageId?: string | null;
	sourceSignalId?: string | null;
}): { id: string; kind: "client_message" | "source_signal" } {
	const selector = resolveOptionalWakeTraceWaterfallSelector(input);
	if (selector) {
		return selector;
	}
	throw new Error("Wake trace waterfall selector is required");
}

function resolveOptionalWakeTraceWaterfallSelector(input: {
	clientMessageId?: string | null;
	sourceSignalId?: string | null;
}): { id: string; kind: "client_message" | "source_signal" } | null {
	if (input.clientMessageId) {
		return { id: input.clientMessageId, kind: "client_message" };
	}
	if (input.sourceSignalId) {
		return { id: input.sourceSignalId, kind: "source_signal" };
	}
	return null;
}
