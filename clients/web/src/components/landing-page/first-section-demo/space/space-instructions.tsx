import type { DemoTranscriptLine, VisibleBeatMap } from "../demo-types";

type SpaceInstructionsProps = {
	instructions: readonly DemoTranscriptLine[];
	visibleBeatMap: VisibleBeatMap;
};

export function SpaceInstructions({
	instructions,
	visibleBeatMap,
}: SpaceInstructionsProps) {
	const visibleInstructions = instructions.filter(
		(line) => visibleBeatMap[line.id] === true
	);

	if (visibleInstructions.length === 0) {
		return null;
	}

	return (
		<section className="space-y-1.5 pt-8 font-mono text-[0.88rem] leading-[1.65] sm:pt-10 sm:text-[0.94rem]">
			{visibleInstructions.map((line) => (
				<p className="text-muted-foreground" key={line.id}>
					{line.text}
				</p>
			))}
		</section>
	);
}
