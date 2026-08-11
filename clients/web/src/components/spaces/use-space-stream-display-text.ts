import { useEffect, useState } from "react";
import {
	advanceSpaceStreamDisplayText,
	SPACE_STREAM_DISPLAY_INTERVAL_MS,
} from "./space-stream-display";

type SpaceStreamDisplayState = {
	streamId: string | null;
	text: string;
};

export function useSpaceStreamDisplayText(input: {
	enabled: boolean;
	streamId: string | null;
	text: string;
}): string {
	const [displayState, setDisplayState] = useState<SpaceStreamDisplayState>(
		() => ({
			streamId: input.streamId,
			text: input.text,
		})
	);
	const canPaceCurrentText =
		input.enabled &&
		input.streamId !== null &&
		displayState.streamId === input.streamId &&
		input.text.startsWith(displayState.text);
	const displayedText = canPaceCurrentText ? displayState.text : input.text;

	useEffect(() => {
		if (
			!input.enabled ||
			input.streamId === null ||
			displayState.streamId !== input.streamId ||
			!input.text.startsWith(displayState.text)
		) {
			setDisplayState((current) =>
				current.streamId === input.streamId && current.text === input.text
					? current
					: { streamId: input.streamId, text: input.text }
			);
			return;
		}
		if (displayState.text === input.text) {
			return;
		}

		const timerId = window.setTimeout(() => {
			setDisplayState((current) => {
				if (
					current.streamId !== input.streamId ||
					!input.text.startsWith(current.text)
				) {
					return { streamId: input.streamId, text: input.text };
				}
				return {
					streamId: input.streamId,
					text: advanceSpaceStreamDisplayText({
						displayedText: current.text,
						receivedText: input.text,
					}),
				};
			});
		}, SPACE_STREAM_DISPLAY_INTERVAL_MS);

		return () => {
			window.clearTimeout(timerId);
		};
	}, [
		displayState.streamId,
		displayState.text,
		input.enabled,
		input.streamId,
		input.text,
	]);

	return displayedText;
}
