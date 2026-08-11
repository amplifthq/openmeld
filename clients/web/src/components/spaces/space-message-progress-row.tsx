import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode } from "react";
import { SPACE_MESSAGE_SURFACE_WIDTH_CLASS } from "./space-message-bubble-style";

export function SpaceMessageProgressRow(input: {
	align?: "start" | "end";
	children: ReactNode;
	control?: ReactNode;
	slot: string;
	testId?: string;
	verticalAlign?: "center" | "start";
}) {
	const isEndAligned = input.align === "end";

	return (
		<div
			className={cn(
				"flex w-full min-w-0 gap-3",
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
					"min-w-0 flex-[0_1_auto]",
					isEndAligned ? "flex justify-end text-right" : null
				)}
				data-align={input.align ?? "start"}
				data-slot="space-message-progress-content"
			>
				{input.children}
			</div>
			<div
				className={cn(
					"flex min-h-6 w-20 shrink-0 items-center",
					isEndAligned ? "justify-end" : "justify-start"
				)}
				data-slot="space-message-progress-control"
				data-testid="space-message-progress-control-slot"
			>
				{input.control}
			</div>
		</div>
	);
}
