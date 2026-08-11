"use client";

import {
	Sidebar,
	SidebarHeader,
	SidebarProvider,
	SidebarRail,
} from "@openmeld/ui/components/sidebar";
import { type ReactNode, useCallback, useState } from "react";
import {
	type InnerSidebarPreferenceKey,
	resolveClientInnerSidebarInitialState,
	SIDEBAR_DEFAULT_STATE,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	type SidebarPersistedState,
	writeInnerSidebarStateCookie,
} from "#/lib/sidebar-width-cookie";
import { CenterTruncatedText } from "./center-truncated-text";

type AppInnerSidebarProps = {
	children: ReactNode;
	initialState?: SidebarPersistedState;
	preferenceKey: InnerSidebarPreferenceKey;
	separatorLabel: string;
};

export function AppInnerSidebar(input: AppInnerSidebarProps) {
	return <AppInnerSidebarState key={input.preferenceKey} {...input} />;
}

function AppInnerSidebarState(input: AppInnerSidebarProps) {
	const [state, setState] = useState<SidebarPersistedState>(() =>
		resolveClientInnerSidebarInitialState(
			input.preferenceKey,
			input.initialState ?? SIDEBAR_DEFAULT_STATE
		)
	);

	const handleWidthChange = useCallback(
		(width: string) => {
			setState((current) => {
				const next = { ...current, width };
				writeInnerSidebarStateCookie(input.preferenceKey, next);
				return next;
			});
		},
		[input.preferenceKey]
	);

	return (
		<SidebarProvider
			maxWidth={SIDEBAR_MAX_WIDTH}
			minWidth={SIDEBAR_MIN_WIDTH}
			onWidthChange={handleWidthChange}
			open
			side="left"
			width={state.width}
		>
			<Sidebar className="bg-background">
				{input.children}
				<SidebarRail
					enableToggle={false}
					nested
					separatorLabel={input.separatorLabel}
				/>
			</Sidebar>
		</SidebarProvider>
	);
}

export function AppInnerSidebarHeader(input: { title: string }) {
	return (
		<SidebarHeader className="h-[var(--space-conversation-header-height)] justify-center overflow-hidden border-border border-b px-3 py-0">
			<h2
				aria-label={input.title}
				className="min-w-0 font-medium text-foreground text-xs"
			>
				<CenterTruncatedText text={input.title} />
			</h2>
		</SidebarHeader>
	);
}
