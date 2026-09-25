import {
	ThinkingStep,
	ThinkingSteps,
	ThinkingStepsContent,
	ThinkingStepsHeader,
} from "@openmeld/ui/fluid/thinking-steps";
import { cn } from "@openmeld/ui/lib/utils";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { useReducedMotion } from "motion/react";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { MessageResponse } from "#/components/ai/message-response";
import { SPACE_AGENT_WORKING_STATUS_TEXT } from "#/lib/spaces/message-state";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { resolveAgentWorkPresentation } from "./agent-work-presentation";
import { SpaceAgentOrb } from "./space-agent-orb";
import {
	DEFAULT_SPACE_AGENT_ORB_STATE,
	resolveSpaceAgentWorkOrbState,
} from "./space-agent-orb-state";
import {
	resolveVisibleSpaceAgentWorkSteps,
	type SpaceAgentWorkStep,
} from "./space-agent-tool-activity-state";
import { SpaceMessageProgressRow } from "./space-message-progress-row";

export function SpaceAgentToolActivity(input: {
	align?: "start" | "end";
	control?: ReactNode;
	item: Pick<
		SpaceTimelineItem,
		"agentActivity" | "agentStreamState" | "agentPublicProgress"
	>;
	placement?: "message" | "progress";
}) {
	const steps = resolveVisibleSpaceAgentWorkSteps(input.item);
	const latestStep = steps.at(-1);
	const isLive = input.item.agentStreamState?.status === "streaming";
	const progress = isLive
		? input.item.agentStreamState?.progress
		: input.item.agentPublicProgress;
	const [open, setOpen] = useState(isLive);
	const wasLive = useRef(isLive);
	useEffect(() => {
		if (wasLive.current !== isLive) {
			setOpen(isLive);
		}
		wasLive.current = isLive;
	}, [isLive]);
	if (!(latestStep || progress)) {
		return null;
	}

	let summary = isLive ? "Live updates" : "Progress updates";
	if (latestStep) {
		summary = resolveWorkSummary(steps, isLive);
	}
	const accessibleSummary = isLive
		? `${SPACE_AGENT_WORKING_STATUS_TEXT}. ${latestStep ? `Work summary: ${summary}` : summary}`
		: `Work summary: ${summary}`;
	const activity = (
		<div className="flex w-fit max-w-xl items-start text-left">
			<ThinkingSteps
				aria-busy={isLive}
				className="min-w-0 flex-[0_1_auto]"
				onOpenChange={setOpen}
				open={open}
			>
				<div className="flex w-fit max-w-full items-center gap-2">
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
									state={
										latestStep
											? resolveSpaceAgentWorkOrbState(latestStep)
											: DEFAULT_SPACE_AGENT_ORB_STATE
									}
								/>
								<span className="whitespace-nowrap">
									{SPACE_AGENT_WORKING_STATUS_TEXT}
								</span>
							</span>
						) : (
							"Work summary"
						)}
					</ThinkingStepsHeader>
					{input.control ? (
						<div
							className="flex min-h-7 shrink-0 items-center"
							data-slot="space-message-progress-control"
							data-testid="space-message-progress-control-slot"
						>
							{input.control}
						</div>
					) : null}
				</div>
				<ThinkingStepsContent className="pb-1">
					<AgentWorkActivityViewport
						isLive={isLive}
						progress={progress}
						progressActive={input.item.agentStreamState?.progressActive}
						steps={steps}
					/>
				</ThinkingStepsContent>
			</ThinkingSteps>
		</div>
	);

	if (input.placement === "message") {
		return activity;
	}
	return (
		<SpaceMessageProgressRow
			align={input.align}
			compact
			slot="space-message-progress-row"
			verticalAlign="start"
		>
			{activity}
		</SpaceMessageProgressRow>
	);
}

function AgentWorkActivityViewport(input: {
	isLive: boolean;
	progress?: string;
	progressActive?: boolean;
	steps: readonly SpaceAgentWorkStep[];
}) {
	const reduceMotion = useReducedMotion();
	const viewportRef = useRef<HTMLUListElement>(null);
	const [isFollowing, setIsFollowing] = useState(true);
	const [lastSeenStepCount, setLastSeenStepCount] = useState(() =>
		totalStepCount(input.steps)
	);
	const [lastSeenProgress, setLastSeenProgress] = useState(input.progress);
	const shownSteps = input.steps;
	const totalCount = totalStepCount(input.steps);
	const progressLength = input.progress?.length ?? 0;
	const unseenStepCount =
		input.isLive && !isFollowing
			? Math.max(0, totalCount - lastSeenStepCount)
			: 0;
	const hasUnseenProgress =
		input.isLive && !isFollowing && input.progress !== lastSeenProgress;

	useLayoutEffect(() => {
		if (
			!(input.isLive && isFollowing) ||
			(totalCount === 0 && progressLength === 0)
		) {
			return;
		}
		scrollWorkViewportToLatest(viewportRef.current, reduceMotion);
	}, [input.isLive, isFollowing, progressLength, reduceMotion, totalCount]);

	const handleScroll = () => {
		const viewport = viewportRef.current;
		if (!viewport) {
			return;
		}
		const isAtBottom =
			viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 12;
		if (!isAtBottom && isFollowing) {
			setLastSeenStepCount(totalCount);
			setLastSeenProgress(input.progress);
		}
		setIsFollowing(isAtBottom);
		if (isAtBottom) {
			setLastSeenStepCount(totalCount);
			setLastSeenProgress(input.progress);
		}
	};

	const handleJumpToLatest = () => {
		scrollWorkViewportToLatest(viewportRef.current, reduceMotion);
		setIsFollowing(true);
		setLastSeenStepCount(totalCount);
		setLastSeenProgress(input.progress);
	};

	return (
		<div className="relative">
			<ul
				aria-label={input.progress ? "Work steps and updates" : "Work steps"}
				className={cn(
					"overscroll-contain pr-1",
					"max-h-[min(12rem,30dvh)] overflow-y-auto"
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
				{input.progress ? (
					<li className="list-none py-1.5" data-slot="agent-public-progress">
						<p className="mb-1 text-muted-foreground text-xs">
							Thinking process
						</p>
						<MessageResponse
							isStreaming={input.isLive && input.progressActive !== false}
							variant="reasoning"
						>
							{input.progress}
						</MessageResponse>
					</li>
				) : null}
			</ul>
			{unseenStepCount > 0 || hasUnseenProgress ? (
				<button
					className="mt-1 rounded-md px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onClick={handleJumpToLatest}
					type="button"
				>
					{unseenStepCount > 0
						? formatNewStepLabel(unseenStepCount)
						: "New update · Jump to latest"}
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
