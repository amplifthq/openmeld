import {
	ThinkingSteps,
	ThinkingStepsContent,
	ThinkingStepsHeader,
} from "@openmeld/ui/fluid/thinking-steps";
import { useLayoutEffect, useRef } from "react";
import { AnimatedMobiusIcon } from "./animated-mobius-icon";

const THINKING_PREVIEW_MAX_CHARS = 180;

export function SpaceAgentThinking(input: { thinking: string }) {
	const viewportRef = useRef<HTMLOutputElement>(null);
	const preview = buildThinkingPreview(input.thinking);

	useLayoutEffect(() => {
		if (input.thinking.length === 0) {
			return;
		}
		const viewport = viewportRef.current;
		if (viewport) {
			viewport.scrollTop = viewport.scrollHeight;
		}
	}, [input.thinking]);

	if (!preview) {
		return null;
	}

	return (
		<ThinkingSteps className="w-full max-w-full" defaultOpen={false}>
			<ThinkingStepsHeader
				active
				aria-label={`Thinking… ${preview}`}
				className="w-full px-0 hover:bg-transparent"
				summary={preview}
			>
				<span className="flex items-center gap-1.5">
					<AnimatedMobiusIcon />
					<span>Thinking…</span>
				</span>
			</ThinkingStepsHeader>
			<ThinkingStepsContent className="pb-1">
				<output
					aria-live="polite"
					className="block max-h-[min(12rem,30dvh)] w-full overflow-y-auto whitespace-pre-wrap py-1 text-muted-foreground text-xs leading-5"
					ref={viewportRef}
				>
					{input.thinking}
				</output>
			</ThinkingStepsContent>
		</ThinkingSteps>
	);
}

function buildThinkingPreview(thinking: string): string {
	const normalized = thinking.trim();
	if (!normalized) {
		return "";
	}
	const latestLine =
		normalized
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.at(-1) ?? normalized;
	return latestLine.length <= THINKING_PREVIEW_MAX_CHARS
		? latestLine
		: `…${latestLine.slice(-THINKING_PREVIEW_MAX_CHARS)}`;
}
