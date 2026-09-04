import type { ReactNode } from "react";
import {
	resolveSpaceMessageDeliveryPresentation,
	resolveSpaceMessageDeliveryStatusText,
} from "#/lib/spaces/message-state";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { useNowMs } from "#/lib/spaces/use-now-ms";
import {
	resolveWakeProgressThinkingEntry,
	type SpaceMessageWakeThinkingEntry,
} from "#/lib/spaces/wake-progress-presentation";
import { SpaceAgentToolActivity } from "./space-agent-tool-activity";
import { hasLiveSpaceAgentToolActivity } from "./space-agent-tool-activity-state";
import { SpaceMessageDeliveryStatus } from "./space-message-delivery-status";
import { SpaceMessageProgressRow } from "./space-message-progress-row";
import { SpaceMessageWakeThinkingIndicator } from "./space-message-wake-thinking-indicator";

export function SpaceMessageProgressStatus(input: {
	align?: "start" | "end";
	containerClassName?: string;
	control?: ReactNode;
	entries: readonly SpaceMessageWakeThinkingEntry[];
	item: SpaceTimelineItem;
	onOpenMessageDetails?: () => void;
}) {
	const shouldTick = input.item.deliveryState === "pending";
	const nowMs = useNowMs(shouldTick ? 1000 : null);
	const deliveryPresentation = resolveSpaceMessageDeliveryPresentation({
		item: input.item,
		nowMs,
	});
	const optimisticEntries = input.item.optimisticAgentReplyProgress
		? resolveWakeProgressThinkingEntry({
				item: input.item.optimisticAgentReplyProgress,
				showElapsedTime: true,
			})
		: [];
	const presentedEntries =
		optimisticEntries.length > 0 ? optimisticEntries : input.entries;
	if (presentedEntries.some((entry) => entry.step.status === "pending")) {
		return wrapProgressStatus(
			<SpaceMessageWakeThinkingIndicator
				align={input.align}
				control={input.control}
				entries={presentedEntries}
				onOpenMessageDetails={input.onOpenMessageDetails}
			/>,
			input.containerClassName
		);
	}
	if (hasLiveSpaceAgentToolActivity(input.item)) {
		return wrapProgressStatus(
			<SpaceAgentToolActivity
				align={input.align}
				control={input.control}
				item={input.item}
				onOpenMessageDetails={input.onOpenMessageDetails}
			/>,
			input.containerClassName
		);
	}
	if (optimisticEntries.length > 0) {
		return wrapProgressStatus(
			<SpaceMessageWakeThinkingIndicator
				align={input.align}
				control={input.control}
				entries={optimisticEntries}
				onOpenMessageDetails={input.onOpenMessageDetails}
			/>,
			input.containerClassName
		);
	}
	const hasWakePresentation = input.entries.length > 0;
	if (!hasWakePresentation && deliveryPresentation === "agent_streaming") {
		return wrapProgressStatus(
			<SpaceMessageProgressRow
				align={input.align}
				control={input.control}
				slot="space-message-progress-row"
				testId="space-message-progress-row"
			>
				<SpaceMessageDeliveryStatus
					align={input.align}
					presentation={deliveryPresentation}
				/>
			</SpaceMessageProgressRow>,
			input.containerClassName
		);
	}
	const showDeliveryStatus = !(
		hasWakePresentation &&
		(deliveryPresentation === "sending" ||
			deliveryPresentation === "agent_streaming")
	);
	const showWakeProgress = !(
		hasWakePresentation &&
		(deliveryPresentation === "sending_delayed" ||
			deliveryPresentation === "agent_stream_failed" ||
			deliveryPresentation === "agent_stream_stopped" ||
			deliveryPresentation === "agent_stream_publish_failed")
	);
	const hasVisibleDeliveryStatus =
		showDeliveryStatus &&
		deliveryPresentation !== null &&
		resolveSpaceMessageDeliveryStatusText(deliveryPresentation) !== null;
	const hasVisibleWakeProgress =
		showWakeProgress && (input.entries.length > 0 || input.control != null);
	if (!(hasVisibleDeliveryStatus || hasVisibleWakeProgress)) {
		return null;
	}

	return wrapProgressStatus(
		<>
			{hasVisibleDeliveryStatus ? (
				<SpaceMessageDeliveryStatus
					align={input.align}
					presentation={deliveryPresentation}
				/>
			) : null}
			{hasVisibleWakeProgress ? (
				<SpaceMessageWakeThinkingIndicator
					align={input.align}
					control={input.control}
					entries={input.entries}
					onOpenMessageDetails={input.onOpenMessageDetails}
					showAgentWorkingState={deliveryPresentation === "agent_streaming"}
				/>
			) : null}
		</>,
		input.containerClassName
	);
}

function wrapProgressStatus(
	content: ReactNode,
	containerClassName: string | undefined
) {
	if (!containerClassName) {
		return content;
	}
	return (
		<div
			className={containerClassName}
			data-slot="space-message-row-progress-inset"
		>
			{content}
		</div>
	);
}
