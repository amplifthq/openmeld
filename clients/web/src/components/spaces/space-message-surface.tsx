import { cn } from "@openmeld/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";
import { BubbleContent } from "./primitives/bubble";
import { SPACE_MESSAGE_CONTENT_PADDING_CLASS } from "./space-message-bubble-style";

/** One message/action target, with attachments outside the painted text bubble. */
export function SpaceMessageSurface({
	attachments,
	bubbleClassName,
	children,
	className,
	...props
}: ComponentProps<typeof BubbleContent> & {
	attachments?: ReactNode;
	bubbleClassName?: string;
	"data-highlighted"?: string;
}) {
	return (
		<BubbleContent
			{...props}
			className={cn(
				"flex w-full flex-col gap-2 border-0 p-0 sm:px-0",
				className
			)}
		>
			{attachments}
			<div
				className={cn(
					"flex w-fit min-w-0 max-w-full flex-col gap-2 empty:hidden has-[[data-has-attachments=true]]:w-full group-data-[align=end]/bubble:self-end",
					SPACE_MESSAGE_CONTENT_PADDING_CLASS,
					bubbleClassName
				)}
				data-highlighted={props["data-highlighted"]}
				data-slot="space-message-text-surface"
			>
				{children}
			</div>
		</BubbleContent>
	);
}
