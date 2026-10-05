import type { LocalAgentReasoningState } from "@openmeld/schemas/types";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	ThinkingStep,
	ThinkingSteps,
	ThinkingStepsContent,
	ThinkingStepsHeader,
} from "@openmeld/ui/fluid/thinking-steps";
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
import { SpaceRequestElapsedTime } from "./space-request-elapsed-time";

export function SpaceAgentToolActivity(input: {
	align?: "start" | "end";
	control?: ReactNode;
	item: Pick<
		SpaceTimelineItem,
		"agentActivity" | "agentStreamState" | "agentPublicProgress"
	>;
	placement?: "message" | "progress";
	requestStartedAtMs?: number;
}) {
	const steps = resolveVisibleSpaceAgentWorkSteps(input.item);
	const latestStep = steps.at(-1);
	const isLive = input.item.agentStreamState?.status === "streaming";
	const progress = isLive
		? input.item.agentStreamState?.progress
		: input.item.agentPublicProgress;
	const reasoning = input.item.agentStreamState?.thinking;
	const reasoningNotice = reasoning
		? null
		: resolveReasoningNotice(
				input.item.agentStreamState?.reasoningState?.status
			);
	const [open, setOpen] = useState(isLive);
	const wasLive = useRef(isLive);
	useEffect(() => {
		if (wasLive.current !== isLive) {
			setOpen(isLive);
		}
		wasLive.current = isLive;
	}, [isLive]);
	if (!(latestStep || progress || reasoning || reasoningNotice)) {
		return null;
	}

	const summary = resolveAgentWorkHeading({
		isLive,
		progress,
		reasoning: reasoning ?? reasoningNotice,
		steps,
	});
	const accessibleSummary = isLive
		? `${SPACE_AGENT_WORKING_STATUS_TEXT}. ${latestStep ? `Work summary: ${summary}` : summary}`
		: `Work summary: ${summary}`;
	const activity = (
		<div className="flex w-full min-w-0 max-w-full items-start text-left">
			<ThinkingSteps
				aria-busy={isLive}
				className="min-w-0 flex-1"
				onOpenChange={setOpen}
				open={open}
			>
				<div className="flex w-full min-w-0 items-center gap-2">
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
								<span className="min-w-0">
									{SPACE_AGENT_WORKING_STATUS_TEXT}
								</span>
								{input.requestStartedAtMs !== undefined && (
									<>
										<span aria-hidden="true">·</span>
										<SpaceRequestElapsedTime
											startedAtMs={input.requestStartedAtMs}
										/>
									</>
								)}
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
						reasoning={reasoning}
						reasoningActive={input.item.agentStreamState?.thinkingActive}
						reasoningFirstOutputMs={
							input.item.agentStreamState?.reasoningState?.firstOutputMs
						}
						reasoningNotice={reasoningNotice}
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
			fill
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
	reasoning?: string;
	reasoningActive?: boolean;
	reasoningFirstOutputMs?: number;
	reasoningNotice?: string | null;
	steps: readonly SpaceAgentWorkStep[];
}) {
	const reduceMotion = useReducedMotion();
	const viewportRef = useRef<HTMLDivElement>(null);
	const [isFollowing, setIsFollowing] = useState(true);
	const [lastSeenStepCount, setLastSeenStepCount] = useState(() =>
		totalStepCount(input.steps)
	);
	const currentText = input.progress ?? input.reasoning;
	const [lastSeenText, setLastSeenText] = useState(currentText);
	const shownSteps = input.steps;
	const totalCount = totalStepCount(input.steps);
	const textLength =
		(input.progress?.length ?? 0) + (input.reasoning?.length ?? 0);
	const unseenStepCount =
		input.isLive && !isFollowing
			? Math.max(0, totalCount - lastSeenStepCount)
			: 0;
	const hasUnseenText =
		input.isLive && !isFollowing && currentText !== lastSeenText;

	useLayoutEffect(() => {
		if (
			!(input.isLive && isFollowing) ||
			(totalCount === 0 && textLength === 0)
		) {
			return;
		}
		scrollWorkViewportToLatest(viewportRef.current, reduceMotion);
	}, [input.isLive, isFollowing, textLength, reduceMotion, totalCount]);

	const handleScroll = () => {
		const viewport = viewportRef.current;
		if (!viewport) {
			return;
		}
		const isAtBottom =
			viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 12;
		if (!isAtBottom && isFollowing) {
			setLastSeenStepCount(totalCount);
			setLastSeenText(currentText);
		}
		setIsFollowing(isAtBottom);
		if (isAtBottom) {
			setLastSeenStepCount(totalCount);
			setLastSeenText(currentText);
		}
	};

	const handleJumpToLatest = () => {
		scrollWorkViewportToLatest(viewportRef.current, reduceMotion);
		setIsFollowing(true);
		setLastSeenStepCount(totalCount);
		setLastSeenText(currentText);
	};

	return (
		<div className="relative min-w-0">
			<ScrollArea
				className="max-h-[min(12rem,30dvh)]"
				viewportClassName="overscroll-contain"
				viewportProps={{ onScroll: handleScroll }}
				viewportRef={viewportRef}
			>
				<ul
					aria-label={resolveAgentWorkListLabel(input)}
					className="min-w-0 pr-1"
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
						<AgentStreamText
							label="Agent updates"
							showLabel={shownSteps.length > 0 || Boolean(input.reasoning)}
							slot="agent-public-progress"
							streaming={false}
							text={input.progress}
						/>
					) : null}
					{input.reasoning ? (
						<AgentStreamText
							firstOutputMs={input.reasoningFirstOutputMs}
							label="Thinking process"
							showLabel={shownSteps.length > 0 || Boolean(input.progress)}
							slot="agent-reasoning"
							streaming={input.isLive && input.reasoningActive !== false}
							text={input.reasoning}
						/>
					) : null}
					{!input.reasoning && input.reasoningNotice ? (
						<li className="list-none py-1.5 text-muted-foreground text-xs">
							{input.reasoningNotice}
						</li>
					) : null}
				</ul>
			</ScrollArea>
			{unseenStepCount > 0 || hasUnseenText ? (
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

function AgentStreamText(input: {
	firstOutputMs?: number;
	label: string;
	showLabel?: boolean;
	slot: string;
	streaming: boolean;
	text: string;
}) {
	return (
		<li className="list-none py-1.5" data-slot={input.slot}>
			{input.showLabel !== false || input.firstOutputMs !== undefined ? (
				<p className="mb-1 text-muted-foreground text-xs">
					{input.showLabel !== false ? input.label : null}
					{input.firstOutputMs !== undefined ? (
						<span className={input.showLabel === false ? undefined : "ml-2"}>
							First output in {(input.firstOutputMs / 1000).toFixed(1)}s
						</span>
					) : null}
				</p>
			) : null}
			<MessageResponse isStreaming={input.streaming} variant="reasoning">
				{input.text}
			</MessageResponse>
		</li>
	);
}

function resolveReasoningNotice(
	status: LocalAgentReasoningState["status"] | undefined
): string | null {
	switch (status) {
		case "disabled":
			return "Live reasoning is turned off by this Agent’s owner.";
		case "unavailable":
			return "This Agent connection doesn’t support live reasoning.";
		case "waiting":
			return "Waiting for reasoning output…";
		default:
			return null;
	}
}

function resolveAgentWorkHeading(input: {
	isLive: boolean;
	progress?: string;
	reasoning?: string | null;
	steps: readonly SpaceAgentWorkStep[];
}): string {
	if (input.steps.length > 0) {
		return resolveWorkSummary(input.steps, input.isLive);
	}
	if (input.reasoning) {
		return "Thinking process";
	}
	return "Agent updates";
}

function resolveAgentWorkListLabel(input: {
	progress?: string;
	reasoning?: string;
	reasoningNotice?: string | null;
}): string {
	if (input.reasoning) {
		return "Work steps and reasoning";
	}
	if (input.progress) {
		return "Work steps and updates";
	}
	return input.reasoningNotice ? "Thinking process" : "Work steps";
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
	const unconfirmedCount = steps.reduce(
		(count, step) =>
			count + (step.work.outcome === "outcome_unknown" ? step.count : 0),
		0
	);
	const failedCount = steps.reduce(
		(count, step) =>
			count +
			(step.state === "output-error" && step.work.outcome !== "outcome_unknown"
				? step.count
				: 0),
		0
	);
	if (unconfirmedCount > 0) {
		return `${totalCount} work steps · ${unconfirmedCount} awaiting confirmation${failedCount ? ` · ${failedCount} failed — view details` : ""}`;
	}
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
	viewport: HTMLDivElement | null,
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
