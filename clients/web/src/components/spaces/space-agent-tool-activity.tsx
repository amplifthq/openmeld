import { Button } from "@openmeld/ui/components/button";
import {
	ThinkingStep,
	ThinkingSteps,
	ThinkingStepsContent,
	ThinkingStepsHeader,
} from "@openmeld/ui/fluid/thinking-steps";
import { cn } from "@openmeld/ui/lib/utils";
import { InfoIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useReducedMotion } from "motion/react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { SPACE_AGENT_WORKING_STATUS_TEXT } from "#/lib/spaces/message-state";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { resolveAgentWorkPresentation } from "./agent-work-presentation";
import { SpaceAgentOrb } from "./space-agent-orb";
import { resolveSpaceAgentWorkOrbState } from "./space-agent-orb-state";
import {
	resolveVisibleSpaceAgentWorkSteps,
	type SpaceAgentWorkStep,
} from "./space-agent-tool-activity-state";
import { MessageActionTooltip } from "./space-message-actions";
import { SpaceMessageProgressRow } from "./space-message-progress-row";

const COLLAPSED_COMPLETED_STEP_LIMIT = 5;

export function SpaceAgentToolActivity(input: {
	align?: "start" | "end";
	control?: ReactNode;
	item: Pick<SpaceTimelineItem, "agentActivity" | "agentStreamState">;
	onOpenDetails?: () => void;
	onOpenMessageDetails?: () => void;
	placement?: "message" | "progress";
}) {
	const steps = resolveVisibleSpaceAgentWorkSteps(input.item);
	const latestStep = steps.at(-1);
	if (!latestStep) {
		return null;
	}

	const isLive = input.item.agentStreamState?.status === "streaming";
	const summary = resolveWorkSummary(steps, isLive);
	const accessibleSummary = isLive
		? `${SPACE_AGENT_WORKING_STATUS_TEXT}. Work summary: ${summary}`
		: `Work summary: ${summary}`;
	const activity = (
		<div className="flex w-full max-w-xl items-start gap-1 text-left">
			<ThinkingSteps
				aria-busy={isLive}
				className="min-w-0 flex-1"
				defaultOpen={false}
			>
				<ThinkingStepsHeader
					active={isLive}
					aria-busy={isLive}
					aria-label={accessibleSummary}
					className="w-fit px-0 hover:bg-transparent"
					data-testid="space-agent-tool-activity"
					summary={<span className="min-w-0 truncate">{summary}</span>}
				>
					{isLive ? (
						<span className="flex min-w-0 items-center gap-1.5">
							<SpaceAgentOrb
								state={resolveSpaceAgentWorkOrbState(latestStep)}
							/>
							<span className="whitespace-nowrap">
								{SPACE_AGENT_WORKING_STATUS_TEXT}
							</span>
						</span>
					) : (
						"Work summary"
					)}
				</ThinkingStepsHeader>
				<ThinkingStepsContent className="pb-1">
					<AgentWorkActivityViewport
						hasMoreDetails={input.item.agentActivity?.truncated === true}
						isLive={isLive}
						onOpenDetails={input.onOpenDetails}
						steps={steps}
					/>
				</ThinkingStepsContent>
			</ThinkingSteps>
			{input.onOpenMessageDetails ? (
				<MessageActionTooltip label="Message details">
					<Button
						aria-label="Open message details"
						className="size-7 shrink-0 text-muted-foreground"
						onClick={input.onOpenMessageDetails}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<InfoIcon aria-hidden="true" />
					</Button>
				</MessageActionTooltip>
			) : null}
		</div>
	);

	if (input.placement === "message") {
		return activity;
	}
	return (
		<SpaceMessageProgressRow
			align={input.align}
			control={input.control}
			slot="space-message-progress-row"
			verticalAlign="start"
		>
			{activity}
		</SpaceMessageProgressRow>
	);
}

