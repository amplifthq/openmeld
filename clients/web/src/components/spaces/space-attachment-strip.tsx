import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { cn } from "@openmeld/ui/lib/utils";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

/** Shared geometry for draft, pending, delivered, and legacy attachments. */
export const SPACE_ATTACHMENT_FRAME_CLASS =
	"relative size-[var(--space-attachment-size,6rem)] shrink-0 overflow-hidden rounded-lg border border-border";
export const SPACE_ATTACHMENT_FILE_CLASS =
	"relative flex h-[var(--space-attachment-size,6rem)] w-48 shrink-0 items-center gap-2 overflow-hidden rounded-lg border border-border bg-background px-3 text-left";

export function SpaceAttachmentStrip(input: {
	children: ReactNode;
	label: string;
	size?: "composer" | "message";
	align?: "start" | "end";
	className?: string;
	matchTextWidth?: boolean;
}) {
	const stripRef = useRef<HTMLFieldSetElement>(null);
	const [textWidth, setTextWidth] = useState<number | null>(null);
	useLayoutEffect(() => {
		if (!input.matchTextWidth) {
			return;
		}
		const textSurface =
			stripRef.current?.parentElement?.querySelector<HTMLElement>(
				"[data-slot='space-message-text-surface']"
			);
		if (!textSurface) {
			return;
		}
		const measure = () =>
			setTextWidth(textSurface.getBoundingClientRect().width);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(textSurface);
		return () => observer.disconnect();
	}, [input.matchTextWidth]);
	return (
		<fieldset
			aria-label={input.label}
			className={cn(
				"m-0 w-full min-w-0 max-w-full border-0 p-0",
				input.size === "composer"
					? "[--space-attachment-size:4rem]"
					: "max-w-[calc(100%-2rem)] [--space-attachment-size:6rem]",
				input.align === "end" && input.size !== "composer" && "ml-auto",
				input.className
			)}
			data-slot="space-attachment-strip"
			ref={stripRef}
			style={
				input.matchTextWidth && textWidth !== null
					? { maxWidth: textWidth }
					: undefined
			}
		>
			<ScrollArea
				contentClassName={cn(
					"space-attachment-strip-items flex w-full min-w-max flex-nowrap items-start gap-2 p-1",
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
