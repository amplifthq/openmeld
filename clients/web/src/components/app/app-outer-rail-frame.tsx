"use client";

import { Sidebar } from "@openmeld/ui/fluid/sidebar";
import type {
	SidebarGeometry,
	SidebarMode,
} from "@openmeld/ui/fluid/sidebar-state";
import { SidebarProvider, useSidebar } from "@openmeld/ui/fluid/sidebar-state";
import type { ReactNode } from "react";
import type { SidebarPersistedState } from "#/lib/sidebar-width-cookie";

export function AppOuterRailFrame(input: {
	ariaHidden?: boolean;
	children: ReactNode | ((mode: SidebarMode) => ReactNode);
	onGeometryChange?: (geometry: SidebarGeometry) => void;
	static?: boolean;
	state: SidebarPersistedState;
	testId?: string;
}) {
	const width =
		Number.parseFloat(input.state.width) *
		(input.state.width.endsWith("rem") ? 16 : 1);
	return (
		<SidebarProvider
			geometry={{ mode: input.state.tier, width }}
			inert={input.ariaHidden || undefined}
			onGeometryChange={input.onGeometryChange ?? (() => undefined)}
			static={input.static}
		>
			<Sidebar
				aria-hidden={input.ariaHidden || undefined}
				className="text-sidebar-foreground"
				data-slot="app-outer-rail"
				data-testid={input.testId ?? "app-outer-rail"}
			>
				<SidebarContents>{input.children}</SidebarContents>
			</Sidebar>
		</SidebarProvider>
	);
}

function SidebarContents({
	children,
}: {
	children: ReactNode | ((mode: SidebarMode) => ReactNode);
}) {
	const { state } = useSidebar();
	return typeof children === "function" ? children(state) : children;
}
