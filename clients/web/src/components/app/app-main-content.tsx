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
						"h-[var(--space-conversation-header-height)] shrink-0 border-border border-b bg-background",
						input.headerClassName
					)}
					data-slot={input.headerSlotName ?? "app-main-content-header"}
				>
					{input.header ?? null}
				</header>
			) : null}
			<div
				className={cn(
					"min-h-0 flex-1",
					input.scroll ? "overflow-y-auto" : "overflow-hidden",
					input.bodyClassName
				)}
				data-slot={input.bodySlotName ?? "app-main-content-body"}
			>
				{input.children}
			</div>
		</section>
	);
}
