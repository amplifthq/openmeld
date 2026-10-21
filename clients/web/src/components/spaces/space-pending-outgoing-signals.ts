import type {
	SignalEnvelope,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import type { QueryClient } from "@tanstack/react-query";
import { spaceQueryKeys } from "#/query/spaces/status";
import { normalizeOptionalText } from "./use-space-landing-controller-helpers";

type TextSignalEnvelope = Extract<SignalEnvelope, { type: "signal.text" }>;

/** A sent message shown in the timeline until its persisted signal arrives. */
export type PendingOutgoingSignal = {
	filePreviewUrlsById: ReadonlyMap<string, string>;
	clientMessageId: string;
	signal: TextSignalEnvelope;
};

export function pendingOutgoingSignalsQueryKey(
	spaceId: string,
	profileId: string,
	threadId: string | null
) {
	return ["spaces", "pending-outgoing", spaceId, profileId, threadId] as const;
}

export function resolvePendingOutgoingProfile(input: {
	membersSnapshot: SpaceMembersSnapshot | null;
	profileId: string;
}): TextSignalEnvelope["profile"] {
	const human = input.membersSnapshot?.humans.find(
		(member) => member.profileId === input.profileId
	);
	if (human) {
		return {
			kind: "human",
			profileId: human.profileId,
			profileName: human.profileName,
			...(human.avatarUrl ? { avatarUrl: human.avatarUrl } : {}),
		};
	}

	const agent = input.membersSnapshot?.agents.find(
		(member) => member.profileId === input.profileId
	);
	if (agent) {
		return {
			kind: "agent",
			profileId: agent.profileId,
			profileName: agent.profileName,
			...(agent.ownerUserId ? { owner: agent.ownerUserId } : {}),
			...(agent.ownerName ? { ownerName: agent.ownerName } : {}),
			...(agent.agentControllerRef
				? { agentControllerRef: agent.agentControllerRef }
				: {}),
			...(agent.agentControllerConversationId
				? {
						agentControllerConversationId: agent.agentControllerConversationId,
					}
				: {}),
			...(agent.workingDirectory
				? { workingDirectory: agent.workingDirectory }
				: {}),
		};
	}

	const normalizedProfileId =
		normalizeOptionalText(input.profileId) ?? input.profileId;
	return {
		kind: normalizedProfileId.startsWith("agt_") ? "agent" : "human",
		profileId: normalizedProfileId,
		profileName: normalizedProfileId,
	};
}

/**
 * Shows a queued message in the timeline while "Send now" is in flight. The
 * persisted signal carries the queue input id as its clientMessageId, so the
 * timeline swaps this entry for the real message when it arrives. Returns a
 * function that removes the entry again.
 */
export function stageQueuedMessageInTimeline(input: {
	queryClient: QueryClient;
	spaceId: string;
	profileId: string;
	threadId: string | null;
	inputId: string;
	text: string;
}): () => void {
	const queryKey = pendingOutgoingSignalsQueryKey(
		input.spaceId,
		input.profileId,
		input.threadId
	);
	const membersSnapshot =
		input.queryClient.getQueryData<SpaceMembersSnapshot>(
			spaceQueryKeys.members(input.spaceId, input.profileId)
		) ?? null;
	const pendingSignal: PendingOutgoingSignal = {
		filePreviewUrlsById: new Map(),
		clientMessageId: input.inputId,
		signal: {
			v: 1,
			id: `pending:${input.inputId}`,
			spaceId: input.spaceId,
			ts: Date.now(),
			profile: resolvePendingOutgoingProfile({
				membersSnapshot,
				profileId: input.profileId,
			}),
			type: "signal.text",
			data: { text: input.text, meta: { clientMessageId: input.inputId } },
		},
	};
	const without = (current: PendingOutgoingSignal[] | undefined) =>
		(current ?? []).filter((item) => item.clientMessageId !== input.inputId);
	input.queryClient.setQueryData<PendingOutgoingSignal[]>(
		queryKey,
		(current) => [...without(current), pendingSignal]
	);
	return () => {
		input.queryClient.setQueryData<PendingOutgoingSignal[]>(queryKey, without);
	};
}
