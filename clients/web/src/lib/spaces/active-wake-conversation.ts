import type { WakeProgressItem } from "@openmeld/schemas/types";
import {
	isActiveWakeProgressItem,
	type SpaceMemberDirectoryEntry,
} from "@openmeld/space";
import type { SpaceConversationVisibleStreamProjection } from "./conversation-stream";
import type { SpaceTimelineItem } from "./timeline";
import { buildSpaceWakeOutcomeIndex } from "./wake-stop-target";

/** Presentation only: history keeps publication order; unfinished replies follow it. */
export function buildActiveWakeConversationItems(input: {
	activityItems: readonly WakeProgressItem[];
	profileEntriesById: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
	spaceId: string | undefined;
	threadId: string | null;
	threadRootSignalId?: string | null;
	agentStreams?: readonly SpaceConversationVisibleStreamProjection[];
	timelineItems: readonly SpaceTimelineItem[];
}): readonly SpaceTimelineItem[] {
	const history = input.timelineItems.filter(
		(item) => item.agentStreamState?.status !== "streaming"
	);
	const streams = input.timelineItems.filter(
		(item) => item.agentStreamState?.status === "streaming"
	);
	const active: SpaceTimelineItem[] = [];
	const claimedStreams = new Set<string>();
	const sourcesById = new Map(history.map((item) => [item.id, item]));
	const sourcesByClientId = new Map(
		history.flatMap((item) =>
			[item.clientMessageId, item.wakeClientMessageId].flatMap((id) =>
				id ? [[id, item] as const] : []
			)
		)
	);
	const outcomes = buildSpaceWakeOutcomeIndex(history);

	for (const progress of input.activityItems.filter(isActiveWakeProgressItem)) {
		const source =
			sourcesById.get(progress.sourceSignalId ?? "") ??
			sourcesByClientId.get(progress.clientMessageId ?? "");
		if (!isWakeProgressInConversation({ ...input, progress, source })) {
			continue;
		}
		if (
			source &&
			outcomes.hasVisibleOutcomeForSourceTarget({
				sourceItem: source,
				targetProfileId: progress.targetProfileId,
			})
		) {
			continue;
		}
		const sourceId = source?.id ?? progress.sourceSignalId ?? undefined;
		if (hasPublishedReply(history, sourceId, progress.targetProfileId)) {
			continue;
		}
		const stream = streams.find(
			(item) =>
				!claimedStreams.has(item.id) &&
				sourceId &&
				item.replyToSignalId === sourceId &&
				item.actorProfileId === progress.targetProfileId
		);
		if (stream) {
			claimedStreams.add(stream.id);
			active.push({
				...stream,
				activeWakeProgress: progress,
				activeWakeSourceItemId: sourceId,
			});
			continue;
		}
		const placeholder = createActiveWakePlaceholder({
			progress,
			source,
			sourceId,
			agent: input.profileEntriesById.get(progress.targetProfileId),
			spaceId: input.spaceId,
		});
		if (placeholder) {
			active.push(placeholder);
		}
	}
	// A public reply stream is already authoritative presentation evidence, even
	// when its Wake snapshot has not arrived yet. Never manufacture its lifecycle.
	active.push(...streams.filter((item) => !claimedStreams.has(item.id)));
	active.sort(
		(left, right) =>
			wakeOrder(left) - wakeOrder(right) ||
			targetOrder(left) - targetOrder(right) ||
			left.id.localeCompare(right.id)
	);
	return [...history, ...active];

	function wakeOrder(item: SpaceTimelineItem): number {
		const sourceId = item.activeWakeSourceItemId ?? item.replyToSignalId;
		return (
			(sourceId ? sourcesById.get(sourceId)?.createdAtMs : undefined) ??
			item.activeWakeProgress?.startedAtMs ??
			item.createdAtMs
		);
	}

	function targetOrder(item: SpaceTimelineItem): number {
		const sourceId = item.activeWakeSourceItemId ?? item.replyToSignalId;
		return sourceId
			? (sourcesById
					.get(sourceId)
					?.wakeTargetProfileIds.indexOf(item.actorProfileId) ?? -1)
			: -1;
	}
}

