export const SPACE_STREAM_DISPLAY_INTERVAL_MS = 20;

const MAX_SEGMENTS_PER_TICK = 4;
const TARGET_BACKLOG_TICKS = 12;
const WORD_SEGMENTER = new Intl.Segmenter(undefined, {
	granularity: "word",
});

export function advanceSpaceStreamDisplayText(input: {
	displayedText: string;
	receivedText: string;
}): string {
	if (
		input.displayedText === input.receivedText ||
		!input.receivedText.startsWith(input.displayedText)
	) {
		return input.receivedText;
	}

	const pendingText = input.receivedText.slice(input.displayedText.length);
	const pendingSegments = splitReadableSegments(pendingText);
	const segmentCount = Math.min(
		MAX_SEGMENTS_PER_TICK,
		Math.max(1, Math.ceil(pendingSegments.length / TARGET_BACKLOG_TICKS))
	);

	return input.displayedText + pendingSegments.slice(0, segmentCount).join("");
}

function splitReadableSegments(text: string): string[] {
	const segments: string[] = [];
	let currentSegment = "";
	let currentSegmentHasWord = false;

	for (const part of WORD_SEGMENTER.segment(text)) {
		if (part.isWordLike && currentSegmentHasWord) {
			segments.push(currentSegment);
			currentSegment = "";
		}
		currentSegment += part.segment;
		currentSegmentHasWord ||= part.isWordLike === true;
	}

	if (currentSegment.length > 0) {
		segments.push(currentSegment);
	}

	return segments;
}
