import { readOrUpdateSpaceInputQueue } from "@openmeld/api-client";
import type { SpaceInputQueueMutation } from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export function useSpaceInputQueue(input: {
	spaceId: string;
	profileId: string;
	enabled: boolean;
}) {
	const client = () =>
		createUnscopedWebOpenMeldApiFoundation({
			openMeldProfileId: input.profileId,
		});
	const queryClient = useQueryClient();
	const queryKey = ["space-input-queue", input.spaceId, input.profileId];
	const pendingEnqueue = useRef<Extract<
		SpaceInputQueueMutation,
		{ action: "enqueue" }
	> | null>(null);
	const pendingScope = useRef("");
	const query = useQuery({
		queryKey,
		enabled: input.enabled,
		queryFn: ({ signal }) =>
			readOrUpdateSpaceInputQueue(client(), { spaceId: input.spaceId, signal }),
		staleTime: 0,
	});
	async function mutate(mutation: SpaceInputQueueMutation) {
		await queryClient.cancelQueries({ queryKey });
		try {
			const data = await readOrUpdateSpaceInputQueue(client(), {
				spaceId: input.spaceId,
				mutation,
			});
			queryClient.setQueryData(queryKey, data);
		} finally {
			await queryClient.invalidateQueries({ queryKey });
		}
	}
	return {
		items: query.data?.items ?? [],
		error: query.error,
		mutate,
		async enqueue(
			mutation: Extract<SpaceInputQueueMutation, { action: "enqueue" }>
		) {
			const scope = `${input.spaceId}:${input.profileId}`;
			const pending =
				pendingScope.current === scope ? pendingEnqueue.current : null;
			const request =
				pending?.text === mutation.text &&
				pending.target.dispatchId === mutation.target.dispatchId &&
				pending.target.targetProfileId === mutation.target.targetProfileId
					? pending
					: mutation;
			pendingEnqueue.current = request;
			pendingScope.current = scope;
			await mutate(request);
			pendingEnqueue.current = null;
		},
	};
}
