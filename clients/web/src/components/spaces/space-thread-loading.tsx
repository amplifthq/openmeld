import { Button } from "@openmeld/ui/components/button";
import { SkeletonRegion } from "@openmeld/ui/components/skeleton-content";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { ArrowSquareOutIcon, XIcon } from "@phosphor-icons/react";
import { SpaceConversationSkeleton } from "./space-conversation-skeleton";
import {
	SpaceInlineSidePanel,
	SpaceInlineSidePanelHeader,
} from "./space-inline-side-panel";
import { useSpacePanelWidth } from "./use-space-panel-width";

export function ThreadPanelHeader(input: {
	onClose?: () => void;
	onGoToMessage?: () => void;
}) {
	return (
		<SpaceInlineSidePanelHeader
			actions={
				<>
					{input.onGoToMessage ? (
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										aria-label="Go to message"
										className="size-7"
										onClick={input.onGoToMessage}
										size="icon-sm"
										type="button"
										variant="ghost"
									>
										<ArrowSquareOutIcon aria-hidden="true" />
									</Button>
								}
							/>
							<TooltipContent side="bottom">Go to message</TooltipContent>
						</Tooltip>
					) : null}
					{input.onClose ? (
						<Button
							aria-label="Close thread"
							onClick={input.onClose}
							size="icon-sm"
							type="button"
							variant="ghost"
						>
							<XIcon aria-hidden="true" />
						</Button>
					) : null}
				</>
			}
		>
			<p className="font-medium text-sm">Thread</p>
		</SpaceInlineSidePanelHeader>
	);
}

export function ThreadMessagesLoading() {
	return (
		<div aria-busy="true" className="min-h-0 flex-1 overflow-hidden p-4">
			<SkeletonRegion label="Loading messages…">
				<SpaceConversationSkeleton />
			</SkeletonRegion>
		</div>
	);
}

/** Feedback only; never renders protected messages before access is confirmed. */
export function SpaceThreadLoadingPanel(input: { onClose?: () => void }) {
	const panelWidth = useSpacePanelWidth({ panel: "thread" });
	return (
		<SpaceInlineSidePanel
			ariaLabel="Thread"
			id="space-thread-panel"
			maxWidth={panelWidth.maxWidth}
			minRemainingWidth={512}
			minWidth={panelWidth.minWidth}
			onWidthChange={panelWidth.onWidthChange}
			open
			resizeHandleLabel="Resize Thread panel"
			width={panelWidth.width}
		>
			<ThreadPanelHeader onClose={input.onClose} />
			<ThreadMessagesLoading />
		</SpaceInlineSidePanel>
	);
}
