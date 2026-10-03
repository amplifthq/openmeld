import { resolveStatusToneStrongTextClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode } from "react";

import type { DemoSystemFeedLine, VisibleBeatMap } from "../demo-types";
import {
	DemoAgentIcon,
	DemoAgentMention,
	getDemoAgentAccentClassName,
	getDemoAgentAccentStyle,
	isDemoAgentName,
} from "../shared/demo-agent-icon";

type SpaceSystemFeedProps = {
	feedLines: readonly DemoSystemFeedLine[];
	visibleBeatMap: VisibleBeatMap;
};

const READY_ACTOR_CLASS_NAME = cn(
	resolveStatusToneStrongTextClassName("ready"),
	"opacity-[0.92]"
);
const ANNOUNCEMENT_CLASS_NAME = cn(
	resolveStatusToneStrongTextClassName("warning"),
	"opacity-90"
);

function AgentName({ name }: { name: string }) {
	return (
		<span
			className={`inline-flex items-center gap-2 ${getDemoAgentAccentClassName(name)}`}
			style={getDemoAgentAccentStyle(name)}
		>
			{isDemoAgentName(name) ? <DemoAgentIcon name={name} size="sm" /> : null}
			<span>{name}</span>
		</span>
	);
}

function SystemFeedLine({ line }: { line: DemoSystemFeedLine }) {
	let content: ReactNode;

	if (line.kind === "added") {
		content = (
			<>
				<span className={READY_ACTOR_CLASS_NAME}>{line.actorName}</span>
				<span className="text-muted-foreground">added</span>
				<AgentName name={line.agentName} />
				<span className="text-muted-foreground">to this space.</span>
				<span className="text-muted-foreground">·</span>
				<span className="text-muted-foreground">Mention as</span>
				<span className="inline-flex items-baseline gap-0 text-foreground/88">
					<span>`</span>
					<DemoAgentMention mention={line.wakeWith} />
					<span>`</span>
				</span>
			</>
		);
	} else if (line.kind === "joined") {
		content = (
			<>
				<span className={READY_ACTOR_CLASS_NAME}>{line.actorName}</span>
				<span className="text-muted-foreground">joined the space.</span>
			</>
		);
	} else {
		content = (
			<>
				<span className="text-muted-foreground">joined as</span>
				<span className={READY_ACTOR_CLASS_NAME}>{line.actorName}</span>
				<span className="text-muted-foreground">.</span>
			</>
		);
	}

	return (
		<div className="flex flex-wrap items-baseline gap-x-2 font-mono text-[0.84rem] leading-[1.65] sm:text-[0.9rem]">
			<span className="text-muted-foreground">*</span>
			<span className={ANNOUNCEMENT_CLASS_NAME}>📣</span>
			<span className="text-muted-foreground">system:</span>
			{content}
		</div>
	);
}

export function SpaceSystemFeed({
	feedLines,
	visibleBeatMap,
}: SpaceSystemFeedProps) {
	const visibleFeedLines = feedLines.filter(
		(line) => visibleBeatMap[line.id] === true
	);

	if (visibleFeedLines.length === 0) {
		return null;
	}

	return (
		<section>
			{visibleFeedLines.map((line) => (
				<SystemFeedLine key={line.id} line={line} />
			))}
		</section>
	);
}
