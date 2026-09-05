import type { WakeProgressItem } from "@openmeld/schemas/types";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import type { SpaceTimelineItem } from "./timeline";

export function buildCenterAgentOptimisticReplyItem(input: {
	activityItems: readonly WakeProgressItem[];
	isCenterAgentDirectMessage: boolean;
	profileEntriesById: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
	selfProfileId: string;
	timelineItems: readonly SpaceTimelineItem[];
}): SpaceTimelineItem | null {
	if (!input.isCenterAgentDirectMessage) {
		return null;
	}
	const activeAgents = [...input.profileEntriesById.values()].filter(
		(entry) => entry.profileKind === "agent"
	);
	if (activeAgents.length !== 1) {
		return null;
	}
	const [centerAgent] = activeAgents;
	if (!centerAgent) {
		return null;
	}

	const candidates = input.activityItems
		.filter(
			(item) => !item.terminal && item.targetProfileId === centerAgent.profileId
		)
		.toSorted((left, right) => right.updatedAtMs - left.updatedAtMs);

	for (const candidate of candidates) {
		if (candidate.terminal) {
			continue;
		}
		const sourceItem = findWakeSourceItem({
			candidate,
			selfProfileId: input.selfProfileId,
			timelineItems: input.timelineItems,
		});
		if (!sourceItem) {
			continue;
		}
		if (
			hasAuthoritativeAgentOutcome({
				candidate,
				sourceItem,
				timelineItems: input.timelineItems,
			})
		) {
			continue;
		}

		return createOptimisticReplyItem({
			agent: centerAgent,
			candidate,
			sourceItem,
		});
	}

	return null;
}

function findWakeSourceItem(input: {
	candidate: WakeProgressItem;
	selfProfileId: string;
	timelineItems: readonly SpaceTimelineItem[];
}): SpaceTimelineItem | null {
	const candidateClientMessageId = input.candidate.clientMessageId;
	const candidateSourceSignalId = input.candidate.sourceSignalId;
	for (let index = input.timelineItems.length - 1; index >= 0; index -= 1) {
		const item = input.timelineItems[index];
		if (
			!item ||
			item.actorProfileId !== input.selfProfileId ||
			item.actorProfileKind !== "human" ||
			item.signalType !== "signal.text"
		) {
			continue;
		}
		if (
			candidateClientMessageId &&
			(item.clientMessageId === candidateClientMessageId ||
				item.wakeClientMessageId === candidateClientMessageId)
		) {
			return item;
		}
		if (
			candidateSourceSignalId &&
			(item.id === candidateSourceSignalId ||
				item.wakeSourceSignalId === candidateSourceSignalId)
		) {
			return item;
		}
	}

	return null;
}

function hasAuthoritativeAgentOutcome(input: {
	candidate: WakeProgressItem;
	sourceItem: SpaceTimelineItem;
	timelineItems: readonly SpaceTimelineItem[];
}): boolean {
	const sourceSignalIds = new Set(
		[
			input.sourceItem.id,
			input.sourceItem.wakeSourceSignalId,
			input.candidate.sourceSignalId,
		].filter((value): value is string => Boolean(value))
	);

	return input.timelineItems.some((item) => {
		if (!(item.replyToSignalId && sourceSignalIds.has(item.replyToSignalId))) {
			return false;
		}
		return (
			item.actorProfileId === input.candidate.targetProfileId ||
			item.systemNoticeTargetProfileId === input.candidate.targetProfileId
		);
	});
}

function createOptimisticReplyItem(input: {
	agent: SpaceMemberDirectoryEntry;
	candidate: WakeProgressItem;
	sourceItem: SpaceTimelineItem;
}): SpaceTimelineItem {
	const replyIdentity =
		input.candidate.clientMessageId ??
		input.candidate.sourceSignalId ??
		input.sourceItem.id;

	return {
		actorAgentControllerRef: input.agent.agentControllerRef,
		actorAvatarImageUrl: input.agent.avatarUrl,
		actorControllerDisplay: input.agent.controllerDisplayName,
		actorName: input.agent.profileName,
		actorOwnerDisplay: input.agent.ownerDisplay,
		actorOwnerName: input.agent.ownerName,
		actorOwnerUserId: input.agent.ownerUserId,
		actorProfileId: input.agent.profileId,
		actorProfileKind: "agent",
		actorProfileName: input.agent.profileName,
		actorRuntimeDeviceDisplayName: input.agent.runtimeDeviceDisplayName,
		agentControllerConversationId: input.agent.agentControllerConversationId,
		agentWorkspace: input.agent.workingDirectory,
		attachments: [],
		clientMessageId: null,
		createdAtMs: input.sourceItem.createdAtMs + 1,
		deliveryState: "pending",
		id: `optimistic:center-agent:${replyIdentity}:${input.agent.profileId}`,
		isAgentFinalReply: true,
		newMessagesDuringComposition: null,
		optimisticAgentReplySourceItemId: input.sourceItem.id,
		optimisticAgentReplyProgress: input.candidate,
		replyPreviewText: null,
		replyToProfileName: null,
		replyToSignalId: null,
		signalType: "signal.text",
		spaceId: input.sourceItem.spaceId,
		systemNoticeType: null,
		text: "",
		transientActivityPurpose: null,
		wakeClientMessageId: null,
		wakeSourceSignalId: null,
		wakeTargetProfileIds: [],
	};
}
