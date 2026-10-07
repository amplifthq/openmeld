import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode } from "react";
import { SPACE_MESSAGE_SURFACE_WIDTH_CLASS } from "./space-message-bubble-style";

export function SpaceMessageProgressRow(input: {
	align?: "start" | "end";
	children: ReactNode;
	compact?: boolean;
	fill?: boolean;
	control?: ReactNode;
	slot: string;
	testId?: string;
	verticalAlign?: "center" | "start";
}) {
	const isEndAligned = input.align === "end";

	return (
		<div
			className={cn(
				"flex w-full min-w-0",
				input.compact ? "gap-2" : "gap-3",
				isEndAligned ? "justify-end" : "justify-start",
				input.verticalAlign === "start" ? "items-start" : "items-center",
				SPACE_MESSAGE_SURFACE_WIDTH_CLASS
			)}
			data-align={input.align ?? "start"}
			data-slot={input.slot}
			data-testid={input.testId}
		>
			<div
				className={cn(
					"min-w-0",
					input.fill ? "flex-1" : "flex-[0_1_auto]",
					isEndAligned ? "flex justify-end text-right" : null
				)}
				data-align={input.align ?? "start"}
				data-slot="space-message-progress-content"
			>
				{input.children}
			</div>
			{input.control != null || !input.compact ? (
				<div
					className={cn(
						"flex min-h-6 shrink-0 items-center",
						input.compact ? null : "min-w-20",
						isEndAligned ? "justify-end" : "justify-start"
					)}
					data-slot="space-message-progress-control"
					data-testid="space-message-progress-control-slot"
				>
					{input.control}
				</div>
			) : null}
		</div>
	);
}
