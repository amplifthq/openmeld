import { Button } from "@openmeld/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowUpIcon,
	CaretDoubleDownIcon,
	SpinnerGapIcon,
} from "@phosphor-icons/react";
import {
	useMessageScroller,
	useMessageScrollerScrollable,
} from "@shadcn/react/message-scroller";
import { motion, useReducedMotion } from "motion/react";
import { MESSAGE_SCROLLER_BUTTON_MOTION_CLASS_NAME } from "./primitives/message-scroller";
import type { SpaceHistoryActions } from "./space-history-rail";

export function SpaceHistoryJumpControl({
	history,
}: {
	history?: SpaceHistoryActions;
}) {
	const reduceMotion = useReducedMotion();
	const { scrollToEnd } = useMessageScroller();
	const { end: canScrollToEnd } = useMessageScrollerScrollable();
	const active =
		!!history?.isHistorical || canScrollToEnd || !!history?.pending;
	const transition = {
		duration: reduceMotion ? 0 : 0.2,
		ease: [0.23, 1, 0.32, 1] as const,
	};
	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
			<div
				className={cn(
					MESSAGE_SCROLLER_BUTTON_MOTION_CLASS_NAME,
					"pointer-events-auto"
				)}
				data-active={active}
				data-direction="end"
				data-slot="space-history-jump-control"
				inert={!active}
			>
				<motion.div
					className="conversation-floating-surface relative flex min-h-8 items-center"
					layout={!reduceMotion}
					style={{ borderRadius: 9999 }}
					transition={transition}
				>
					{history?.onBack && (
						<motion.div
							key="back"
							layout={reduceMotion ? false : "position"}
							transition={transition}
						>
							<Tooltip>
								<TooltipTrigger
									render={
										<Button
											aria-label="Back to previous position"
											className="rounded-full max-lg:pointer-fine:min-h-8 max-lg:pointer-fine:min-w-8"
											disabled={history.pending}
											onClick={history.onBack}
											size="icon"
											variant="ghost"
										/>
									}
								>
									<ArrowUpIcon aria-hidden="true" weight="bold" />
								</TooltipTrigger>
								<TooltipContent className="motion-reduce:animate-none">
									Back to previous position
								</TooltipContent>
							</Tooltip>
						</motion.div>
					)}
					<motion.div
						key="latest"
						layout={reduceMotion ? false : "position"}
						transition={transition}
					>
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										aria-label="Jump to latest message"
										className="rounded-full max-lg:pointer-fine:min-h-8 max-lg:pointer-fine:min-w-8"
										onClick={() => {
											if (history) {
												history.onLatest();
											} else {
												scrollToEnd({
													behavior: reduceMotion ? "auto" : "smooth",
												});
											}
										}}
										size="icon"
										variant="ghost"
									/>
								}
							>
								{history?.pending ? (
									<SpinnerGapIcon
										aria-hidden="true"
										className="animate-spin motion-reduce:animate-none"
									/>
								) : (
									<CaretDoubleDownIcon aria-hidden="true" weight="bold" />
								)}
							</TooltipTrigger>
							<TooltipContent className="motion-reduce:animate-none">
								Jump to latest message
							</TooltipContent>
						</Tooltip>
					</motion.div>
				</motion.div>
			</div>
		</div>
	);
}
