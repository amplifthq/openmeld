import type { DemoTranscriptLine, VisibleBeatMap } from "../demo-types";
import {
	DemoAgentIcon,
	getDemoAgentAccentClassName,
	getDemoAgentAccentStyle,
	isDemoAgentName,
} from "../shared/demo-agent-icon";
import { TerminalSectionFrame } from "../shared/terminal-section-frame";

type BringAgentsStageProps = {
	bringAgentsLines: readonly DemoTranscriptLine[];
	visibleBeatMap: VisibleBeatMap;
};

export function BringAgentsStage({
	bringAgentsLines,
	visibleBeatMap,
}: BringAgentsStageProps) {
	const visibleLines = bringAgentsLines.filter(
		(line) => visibleBeatMap[line.id] === true
	);

	if (visibleLines.length === 0) {
		return null;
	}

	return (
		<TerminalSectionFrame title="Added to This Space">
			<div className="space-y-0.5">
				{visibleLines.map((line, index) => (
					<p
						className={
							index < visibleLines.length - 1
								? "text-foreground/84"
								: "text-muted-foreground"
						}
						key={line.id}
					>
						{isDemoAgentName(line.text) ? (
							<span
								className={`inline-flex items-center gap-2 ${getDemoAgentAccentClassName(line.text)}`}
								style={getDemoAgentAccentStyle(line.text)}
							>
								<DemoAgentIcon name={line.text} size="sm" />
								<span>{line.text}</span>
							</span>
						) : (
							line.text
						)}
					</p>
				))}
			</div>
		</TerminalSectionFrame>
	);
}
