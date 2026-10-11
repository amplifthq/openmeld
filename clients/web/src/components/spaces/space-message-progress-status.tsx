import type { ReactNode } from "react";
import {
	resolveSpaceMessageDeliveryPresentation,
	resolveSpaceMessageDeliveryStatusText,
	type SpaceMessageDeliveryPresentation,
} from "#/lib/spaces/message-state";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { useNowMs } from "#/lib/spaces/use-now-ms";
import {
	resolveSpaceMessageStopFeedback,
	resolveWakeProgressThinkingEntry,
	type SpaceMessageWakeThinkingEntry,
} from "#/lib/spaces/wake-progress-presentation";
import type { SpaceWakeOutcomeIndex } from "#/lib/spaces/wake-stop-target";
import { SpaceAgentToolActivity } from "./space-agent-tool-activity";
import { hasLiveSpaceAgentToolActivity } from "./space-agent-tool-activity-state";
import { SpaceMessageDeliveryStatus } from "./space-message-delivery-status";
import { SpaceMessageProgressRow } from "./space-message-progress-row";
import { SpaceMessageWakeThinkingIndicator } from "./space-message-wake-thinking-indicator";
import {
	SpacePendingSendFeedback,
	useSpaceSendFailure,
} from "./space-pending-send";
import { useSpaceWakeStopRequestStatuses } from "./space-wake-stop-control";
import { SpaceWakeBookmarkAnchor } from "./space-work-bookmarks";

export function SpaceMessageProgressStatus(input: {
	align?: "start" | "end";
	containerClassName?: string;
	control?: ReactNode;
	entries: readonly SpaceMessageWakeThinkingEntry[];
	item: SpaceTimelineItem;
	wakeOutcomeIndex?: SpaceWakeOutcomeIndex;
	wakeSourceItem?: SpaceTimelineItem;
	onOpenMessageDetails?: () => void;
}) {
	const requestStartedAtMs = resolveRequestStartedAtMs(input);
	const stopFeedback = resolveSpaceMessageStopFeedback(
		input.item,
		useSpaceWakeStopRequestStatuses()
	).filter(
		(entry) =>
			!input.wakeOutcomeIndex?.hasVisibleOutcomeForSourceTarget({
				sourceItem: input.wakeSourceItem ?? input.item,
				targetProfileId: entry.targetProfileId,
			})
	);
	const sendFailure = useSpaceSendFailure(input.item.id);
	const shouldTick = input.item.deliveryState === "pending";
	const nowMs = useNowMs(shouldTick ? 1000 : null);
	const deliveryPresentation = resolveSpaceMessageDeliveryPresentation({
		item: input.item,
		nowMs,
	});
	const content: SpaceMessageProgressContent | null =
		stopFeedback.length > 0
			? {
					kind: "status",
					deliveryPresentation: null,
					entries: [
						...input.entries.filter(
							(entry) =>
								!stopFeedback.some(
									(feedback) =>
										feedback.targetProfileId === entry.targetProfileId
								)
						),
						...stopFeedback,
					],
					showAgentWorkingState: false,
				}
			: resolveSpaceMessageProgressContent({
					deliveryPresentation,
					entries: input.entries,
					hasControl: input.control != null,
					item: input.item,
					requestStartedAtMs,
				});
	if (sendFailure) {
		return wrapProgressStatus(
			<SpacePendingSendFeedback align={input.align} signalId={input.item.id} />,
			input.containerClassName,
			input.item.activeWakeProgress
		);
	}
	if (!content) {
		return null;
	}
	if (content.kind === "work") {
		return wrapProgressStatus(
			<SpaceAgentToolActivity
				align={input.align}
				control={input.control}
				item={input.item}
				requestStartedAtMs={requestStartedAtMs}
			/>,
			input.containerClassName,
			input.item.activeWakeProgress
		);
	}
	if (content.deliveryPresentation && content.entries.length === 0) {
		return wrapProgressStatus(
			<SpaceMessageProgressRow
				align={input.align}
				control={input.control}
				slot="space-message-progress-row"
			>
				<SpaceMessageDeliveryStatus
					align={input.align}
					presentation={content.deliveryPresentation}
					requestStartedAtMs={requestStartedAtMs}
				/>
			</SpaceMessageProgressRow>,
			input.containerClassName,
			input.item.activeWakeProgress
		);
	}

	return wrapProgressStatus(
		<>
			{content.deliveryPresentation ? (
				<SpaceMessageDeliveryStatus
					align={input.align}
					presentation={content.deliveryPresentation}
				/>
			) : null}
			{content.entries.length > 0 || input.control != null ? (
				<SpaceMessageWakeThinkingIndicator
					align={input.align}
					control={input.control}
					entries={content.entries}
					onOpenMessageDetails={input.onOpenMessageDetails}
					showAgentWorkingState={content.showAgentWorkingState}
				/>
			) : null}
		</>,
		input.containerClassName,
		input.item.activeWakeProgress
	);
}

