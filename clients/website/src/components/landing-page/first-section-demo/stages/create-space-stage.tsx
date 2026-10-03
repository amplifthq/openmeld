import type { DemoTranscriptLine, VisibleBeatMap } from "../demo-types";
import { TerminalSectionFrame } from "../shared/terminal-section-frame";

type CreateSpaceStageProps = {
	createSpaceLines: readonly DemoTranscriptLine[];
	visibleBeatMap: VisibleBeatMap;
};

export function CreateSpaceStage({
	createSpaceLines,
	visibleBeatMap,
}: CreateSpaceStageProps) {
	const visibleLines = createSpaceLines.filter(
		(line) => visibleBeatMap[line.id] === true
	);

	if (visibleLines.length === 0) {
		return null;
	}

	return (
		<TerminalSectionFrame icon="✨" title="Space Created">
			<div className="space-y-0.5">
				{visibleLines.map((line) => (
					<p className="text-foreground/84" key={line.id}>
						{line.text}
					</p>
				))}
			</div>
		</TerminalSectionFrame>
	);
}
