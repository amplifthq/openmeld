"use client";

import type { ReactNode } from "react";
import {
	AppGlobalControls,
	type AppGlobalControlsProps,
} from "#/components/app/app-global-controls";
import { AppMainContent } from "#/components/app/app-main-content";
import { AppOuterRail } from "#/components/app/app-outer-rail";
import { useAppShellAccount } from "#/components/app/app-shell-account";
import { AppSurfaceLayout } from "#/components/app/app-surface-layout";
import { useSettingsAttentionTone } from "#/components/app/use-settings-attention-tone";
import type { SidebarPersistedState } from "#/lib/sidebar-width-cookie";

export function AppFullWidthLayout(input: {
	children: ReactNode;
	globalControls?: AppGlobalControlsProps;
	initialOuterSidebarState?: SidebarPersistedState;
}) {
	const account = useAppShellAccount();
	const computerAttentionTone = useSettingsAttentionTone();

	return (
		<AppSurfaceLayout
			frameSlotName="app-full-width-layout"
			globalControls={<AppGlobalControls {...input.globalControls} />}
			outerRail={
				<AppOuterRail
					account={account}
					computerAttentionTone={computerAttentionTone}
					initialState={input.initialOuterSidebarState}
				/>
			}
		>
			<AppMainContent
				bodySlotName="app-full-width-content-scroll"
				scroll
				showHeader={false}
			>
				<div
					className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 pt-8 pb-6 sm:px-6 lg:px-8"
					data-slot="app-full-width-content"
				>
					{input.children}
				</div>
			</AppMainContent>
		</AppSurfaceLayout>
	);
}
