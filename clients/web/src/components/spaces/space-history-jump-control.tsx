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
import { useEffect, useRef, useState } from "react";
import { MESSAGE_SCROLLER_BUTTON_MOTION_CLASS_NAME } from "./primitives/message-scroller";
import type { SpaceHistoryActions } from "./space-history-rail";

export function SpaceHistoryJumpControl({
	history,
	onPrepareCatchUpUnread,
}: {
	history?: SpaceHistoryActions;
	onPrepareCatchUpUnread?: () => Promise<(() => Promise<void>) | null>;
}) {
	const reduceMotion = useReducedMotion();
	const { scrollToEnd } = useMessageScroller();
	const { end: canScrollToEnd } = useMessageScrollerScrollable();
	const canScrollToEndRef = useRef(canScrollToEnd);
	canScrollToEndRef.current = canScrollToEnd;
	const [catchUpPending, setCatchUpPending] = useState(false);
	const [catchUpError, setCatchUpError] = useState(false);
	const operationSequence = useRef(0);
	useEffect(() => {
		return () => {
			operationSequence.current += 1;
		};
	}, []);
	const pending = catchUpPending || !!history?.pending;
	const active =
		!!history?.isHistorical ||
		canScrollToEnd ||
		pending ||
		!!onPrepareCatchUpUnread;
	const actionLabel = resolveLatestActionLabel({
		catchUpError,
		hasCatchUp: !!onPrepareCatchUpUnread,
	});
	const navigateToLatest = async () => {
		if (history) {
			return await history.onLatest();
		}
		const behavior = onPrepareCatchUpUnread || reduceMotion ? "auto" : "smooth";
		scrollToEnd({ behavior });
		if (onPrepareCatchUpUnread) {
			await waitForConversationPaint();
		}
		return !canScrollToEndRef.current;
	};
	const handleLatest = async () => {
		if (pending) {
			return;
		}
		if (!onPrepareCatchUpUnread) {
			await navigateToLatest();
			return;
		}
		setCatchUpError(false);
		setCatchUpPending(true);
		const sequence = ++operationSequence.current;
		try {
			const commitCatchUp = await onPrepareCatchUpUnread();
			if (sequence !== operationSequence.current || !commitCatchUp) {
				return;
			}
			const reachedLatest = await navigateToLatest();
			if (sequence !== operationSequence.current || !reachedLatest) {
				return;
			}
			await commitCatchUp();
		} catch (error) {
			if (sequence !== operationSequence.current) {
				return;
			}
			console.error("Failed to catch up the Space read position.", error);
			setCatchUpError(true);
		} finally {
			if (sequence === operationSequence.current) {
				setCatchUpPending(false);
			}
		}
	};
	const transition = {
		duration: reduceMotion ? 0 : 0.2,
		ease: [0.23, 1, 0.32, 1] as const,
	};
	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex flex-col items-center gap-2">
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
										aria-label={actionLabel}
										className="rounded-full max-lg:pointer-fine:min-h-8 max-lg:pointer-fine:min-w-8"
										disabled={pending}
										onClick={handleLatest}
										size="icon"
										variant="ghost"
									/>
								}
							>
								{pending ? (
									<SpinnerGapIcon
										aria-hidden="true"
										className="animate-spin motion-reduce:animate-none"
									/>
								) : (
									<CaretDoubleDownIcon aria-hidden="true" weight="bold" />
								)}
							</TooltipTrigger>
							<TooltipContent className="motion-reduce:animate-none">
								{actionLabel}
							</TooltipContent>
						</Tooltip>
					</motion.div>
				</motion.div>
			</div>
			{catchUpError ? (
				<div
					className="pointer-events-auto rounded-lg bg-background px-3 py-2 text-destructive text-xs shadow-sm"
					role="alert"
				>
					You’re at the latest messages, but OpenMeld couldn’t mark them as
					read. Try again.
				</div>
			) : null}
		</div>
	);
}

async function waitForConversationPaint(): Promise<void> {
	await new Promise<void>((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});
}

function resolveLatestActionLabel(input: {
	catchUpError: boolean;
	hasCatchUp: boolean;
}): string {
	if (!input.hasCatchUp) {
		return "Jump to latest message";
	}
	return input.catchUpError
		? "Try again to mark the latest messages as read"
		: "Jump to latest and mark messages as read";
}
