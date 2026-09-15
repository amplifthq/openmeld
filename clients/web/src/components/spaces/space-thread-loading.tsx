import { Button } from "@openmeld/ui/components/button";
import { SpinnerGapIcon, XIcon } from "@phosphor-icons/react";
import { SpaceInlineSidePanel } from "./space-inline-side-panel";
import { useSpacePanelWidth } from "./use-space-panel-width";

export function ThreadPanelHeader(input: { onClose?: () => void }) {
	return (
		<div className="flex min-h-14 items-center justify-between gap-3 border-border border-b px-4 py-3">
			<p className="font-medium text-sm">Thread</p>
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
