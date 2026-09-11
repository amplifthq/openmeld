"use client";

import {
	Sidebar,
	SidebarContent,
	SidebarTrigger,
} from "@openmeld/ui/fluid/sidebar";
import {
	type SidebarGeometry,
	SidebarProvider,
} from "@openmeld/ui/fluid/sidebar-state";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useState,
} from "react";
import {
	OUTER_SIDEBAR_DEFAULT_STATE,
	resolveClientSidebarInitialState,
	type SidebarPersistedState,
	writeOuterSidebarStateCookie,
} from "#/lib/sidebar-width-cookie";
import { useAppNavigationPresentation } from "./app-navigation-presentation";
import { AppSidebarGroupStateProvider } from "./app-sidebar-group";

const ModuleSidebarContext = createContext(false);
const scrollPositions = new Map<string, number>();

export function AppModuleSidebarProvider(input: {
	children: ReactNode;
	available: boolean;
	initialState?: SidebarPersistedState;
	preferenceKey: string;
}) {
	const [state, setState] = useState(() =>
		resolveClientSidebarInitialState(
			"outer",
			input.initialState ?? OUTER_SIDEBAR_DEFAULT_STATE
		)
	);
	const width = state.pageWidths?.[input.preferenceKey] ?? state.width;
	const onGeometryChange = useCallback(
		(geometry: SidebarGeometry) => {
			setState((current) => {
				const next = {
					...current,
					tier: geometry.mode === "icon" ? ("hidden" as const) : geometry.mode,
					width: `${geometry.width}px`,
					pageWidths: {
						...current.pageWidths,
						[input.preferenceKey]: `${geometry.width}px`,
					},
				};
				writeOuterSidebarStateCookie(next);
				return next;
			});
		},
		[input.preferenceKey]
	);
	return (
		<ModuleSidebarContext.Provider value={input.available}>
			<SidebarProvider
				geometry={{
					mode: state.tier === "expanded" ? "expanded" : "hidden",
					width: Number.parseFloat(width) * (width.endsWith("rem") ? 16 : 1),
				}}
				onGeometryChange={onGeometryChange}
				peekOnHover={false}
				static={!input.available}
				style={{ display: "contents" }}
			>
				<AppSidebarGroupStateProvider
					collapsedGroupIds={state.collapsedGroupIds}
					onCollapsedGroupIdsChange={(collapsedGroupIds) =>
						setState((current) => {
							const next = { ...current, collapsedGroupIds };
							writeOuterSidebarStateCookie(next);
							return next;
						})
					}
				>
					{input.children}
				</AppSidebarGroupStateProvider>
			</SidebarProvider>
		</ModuleSidebarContext.Provider>
	);
}

export function useHasModuleSidebar() {
	return useContext(ModuleSidebarContext);
}

export function AppModuleSidebarToggle() {
	const available = useContext(ModuleSidebarContext);
	return available ? (
		<SidebarTrigger className="hidden size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted lg:inline-flex" />
	) : null;
}

export function AppModuleSidebar(input: {
	children: ReactNode;
	label: string;
	scrollKey: string;
}) {
	const { presentation } = useAppNavigationPresentation();
	const restoreScroll = useCallback(
		(node: HTMLDivElement | null) => {
			if (node) {
				node.scrollTop = scrollPositions.get(input.scrollKey) ?? 0;
			}
		},
		[input.scrollKey]
	);
	const content = (
		<SidebarContent
			contentClassName="px-3 py-5"
			viewportProps={{
				onScroll: (event) =>
					scrollPositions.set(input.scrollKey, event.currentTarget.scrollTop),
			}}
			viewportRef={restoreScroll}
		>
			{input.children}
		</SidebarContent>
	);
	if (presentation === "drawer") {
		return (
			<aside
				aria-label={input.label}
				className="flex h-full min-h-0 flex-1 flex-col"
			>
				{content}
			</aside>
		);
	}
	return (
		<Sidebar
			aria-label={input.label}
			className="h-full border-border border-r bg-sidebar text-sidebar-foreground [&_[data-sidebar=panel]]:bg-sidebar [&_[data-sidebar=restore]]:left-20"
			data-testid="app-module-sidebar"
		>
			{content}
		</Sidebar>
	);
}
