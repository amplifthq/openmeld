import { cn } from "@openmeld/ui/lib/utils";
import type { ComponentProps } from "react";

/** An inset surface tucked behind the composer; the composer covers its foot. */
export function SpaceComposerTray({
	className,
	...props
}: ComponentProps<"section">) {
	return (
		<section
			className={cn(
				"relative mx-3 -mb-4 min-w-0 shrink-0 rounded-2xl border border-border bg-card pb-4 sm:mx-4",
				className
			)}
			{...props}
		/>
	);
}
