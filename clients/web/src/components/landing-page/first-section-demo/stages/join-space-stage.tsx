import type { DemoTranscriptLine, VisibleBeatMap } from "../demo-types";
import { TerminalLine } from "../shared/terminal-line";

type JoinSpaceStageProps = {
	joinSpaceLines: readonly DemoTranscriptLine[];
	visibleBeatMap: VisibleBeatMap;
};

export function JoinSpaceStage({
	joinSpaceLines,
	visibleBeatMap,
}: JoinSpaceStageProps) {
	const visibleLines = joinSpaceLines.filter(
		(line) => visibleBeatMap[line.id] === true
	);

	if (visibleLines.length === 0) {
		return null;
	}

	return (
		<section className="space-y-1 pt-0">
			{visibleLines.map((line, index) => (
				<TerminalLine
					key={line.id}
					prefix={index === 0 ? "#" : "→"}
					prefixTone={index === 0 ? "muted" : "success"}
					text={line.text}
					variant={index === 0 ? "label" : "default"}
				/>
			))}
		</section>
	);
}
