import type { ReactNode } from "react";
import {
	resolveSpaceMessageDeliveryPresentation,
	resolveSpaceMessageDeliveryStatusText,
	type SpaceMessageDeliveryPresentation,
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
	const content = resolveSpaceMessageProgressContent({
		deliveryPresentation,
		entries: input.entries,
		hasControl: input.control != null,
		item: input.item,
	});
	if (!content) {
		return null;
	}
	if (content.kind === "tool") {
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
		input.containerClassName
	);
}

type SpaceMessageProgressContent =
	| { kind: "tool" }
	| {
			deliveryPresentation: SpaceMessageDeliveryPresentation | null;
			entries: readonly SpaceMessageWakeThinkingEntry[];
			kind: "status";
			showAgentWorkingState: boolean;
	  };

function resolveSpaceMessageProgressContent(input: {
	deliveryPresentation: SpaceMessageDeliveryPresentation | null;
	entries: readonly SpaceMessageWakeThinkingEntry[];
	hasControl: boolean;
	item: SpaceTimelineItem;
}): SpaceMessageProgressContent | null {
	const optimisticEntries = input.item.optimisticAgentReplyProgress
		? resolveWakeProgressThinkingEntry({
				item: input.item.optimisticAgentReplyProgress,
				showElapsedTime: true,
			})
		: [];
	const presentedEntries =
		optimisticEntries.length > 0 ? optimisticEntries : input.entries;
	if (presentedEntries.some((entry) => entry.step.status === "pending")) {
		return {
			deliveryPresentation: null,
			entries: presentedEntries,
			kind: "status",
			showAgentWorkingState: false,
		};
	}
	if (hasLiveSpaceAgentToolActivity(input.item)) {
		return { kind: "tool" };
	}
	if (optimisticEntries.length > 0) {
		return {
			deliveryPresentation: null,
			entries: optimisticEntries,
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
