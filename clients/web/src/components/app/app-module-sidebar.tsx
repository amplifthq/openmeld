"use client";

import {
	Sidebar,
	SidebarContent,
	SidebarTrigger,
} from "@openmeld/ui/fluid/sidebar";
import {
	type SidebarGeometry,
	SidebarProvider,
	useSidebar,
} from "@openmeld/ui/fluid/sidebar-state";
import { SidebarSimpleIcon } from "@phosphor-icons/react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useState,
} from "react";
import { useDesktopTitlebar } from "#/desktop/titlebar-context";
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
	const desktop = useDesktopTitlebar();
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
				keyboardShortcuts={!desktop}
				onGeometryChange={onGeometryChange}
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
	const desktop = useDesktopTitlebar();
	return available && !desktop ? (
		<SidebarTrigger className="hidden size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted lg:inline-flex" />
	) : null;
}

export function AppModuleSidebar(input: {
	children: ReactNode;
	label: string;
	scrollKey: string;
}) {
	const { presentation } = useAppNavigationPresentation();
	const desktop = useDesktopTitlebar();
	const { isPeeking } = useSidebar();
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
			className="h-full border-border border-r bg-sidebar text-sidebar-foreground [&_[data-sidebar=panel]]:bg-sidebar [&_[data-sidebar=restore]]:hidden [&_[data-sidebar=reveal]]:w-8"
			data-testid="app-module-sidebar"
		>
			{isPeeking && !desktop && (
				<div className="flex shrink-0 justify-end px-3 pt-3">
					<SidebarTrigger className="flex h-7 items-center gap-2 rounded-md px-2 text-muted-foreground text-xs hover:bg-muted hover:text-foreground">
						<SidebarSimpleIcon aria-hidden="true" className="size-4" />
						Expand sidebar
					</SidebarTrigger>
				</div>
			)}
			{content}
		</Sidebar>
	);
}
