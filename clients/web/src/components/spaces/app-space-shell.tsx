"use client";

import type { ReactNode } from "react";
import { AppGlobalControls } from "#/components/app/app-global-controls";
import { AppOuterRail } from "#/components/app/app-outer-rail";
import { useAppShellAccount } from "#/components/app/app-shell-account";
import { AppSurfaceLayout } from "#/components/app/app-surface-layout";
import { ConversationsSidebar } from "#/components/spaces/conversations-sidebar";
import { SpaceWakeProgressVisibleProjectionProvider } from "#/components/spaces/space-wake-progress-visible-projection";
import type {
	InnerSidebarPreferenceKey,
	SidebarPersistedState,
} from "#/lib/sidebar-width-cookie";

export function SpaceWindowShell(input: {
	children: ReactNode;
	defaultModuleSidebarOpen?: boolean;
	sidebar?: ReactNode;
	initialOuterSidebarState?: SidebarPersistedState;
	/** SSR-resolved persisted sidebar state (no first-paint flash). */
	initialSidebarState?: SidebarPersistedState;
	sidebarSeparatorLabel?: string;
	sidebarPreferenceKey: InnerSidebarPreferenceKey;
}) {
	const account = useAppShellAccount();
	return (
		<SpaceWindowFrame
			defaultModuleSidebarOpen={input.defaultModuleSidebarOpen ?? true}
			initialSidebarState={input.initialOuterSidebarState}
			navigation={input.sidebar}
			outerRail={<AppOuterRail account={account} />}
		>
			{input.children}
		</SpaceWindowFrame>
	);
}

export function SpaceWindowFrame(input: {
	children: ReactNode;
	defaultModuleSidebarOpen?: boolean;
	outerRail: ReactNode;
	navigation?: ReactNode;
	initialSidebarState?: SidebarPersistedState;
}) {
	return (
		<AppSurfaceLayout
			defaultModuleSidebarOpen={input.defaultModuleSidebarOpen}
			frameSlotName="space-window-frame"
			globalControls={<AppGlobalControls />}
			initialModuleSidebarState={input.initialSidebarState}
			moduleNavigation={input.navigation}
			moduleNavigationLabel="Spaces"
			outerRail={input.outerRail}
			testId="space-window-frame"
		>
			<section className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
				{input.children}
			</section>
		</AppSurfaceLayout>
	);
}

type AppSpaceShellBaseProps = {
	children: ReactNode;
	defaultModuleSidebarOpen?: boolean;
	initialOuterSidebarState?: SidebarPersistedState;
	initialSidebarState?: SidebarPersistedState;
};

type AppSpaceShellProps = AppSpaceShellBaseProps &
	(
		| {
				browseSpacesActive?: boolean;
				currentProfileId: string;
				currentSpaceId: string;
				showSpacesSidebar?: boolean;
		  }
		| {
				currentProfileId?: never;
				currentSpaceId?: never;
				showSpacesSidebar: false;
		  }
	);

export function AppSpaceShell(input: AppSpaceShellProps) {
	return (
		<SpaceWakeProgressVisibleProjectionProvider
			profileId={input.currentProfileId}
			spaceId={input.currentSpaceId}
		>
			<SpaceWindowShell
				defaultModuleSidebarOpen={
					input.defaultModuleSidebarOpen ?? !!input.currentSpaceId
				}
				initialOuterSidebarState={input.initialOuterSidebarState}
				initialSidebarState={input.initialSidebarState}
				sidebar={
					input.showSpacesSidebar === false ? undefined : (
						<ConversationsSidebar
							currentProfileId={input.currentProfileId}
							currentSpaceId={input.currentSpaceId}
							hideAccountSpacesFailure={input.browseSpacesActive}
						/>
					)
				}
				sidebarPreferenceKey="spaces"
				sidebarSeparatorLabel="Resize the Spaces sidebar"
			>
				{input.children}
			</SpaceWindowShell>
		</SpaceWakeProgressVisibleProjectionProvider>
	);
}

export function AppDirectMessageShell(input: {
	children: ReactNode;
	currentProfileId: string;
	currentSpaceId: string;
	initialOuterSidebarState?: SidebarPersistedState;
	initialSidebarState?: SidebarPersistedState;
}) {
	return (
		<SpaceWindowShell
			initialOuterSidebarState={input.initialOuterSidebarState}
			initialSidebarState={input.initialSidebarState}
			sidebar={
				<ConversationsSidebar
					currentProfileId={input.currentProfileId}
					currentSpaceId={input.currentSpaceId}
				/>
			}
			sidebarPreferenceKey="direct-messages"
			sidebarSeparatorLabel="Resize the conversations sidebar"
		>
			{input.children}
		</SpaceWindowShell>
	);
}
