import {
	Sidebar,
	SidebarProvider,
	SidebarRail,
} from "@openmeld/ui/components/sidebar";
import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode } from "react";

export function SpaceInlineSidePanel(input: {
	ariaLabel: string;
	children: ReactNode;
	className?: string;
	id: string;
	maxWidth: string;
	minWidth: string;
	onWidthChange: (width: string) => void;
	open: boolean;
	resizeHandleLabel: string;
	width: string;
}) {
	return (
		<SidebarProvider
			className={cn("h-full", input.className)}
			collapsedWidth="0rem"
			maxWidth={input.maxWidth}
			minWidth={input.minWidth}
			onWidthChange={input.onWidthChange}
			open={input.open}
			side="right"
			width={input.width}
		>
			<Sidebar
				aria-hidden={!input.open}
				aria-label={input.ariaLabel}
				className={cn(
					"h-full overflow-hidden bg-background text-foreground transition-none",
					input.open ? "border-l" : "border-l-0"
				)}
				id={input.id}
				side="right"
				style={{
					width: input.open
						? "min(var(--sidebar-width), 100vw)"
						: "var(--sidebar-width-icon)",
				}}
			>
				{input.open ? (
					<>
						<div className="flex h-full min-h-0 min-w-0 flex-col">
							{input.children}
						</div>
						<SidebarRail
							className="hidden transition-colors motion-reduce:transition-none lg:block"
							enableToggle={false}
							nested
							separatorLabel={input.resizeHandleLabel}
						/>
					</>
				) : null}
			</Sidebar>
		</SidebarProvider>
	);
}
