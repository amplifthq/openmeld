import { resolveStatusToneStrongTextClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { TextShimmer } from "#/components/motion-primitives/text-shimmer";
import type {
	DemoReplyingState,
	DemoTranscriptLine,
	VisibleBeatMap,
} from "../demo-types";
import {
	DemoAgentIcon,
	getDemoAgentAccentClassName,
	getDemoAgentAccentStyle,
	isDemoAgentName,
} from "../shared/demo-agent-icon";

type ReplyingStatusProps = {
	replyingStates: {
		aggregate: DemoTranscriptLine;
		agents: readonly DemoReplyingState[];
	};
	visibleBeatMap: VisibleBeatMap;
};

const ANNOUNCEMENT_CLASS_NAME = cn(
	resolveStatusToneStrongTextClassName("warning"),
	"opacity-90"
);

function ReplyingSystemLine({
	agentName,
	mention,
}: {
	agentName: string;
	mention: string;
}) {
	return (
		<div
			className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[0.84rem] leading-[1.65] sm:text-[0.9rem]"
			data-testid={`replying-line-${agentName}`}
		>
			<span className="text-muted-foreground">*</span>
			<span className={ANNOUNCEMENT_CLASS_NAME}>📣</span>
			<span className="text-muted-foreground">system ·</span>
			<span
				className={`inline-flex items-center gap-2 ${getDemoAgentAccentClassName(agentName)}`}
				style={getDemoAgentAccentStyle(agentName)}
			>
				{isDemoAgentName(agentName) ? (
					<DemoAgentIcon name={agentName} size="sm" />
				) : null}
				<span>{mention}</span>
			</span>
			<TextShimmer
				as="span"
				className="font-mono text-[0.84rem] [--base-color:#a1a1aa] [--base-gradient-color:#000] sm:text-[0.9rem] dark:[--base-color:#8e96a3] dark:[--base-gradient-color:#f3f4f6]"
				duration={1.5}
				spread={1.6}
			>
				is replying…
			</TextShimmer>
		</div>
	);
}

export function ReplyingStatus({
	replyingStates,
	visibleBeatMap,
}: ReplyingStatusProps) {
	const isAggregateVisible =
		visibleBeatMap[replyingStates.aggregate.id] === true;
	const visibleAgentStates = replyingStates.agents.filter(
		(agentState) =>
			visibleBeatMap[agentState.id] === true &&
			visibleBeatMap[agentState.hideWhenBeatId] !== true
	);

	if (!isAggregateVisible && visibleAgentStates.length === 0) {
		return null;
	}

	return (
		<section className="motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-3 space-y-2 motion-safe:animate-in motion-safe:duration-500 motion-reduce:animate-none">
			{isAggregateVisible ? (
				<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[0.84rem] text-muted-foreground leading-[1.65] sm:text-[0.9rem]">
					<span>*</span>
					<span className={ANNOUNCEMENT_CLASS_NAME}>📣</span>
					<span>{replyingStates.aggregate.text}</span>
				</div>
			) : null}

			{visibleAgentStates.map((agentState) => (
				// The replying line keeps the real @mention text but swaps the generic
				// robot emoji for the matching provider icon.
				<ReplyingSystemLine
					agentName={agentState.agentName}
					key={agentState.id}
					mention={agentState.mention}
				/>
			))}
		</section>
	);
}