function AgentWorkActivityViewport(input: {
	hasMoreDetails: boolean;
	isLive: boolean;
	onOpenDetails?: () => void;
	steps: readonly SpaceAgentWorkStep[];
}) {
	const reduceMotion = useReducedMotion();
	const viewportRef = useRef<HTMLUListElement>(null);
	const [isFollowing, setIsFollowing] = useState(true);
	const [lastSeenStepCount, setLastSeenStepCount] = useState(() =>
		totalStepCount(input.steps)
	);
	const shownSteps = input.isLive
		? input.steps
		: input.steps.slice(-COLLAPSED_COMPLETED_STEP_LIMIT);
	const totalCount = totalStepCount(input.steps);
	const unseenStepCount =
		input.isLive && !isFollowing
			? Math.max(0, totalCount - lastSeenStepCount)
			: 0;
	const shouldOfferDetails =
		!input.isLive &&
		Boolean(input.onOpenDetails) &&
		(input.hasMoreDetails || totalCount > COLLAPSED_COMPLETED_STEP_LIMIT);

	useLayoutEffect(() => {
		if (!(input.isLive && isFollowing) || totalCount === 0) {
			return;
		}
		scrollWorkViewportToLatest(viewportRef.current, reduceMotion);
	}, [input.isLive, isFollowing, reduceMotion, totalCount]);

	const handleScroll = () => {
		const viewport = viewportRef.current;
		if (!viewport) {
			return;
		}
		const isAtBottom =
			viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 12;
		if (!isAtBottom && isFollowing) {
			setLastSeenStepCount(totalCount);
		}
		setIsFollowing(isAtBottom);
		if (isAtBottom) {
			setLastSeenStepCount(totalCount);
		}
	};

	const handleJumpToLatest = () => {
		scrollWorkViewportToLatest(viewportRef.current, reduceMotion);
		setIsFollowing(true);
		setLastSeenStepCount(totalCount);
	};

	return (
		<div className="relative">
			<ul
				aria-label="Work steps"
				className={cn(
					"overscroll-contain pr-1",
					input.isLive
						? "max-h-[min(12rem,30dvh)] overflow-y-auto"
						: "overflow-hidden"
				)}
				onScroll={handleScroll}
				ref={viewportRef}
			>
				{shownSteps.map((step, index) => {
					const presentation = resolveAgentWorkPresentation(
						step.work,
						step.state,
						input.isLive
					);
					return (
						<li className="list-none" key={step.id}>
							<ThinkingStep
								delay={Math.min(index * 0.04, 0.2)}
								icon={
									presentation.status === "failed"
										? WarningCircleIcon
										: undefined
								}
								isLast={index === shownSteps.length - 1}
								label={formatGroupedWorkLabel(presentation.text, step.count)}
								status={presentation.status}
							/>
						</li>
					);
				})}
			</ul>
			{unseenStepCount > 0 ? (
				<button
					className="mt-1 rounded-md px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onClick={handleJumpToLatest}
					type="button"
				>
					{formatNewStepLabel(unseenStepCount)}
				</button>
			) : null}
			{shouldOfferDetails ? (
				<button
					className="mt-1 rounded-md px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onClick={input.onOpenDetails}
					type="button"
				>
					View all work details
				</button>
			) : null}
		</div>
	);
}

function resolveWorkSummary(
	steps: readonly SpaceAgentWorkStep[],
	isLive: boolean
): string {
	const latestStep = steps.at(-1);
	if (!latestStep) {
		return "Work summary";
	}
	if (isLive) {
		return resolveAgentWorkPresentation(latestStep.work, latestStep.state, true)
			.text;
	}
	if (steps.length === 1 && latestStep.count === 1) {
		return resolveAgentWorkPresentation(
			latestStep.work,
			latestStep.state,
			false
		).text;
	}
	const totalCount = totalStepCount(steps);
	const failedCount = steps.reduce(
		(count, step) => count + (step.state === "output-error" ? step.count : 0),
		0
	);
	if (failedCount === 0) {
		return `Completed ${totalCount} work steps`;
	}
	const failedSteps = steps.filter((step) => step.state === "output-error");
	if (failedSteps.length === 1 && failedSteps[0]?.count === 1) {
		const failed = failedSteps[0];
		return `Completed ${totalCount} work steps · ${
			resolveAgentWorkPresentation(failed.work, failed.state, false).text
		}`;
	}
	return `Completed ${totalCount} work steps · ${failedCount} failed — view details`;
}

function totalStepCount(steps: readonly SpaceAgentWorkStep[]): number {
	return steps.reduce((total, step) => total + step.count, 0);
}

function formatGroupedWorkLabel(text: string, count: number): string {
	return count > 1 ? `${text} · ${count} steps` : text;
}

function formatNewStepLabel(count: number): string {
	return `${count} new ${count === 1 ? "step" : "steps"} · Jump to latest`;
}

function scrollWorkViewportToLatest(
	viewport: HTMLUListElement | null,
	reduceMotion: boolean | null
) {
	if (!viewport) {
		return;
	}
	const top = viewport.scrollHeight;
	if (reduceMotion || typeof viewport.scrollTo !== "function") {
		viewport.scrollTop = top;
		return;
	}
	viewport.scrollTo({ behavior: "smooth", top });
}
