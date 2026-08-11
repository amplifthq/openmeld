"use client";

import { Sidebar, SidebarProvider } from "@openmeld/ui/components/sidebar";
import type { ReactNode } from "react";
import {
	OUTER_SIDEBAR_COMPACT_WIDTH,
	OUTER_SIDEBAR_MAX_WIDTH,
	OUTER_SIDEBAR_MIN_WIDTH,
	type SidebarPersistedState,
} from "#/lib/sidebar-width-cookie";

const APP_OUTER_RAIL_COLLAPSED_WIDTH = "3.25rem";

export function AppOuterRailFrame(input: {
	ariaHidden?: boolean;
	children: ReactNode;
	onCompactChange?: (compact: boolean) => void;
	onOpenChange?: (open: boolean) => void;
	onWidthChange?: (width: string) => void;
	state: SidebarPersistedState;
	testId?: string;
}) {
	return (
		<SidebarProvider
			collapsedWidth={APP_OUTER_RAIL_COLLAPSED_WIDTH}
			compact={input.state.tier === "compact"}
			compactWidth={OUTER_SIDEBAR_COMPACT_WIDTH}
			maxWidth={OUTER_SIDEBAR_MAX_WIDTH}
			minWidth={OUTER_SIDEBAR_MIN_WIDTH}
			onCompactChange={input.onCompactChange}
			onOpenChange={input.onOpenChange}
			onWidthChange={input.onWidthChange}
			open={input.state.tier !== "collapsed"}
			side="left"
			width={input.state.width}
		>
			<Sidebar
				aria-hidden={input.ariaHidden || undefined}
				className="border-r-0 bg-transparent text-sidebar-foreground"
				data-slot="app-outer-rail"
				data-testid={input.testId ?? "app-outer-rail"}
			>
				{input.children}
			</Sidebar>
		</SidebarProvider>
	);
}