export function isWakeProgressInConversation(input: {
	progress: WakeProgressItem;
	source?: SpaceTimelineItem;
	agentStreams?: readonly SpaceConversationVisibleStreamProjection[];
	threadId: string | null;
	threadRootSignalId?: string | null;
}): boolean {
	const { progress } = input;
	const placement = input.agentStreams?.find(
		(stream) =>
			stream.profileId === progress.targetProfileId &&
			(stream.dispatchId === progress.dispatchId ||
				(!progress.dispatchId &&
					stream.triggerMessageId === progress.sourceSignalId))
	)?.replyThreadRootSignalId;
	if (placement !== undefined) {
		return placement === (input.threadId ? input.threadRootSignalId : null);
	}
	if (progress.sourceContext) {
		return progress.sourceContext.threadId === input.threadId;
	}
	return Boolean(input.source && input.source.id !== input.threadRootSignalId);
}

function hasPublishedReply(
	history: readonly SpaceTimelineItem[],
	sourceId: string | undefined,
	targetProfileId: string
): boolean {
	return Boolean(
		sourceId &&
			history.some(
				(item) =>
					item.replyToSignalId === sourceId &&
					item.actorProfileKind === "agent" &&
					item.actorProfileId === targetProfileId
			)
	);
}

export function hasActiveWakeReplyForSource(input: {
	item: SpaceTimelineItem;
	timelineItems: readonly SpaceTimelineItem[];
}): boolean {
	return input.timelineItems.some(
		(candidate) =>
			candidate.activeWakeSourceItemId === input.item.id ||
			(candidate.agentStreamState?.status === "streaming" &&
				candidate.replyToSignalId === input.item.id)
	);
}

export function resolveActiveWakeSourceItem(input: {
	item: SpaceTimelineItem;
	timelineItems: readonly SpaceTimelineItem[];
}): SpaceTimelineItem {
	const sourceId =
		input.item.activeWakeSourceItemId ??
		(input.item.agentStreamState?.status === "streaming"
			? input.item.replyToSignalId
			: null);
	const source = sourceId
		? input.timelineItems.find((candidate) => candidate.id === sourceId)
		: undefined;
	return source
		? { ...source, wakeTargetProfileIds: [input.item.actorProfileId] }
		: input.item;
}

function createActiveWakePlaceholder(input: {
	progress: WakeProgressItem;
	source: SpaceTimelineItem | undefined;
	sourceId: string | undefined;
	agent: SpaceMemberDirectoryEntry | undefined;
	spaceId: string | undefined;
}): SpaceTimelineItem | null {
	const { progress, source, sourceId, agent } = input;
	const spaceId = input.spaceId ?? source?.spaceId;
	const identity =
		progress.clientMessageId ??
		progress.sourceSignalId ??
		progress.runtimeCoordinatorExecutionId ??
		progress.dispatchId;
	if (!(identity && spaceId)) {
		return null;
	}
	return {
		actorAgentControllerRef: agent?.agentControllerRef ?? null,
		actorAvatarImageUrl: agent?.avatarUrl ?? null,
		actorControllerDisplay: agent?.controllerDisplayName ?? null,
		actorName: agent?.profileName ?? progress.targetLabel,
		actorOwnerDisplay: agent?.ownerDisplay ?? null,
		actorOwnerName: agent?.ownerName ?? null,
		actorOwnerUserId: agent?.ownerUserId ?? null,
		actorProfileId: progress.targetProfileId,
		actorProfileKind: "agent",
		actorProfileName: agent?.profileName ?? progress.targetLabel,
		actorRuntimeDeviceDisplayName: agent?.runtimeDeviceDisplayName ?? null,
		agentControllerConversationId: agent?.agentControllerConversationId ?? null,
		agentWorkspace: agent?.workingDirectory ?? null,
		attachments: [],
		clientMessageId: null,
		createdAtMs: source?.createdAtMs ?? progress.startedAtMs ?? 0,
		deliveryState: source?.deliveryState ?? "sent",
		id: `active-wake:${identity}:${progress.targetProfileId}`,
		isAgentFinalReply: true,
		newMessagesDuringComposition: null,
		activeWakeSourceItemId: sourceId,
		activeWakeProgress: progress,
		wakeDispatchId: progress.dispatchId ?? undefined,
		replyPreviewText: null,
		replyToProfileName: null,
		replyToSignalId: null,
		signalType: "signal.text",
		spaceId,
		systemNoticeType: null,
		text: "",
		transientActivityPurpose: null,
		wakeClientMessageId: null,
		wakeSourceSignalId: null,
		wakeTargetProfileIds: [],
	};
}
