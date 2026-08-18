import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	PostSpaceWakeStopBody,
	PostSpaceWakeStopResponse,
} from "@openmeld/schemas/types";
import type { QueryClient } from "@tanstack/react-query";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { SPACE_WAKE_STOP_TIMEOUT_MS } from "#/lib/spaces/request-timeouts";
import { spaceQueryKeys } from "./status";

export async function postWebSpaceWakeStop(input: {
	openMeldProfileId?: string;
	body: PostSpaceWakeStopBody;
	spaceId: string;
	spacePassword?: string;
}): Promise<PostSpaceWakeStopResponse> {
	try {
		return await createUnscopedWebSpaceApi({
			...(input.openMeldProfileId === undefined
				? {}
				: { openMeldProfileId: input.openMeldProfileId }),
		}).postWakeStop({
			body: input.body,
			spaceId: input.spaceId,
			timeoutMs: SPACE_WAKE_STOP_TIMEOUT_MS,
			...(input.spacePassword === undefined
				? {}
				: { spacePassword: input.spacePassword }),
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function invalidateSpaceWakeStopQueries(input: {
	openMeldProfileId?: string;
	queryClient: Pick<QueryClient, "invalidateQueries">;
	spaceId: string;
	sourceSignalId?: string | null;
	threadId?: string | null;
}): Promise<void> {
	const invalidations = [
		input.queryClient.invalidateQueries({
			queryKey: spaceQueryKeys.history(input.spaceId, input.openMeldProfileId),
		}),
		input.queryClient.invalidateQueries({
			queryKey: spaceQueryKeys.status(input.spaceId, input.openMeldProfileId),
		}),
		input.queryClient.invalidateQueries({
			queryKey: spaceQueryKeys.threads(input.spaceId, input.openMeldProfileId),
		}),
	];

	if (input.sourceSignalId) {
		invalidations.push(
			input.queryClient.invalidateQueries({
				queryKey: spaceQueryKeys.messageDetails(
					input.spaceId,
					input.sourceSignalId,
					input.openMeldProfileId
				),
			})
		);
	}

	if (input.threadId) {
		invalidations.push(
			input.queryClient.invalidateQueries({
				queryKey: spaceQueryKeys.threadSignals(
					input.spaceId,
					input.threadId,
					input.openMeldProfileId
				),
			})
		);
	}

	await Promise.all(invalidations);
}

export function formatWakeStopFailureMessage(
	failure: StructuredApiClientFailure
): string {
	return `OpenMeld couldn't stop this Wake. ${failure.message}`;
}
