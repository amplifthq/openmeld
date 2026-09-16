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
import { TeamSidebarHeader } from "#/components/directory/team-sidebar-header";
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
	mainHeader?: ReactNode;
	mainSidebarContent?: ReactNode;
	mobileSidebarTitle?: string;
	showMainHeader?: boolean;
	scroll?: boolean;
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
			initialModuleSidebarState={input.initialOuterSidebarState}
			mobileSidebarTitle={input.mobileSidebarTitle}
			moduleNavigation={
				input.mainSidebarContent ? (
					<>
						<TeamSidebarHeader />
						{input.mainSidebarContent}
					</>
				) : undefined
			}
			moduleNavigationKey="people"
			moduleNavigationLabel="Team"
			outerRail={<AppOuterRail account={account} />}
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
				bodyClassName={
					input.contentLayout === "flush" ? "flex flex-col" : undefined
				}
				bodySlotName="app-full-width-content-scroll"
				header={input.mainHeader}
				scroll={input.scroll ?? true}
				showHeader={input.showMainHeader ?? false}
			>
				<div
					className={cn(
						"flex w-full flex-col",
						input.scroll === false && "h-full min-h-0",
						input.contentLayout === "flush"
							? "min-h-full flex-1"
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