type SpaceMessageProgressContent =
	| { kind: "work" }
	| {
			deliveryPresentation: SpaceMessageDeliveryPresentation | null;
			entries: readonly SpaceMessageWakeThinkingEntry[];
			kind: "status";
			showAgentWorkingState: boolean;
	  };

function resolveRequestStartedAtMs(input: {
	item: SpaceTimelineItem;
	wakeSourceItem?: SpaceTimelineItem;
}): number | undefined {
	const source = input.wakeSourceItem ?? input.item;
	const progress = input.item.activeWakeProgress;
	// A fresh Wake of an older message is a new request, not time spent waiting
	// since that message was originally posted.
	if (
		progress?.clientMessageId &&
		source.clientMessageId &&
		progress.clientMessageId !== source.clientMessageId
	) {
		return progress.startedAtMs;
	}
	return source.createdAtMs > 0 ? source.createdAtMs : progress?.startedAtMs;
}

function resolveActiveWakeEntries(
	item: SpaceTimelineItem,
	requestStartedAtMs?: number
) {
	if (!item.activeWakeProgress) {
		return [];
	}
	return resolveWakeProgressThinkingEntry({
		item: item.agentStreamState
			? { ...item.activeWakeProgress, previewText: undefined }
			: item.activeWakeProgress,
		showElapsedTime: true,
		// The Agent reply already owns the avatar and identity header.
		showTargetName: false,
		requestStartedAtMs,
	});
}

function resolveSpaceMessageProgressContent(input: {
	deliveryPresentation: SpaceMessageDeliveryPresentation | null;
	entries: readonly SpaceMessageWakeThinkingEntry[];
	hasControl: boolean;
	item: SpaceTimelineItem;
	requestStartedAtMs?: number;
}): SpaceMessageProgressContent | null {
	const activeEntries = resolveActiveWakeEntries(
		input.item,
		input.requestStartedAtMs
	);
	const presentedEntries =
		activeEntries.length > 0 ? activeEntries : input.entries;
	if (presentedEntries.some((entry) => entry.step.status === "pending")) {
		return {
			deliveryPresentation: null,
			entries: presentedEntries,
			kind: "status",
			showAgentWorkingState: false,
		};
	}
	if (hasLiveSpaceAgentWork(input.item)) {
		return { kind: "work" };
	}
	if (activeEntries.length > 0) {
		return {
			deliveryPresentation: null,
			entries: activeEntries,
			kind: "status",
			showAgentWorkingState: false,
		};
	}
	const hasWakePresentation = input.entries.length > 0;
	if (
		!hasWakePresentation &&
		input.deliveryPresentation === "agent_streaming"
	) {
		return {
			deliveryPresentation: input.deliveryPresentation,
			entries: [],
			kind: "status",
			showAgentWorkingState: false,
		};
	}
	const showDeliveryStatus = !(
		hasWakePresentation &&
		(input.deliveryPresentation === "sending" ||
			input.deliveryPresentation === "agent_streaming")
	);
	const showWakeProgress = !(
		hasWakePresentation &&
		(input.deliveryPresentation === "sending_delayed" ||
			input.deliveryPresentation === "agent_stream_failed" ||
			input.deliveryPresentation === "agent_stream_stopped" ||
			input.deliveryPresentation === "agent_stream_publish_failed")
	);
	const hasVisibleDeliveryStatus =
		showDeliveryStatus &&
		input.deliveryPresentation !== null &&
		resolveSpaceMessageDeliveryStatusText(input.deliveryPresentation) !== null;
	const hasVisibleWakeProgress =
		showWakeProgress && (input.entries.length > 0 || input.hasControl);
	if (!(hasVisibleDeliveryStatus || hasVisibleWakeProgress)) {
		return null;
	}
	return {
		deliveryPresentation: hasVisibleDeliveryStatus
			? input.deliveryPresentation
			: null,
		entries: hasVisibleWakeProgress ? input.entries : [],
		kind: "status",
		showAgentWorkingState: input.deliveryPresentation === "agent_streaming",
	};
}

function hasLiveSpaceAgentWork(item: SpaceTimelineItem): boolean {
	return (
		hasLiveSpaceAgentToolActivity(item) ||
		(item.agentStreamState?.status === "streaming" &&
			Boolean(item.agentStreamState.progress || item.agentStreamState.thinking))
	);
}

function wrapProgressStatus(
	content: ReactNode,
	containerClassName: string | undefined,
	progress?: SpaceTimelineItem["activeWakeProgress"]
) {
	const anchoredContent = progress ? (
		<SpaceWakeBookmarkAnchor item={progress}>{content}</SpaceWakeBookmarkAnchor>
	) : (
		content
	);
	if (!containerClassName) {
		return anchoredContent;
	}
	return (
		<div
			className={containerClassName}
			data-slot="space-message-row-progress-inset"
		>
			{anchoredContent}
		</div>
	);
}
