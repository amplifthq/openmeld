import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { cn } from "@openmeld/ui/lib/utils";

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, {
	granularity: "grapheme",
});

export function CenterTruncatedText(input: {
	className?: string;
	text: string;
	title?: string;
}) {
	const [start, end] = splitTextAtCenter(input.text);

	return (
		<TooltipHint content={input.title}>
			<span
				className={cn(
					"flex min-w-0 max-w-full overflow-hidden",
					input.className
				)}
				data-slot="center-truncated-text"
			>
				<span
					className="min-w-0 shrink overflow-hidden text-ellipsis whitespace-pre"
					data-slot="center-truncated-text-start"
				>
					{start}
				</span>
				<span
					className="min-w-0 shrink overflow-hidden whitespace-pre text-right [direction:rtl]"
					data-slot="center-truncated-text-end"
				>
					<bdi className="inline-block min-w-max" dir="ltr">
						{end}
					</bdi>
				</span>
			</span>
		</TooltipHint>
	);
}

function splitTextAtCenter(text: string): readonly [string, string] {
	const graphemes = Array.from(
		GRAPHEME_SEGMENTER.segment(text),
		(part) => part.segment
	);
	let endStart = Math.ceil(graphemes.length / 2);
	while (
		endStart < graphemes.length &&
		graphemes[endStart]?.trim().length === 0
	) {
		endStart += 1;
	}

	return [
		graphemes.slice(0, endStart).join(""),
		graphemes.slice(endStart).join(""),
	];
}
