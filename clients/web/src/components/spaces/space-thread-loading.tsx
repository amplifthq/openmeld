import { Button } from "@openmeld/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	ArrowSquareOutIcon,
	SpinnerGapIcon,
	XIcon,
} from "@phosphor-icons/react";
import { SpaceInlineSidePanel } from "./space-inline-side-panel";
import { useSpacePanelWidth } from "./use-space-panel-width";

export function ThreadPanelHeader(input: {
	onClose?: () => void;
	onGoToMessage?: () => void;
}) {
	return (
		<div className="flex min-h-14 items-center justify-between gap-3 border-border border-b px-4 py-3">
			<p className="font-medium text-sm">Thread</p>
			<div className="flex items-center gap-1">
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
			</div>
		</div>
	);
}

export function ThreadMessagesLoading() {
	return (
		<div
			aria-busy="true"
			className="flex min-h-0 flex-1 items-center justify-center p-4"
		>
			<output className="flex flex-col items-center gap-2 text-muted-foreground text-sm">
				<SpinnerGapIcon
					aria-hidden="true"
					className="size-5 motion-safe:animate-spin"
				/>
				<span>Loading messages…</span>
			</output>
		</div>
	);
}

/** Feedback only; never renders protected messages before access is confirmed. */
export function SpaceThreadLoadingPanel() {
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
			<ThreadPanelHeader />
			<ThreadMessagesLoading />
		</SpaceInlineSidePanel>
	);
}
