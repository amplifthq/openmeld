import { readOrUpdateSpaceInputQueue } from "@openmeld/api-client";
import type {
	SpaceInputQueueMutation,
	SpaceInputQueueResponse,
} from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { stageQueuedMessageInTimeline } from "./space-pending-outgoing-signals";

type QueueItem = SpaceInputQueueResponse["items"][number];

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
			readOrUpdateSpaceInputQueue(client(), {
				spaceId: input.spaceId,
				signal,
				includeRecovery: true,
				includeConversationContext: true,
			}),
		staleTime: 0,
		refetchInterval: 30_000,
	});
	// Messages sent with "Send now" leave the queue at once; the timeline shows
	// them until Core confirms or the send fails and they come back.
	const [sendingIds, setSendingIds] = useState<ReadonlySet<string>>(
		() => new Set()
	);
	async function mutate(mutation: SpaceInputQueueMutation) {
		await queryClient.cancelQueries({ queryKey });
		try {
			const data = await readOrUpdateSpaceInputQueue(client(), {
				spaceId: input.spaceId,
				includeRecovery: true,
				includeConversationContext: true,
				mutation,
			});
			queryClient.setQueryData(queryKey, data);
			return data;
		} finally {
			await queryClient.invalidateQueries({ queryKey });
		}
	}
	function setSending(inputId: string, sending: boolean) {
		setSendingIds((current) => {
			const next = new Set(current);
			if (sending) {
				next.add(inputId);
			} else {
				next.delete(inputId);
			}
			return next;
		});
	}
	async function sendNow(item: QueueItem) {
		setSending(item.inputId, true);
		const removeFromTimeline = stageQueuedMessageInTimeline({
			queryClient,
			spaceId: input.spaceId,
			profileId: input.profileId,
			threadId: item.threadId ?? null,
			inputId: item.inputId,
			text: item.text,
		});
		try {
			const data = await mutate({
				action: "steer",
				inputId: item.inputId,
				target: item.target,
			});
			const remaining = data.items.find(
				(candidate) => candidate.inputId === item.inputId
			);
			// Still listed: the agent did not take it (yet), and the queue row
			// says why. Only a consumed input becomes a timeline message.
			if (remaining) {
				removeFromTimeline();
			}
			if (remaining?.state === "queued") {
				throw new Error("Couldn't send this message now. It's still queued.");
			}
		} catch (cause) {
			removeFromTimeline();
			throw cause;
		} finally {
			setSending(item.inputId, false);
		}
	}
	return {
		items: (query.data?.items ?? []).filter(
			(item) => !sendingIds.has(item.inputId)
		),
		sendNow,
		supportsConversationContext:
			query.data?.conversationContextIncluded === true,
		recoveries: query.data?.recoveries ?? [],
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
				JSON.stringify(pending.target) === JSON.stringify(mutation.target)
					? pending
					: mutation;
			pendingEnqueue.current = request;
			pendingScope.current = scope;
			await mutate(request);
			pendingEnqueue.current = null;
		},
	};
}
