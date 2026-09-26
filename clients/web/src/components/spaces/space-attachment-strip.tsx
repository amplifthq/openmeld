import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode } from "react";

/** Shared geometry for draft, pending, delivered, and legacy attachments. */
export const SPACE_ATTACHMENT_FRAME_CLASS =
	"relative size-[var(--space-attachment-size,6rem)] shrink-0 overflow-hidden rounded-lg";
export const SPACE_ATTACHMENT_FILE_CLASS =
	"relative flex h-[var(--space-attachment-size,6rem)] w-48 shrink-0 items-center gap-2 overflow-hidden rounded-lg border border-border bg-background px-3 text-left";

export function SpaceAttachmentStrip(input: {
	children: ReactNode;
	label: string;
	size?: "composer" | "message";
	align?: "start" | "end";
	className?: string;
}) {
	return (
		<fieldset
			aria-label={input.label}
			className={cn(
				"m-0 w-full min-w-0 max-w-full border-0 p-0",
				input.size === "composer"
					? "[--space-attachment-size:4rem]"
					: "[--space-attachment-size:6rem]",
				input.className
			)}
			data-slot="space-attachment-strip"
		>
			<ScrollArea
				contentClassName={cn(
					"space-attachment-strip-items flex w-max min-w-full flex-nowrap items-start gap-2 p-1",
					input.align === "end" && "justify-end"
				)}
				orientation="horizontal"
				scrollFade
				viewportClassName="overscroll-x-contain"
				viewportProps={{ "aria-label": `${input.label} scroll area` }}
			>
				{input.children}
			</ScrollArea>
		</fieldset>
	);
}
