"use client";

import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode } from "react";
import {
	AppGlobalControls,
	type AppGlobalControlsProps,
} from "#/components/app/app-global-controls";
import { AppInnerSidebar } from "#/components/app/app-inner-sidebar";
import { AppMainContent } from "#/components/app/app-main-content";
import { AppOuterRail } from "#/components/app/app-outer-rail";
import { useAppShellAccount } from "#/components/app/app-shell-account";
import { AppSurfaceLayout } from "#/components/app/app-surface-layout";
import type {
	InnerSidebarPreferenceKey,
	SidebarPersistedState,
} from "#/lib/sidebar-width-cookie";

export function AppFullWidthLayout(input: {
	children: ReactNode;
	contentLayout?: "centered" | "flush";
	globalControls?: AppGlobalControlsProps;
	initialInnerSidebarState?: SidebarPersistedState;
	initialOuterSidebarState?: SidebarPersistedState;
	mobileSidebarTitle?: string;
	sidebar?: ReactNode;
	sidebarPreferenceKey?: InnerSidebarPreferenceKey;
	sidebarSeparatorLabel?: string;
}) {
	const account = useAppShellAccount();
	if (input.sidebar && !input.sidebarPreferenceKey) {
		throw new Error(
			"A sidebarPreferenceKey is required when sidebar is present."
		);
	}
	return (
		<AppSurfaceLayout
			frameSlotName="app-full-width-layout"
			globalControls={<AppGlobalControls {...input.globalControls} />}
			mobileSidebarTitle={input.mobileSidebarTitle}
			outerRail={
				<AppOuterRail
					account={account}
					initialState={input.initialOuterSidebarState}
				/>
			}
			sidebar={
				input.sidebar && input.sidebarPreferenceKey ? (
					<AppInnerSidebar
						initialState={input.initialInnerSidebarState}
						preferenceKey={input.sidebarPreferenceKey}
						separatorLabel={input.sidebarSeparatorLabel ?? "Resize the sidebar"}
					>
						{input.sidebar}
					</AppInnerSidebar>
				) : undefined
			}
		>
			<AppMainContent
				bodySlotName="app-full-width-content-scroll"
				scroll
				showHeader={false}
			>
				<div
					className={cn(
						"flex w-full flex-col",
						input.contentLayout === "flush"
							? "min-h-full"
							: "mx-auto max-w-7xl gap-4 px-4 pt-8 pb-6 sm:px-6 lg:px-8"
					)}
					data-slot="app-full-width-content"
				>
					{input.children}
				</div>
			</AppMainContent>
		</AppSurfaceLayout>
	);
}
