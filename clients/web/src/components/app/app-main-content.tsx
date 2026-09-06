import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode } from "react";

export function AppMainContent(input: {
	children: ReactNode;
	className?: string;
	bodyClassName?: string;
	bodySlotName?: string;
	header?: ReactNode;
	headerClassName?: string;
	headerSlotName?: string;
	showHeader?: boolean;
	scroll?: boolean;
}) {
	const hasHeaderContent = input.header !== undefined && input.header !== null;
	const showHeader = input.showHeader ?? true;

	return (
		<section
			className={cn(
				"flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background",
				input.className
			)}
			data-slot="app-main-content"
		>
			{showHeader ? (
				<header
					aria-hidden={hasHeaderContent ? undefined : true}
					className={cn(
						"@container/app-main-header h-[var(--space-conversation-header-height)] shrink-0 border-border border-b bg-background",
						input.headerClassName
					)}
					data-slot={input.headerSlotName ?? "app-main-content-header"}
				>
					{input.header ?? null}
				</header>
			) : null}
			{input.scroll ? (
				<ScrollArea
					className="min-h-0 flex-1"
					contentClassName={input.bodyClassName}
					data-slot={input.bodySlotName ?? "app-main-content-body"}
				>
					{input.children}
				</ScrollArea>
			) : (
				<div
					className={cn(
						"min-h-0 flex-1",
						"overflow-hidden",
						input.bodyClassName
					)}
					data-slot={input.bodySlotName ?? "app-main-content-body"}
				>
					{input.children}
				</div>
			)}
		</section>
	);
}
