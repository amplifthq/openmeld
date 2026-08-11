import type { DemoTranscriptLine, VisibleBeatMap } from "../demo-types";
import type { DemoAgentName } from "../shared/demo-agent-icon";
import {
	DemoAgentIcon,
	getDemoAgentAccentClassName,
	getDemoAgentAccentStyle,
} from "../shared/demo-agent-icon";
import { StatusCheckItem } from "../shared/status-check-item";
import { TerminalSectionFrame } from "../shared/terminal-section-frame";

type SetupChecksStageProps = {
	readyAgentNames: readonly DemoAgentName[];
	setupChecks: readonly DemoTranscriptLine[];
	visibleBeatMap: VisibleBeatMap;
};

function SetupAgentsReadyItem({
	readyAgentNames,
}: {
	readyAgentNames: readonly DemoAgentName[];
}) {
	return (
		<div
			className="motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.88rem] leading-[1.65] motion-safe:animate-in motion-safe:duration-500 motion-reduce:animate-none sm:text-[0.94rem]"
			data-testid="setup-agents-ready"
		>
			<span className="text-foreground/84">Agents:</span>
			<span className="text-foreground/84">3 ready</span>
			<span className="text-muted-foreground">·</span>
			<span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
				{readyAgentNames.map((name, index) => (
					<span className="inline-flex items-center gap-2" key={name}>
						<DemoAgentIcon name={name} size="sm" />
						<span
							className={getDemoAgentAccentClassName(name)}
							style={getDemoAgentAccentStyle(name)}
						>
							{name}
						</span>
						{index < readyAgentNames.length - 1 ? (
							<span className="text-muted-foreground">|</span>
						) : null}
					</span>
				))}
			</span>
		</div>
	);
}

export function SetupChecksStage({
	readyAgentNames,
	setupChecks,
	visibleBeatMap,
}: SetupChecksStageProps) {
	const visibleChecks = setupChecks.filter(
		(check) => visibleBeatMap[check.id] === true
	);

	if (visibleChecks.length === 0) {
		return null;
	}

	return (
		<TerminalSectionFrame icon="◇" title="Setup Check">
			<div className="space-y-0.5">
				{visibleChecks.map((check) =>
					check.id === "setup-agents-ready" ? (
						<SetupAgentsReadyItem
							key={check.id}
							readyAgentNames={readyAgentNames}
						/>
					) : (
						<StatusCheckItem key={check.id} label={check.text} />
					)
				)}
			</div>
		</TerminalSectionFrame>
	);
}
