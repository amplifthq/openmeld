"use client";

import type { ReactNode } from "react";
import { AppGlobalControls } from "#/components/app/app-global-controls";
import { AppInnerSidebar } from "#/components/app/app-inner-sidebar";
import { AppOuterRail } from "#/components/app/app-outer-rail";
import { useAppShellAccount } from "#/components/app/app-shell-account";
import { AppSurfaceLayout } from "#/components/app/app-surface-layout";
import { AppDirectMessagesSidebar } from "#/components/spaces/app-direct-messages-sidebar";
import { AppSpacesSidebar } from "#/components/spaces/app-spaces-sidebar";
import { SpaceWakeProgressVisibleProjectionProvider } from "#/components/spaces/space-wake-progress-visible-projection";
import type {
	InnerSidebarPreferenceKey,
	SidebarPersistedState,
} from "#/lib/sidebar-width-cookie";

export function SpaceWindowShell(input: {
	children: ReactNode;
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
			initialSidebarState={input.initialSidebarState}
			outerRail={
				<AppOuterRail
					account={account}
					initialState={input.initialOuterSidebarState}
				/>
			}
			sidebar={input.sidebar}
			sidebarPreferenceKey={input.sidebarPreferenceKey}
			sidebarSeparatorLabel={input.sidebarSeparatorLabel}
		>
			{input.children}
		</SpaceWindowFrame>
	);
}

export function SpaceWindowFrame(input: {
	children: ReactNode;
	initialSidebarState?: SidebarPersistedState;
	outerRail: ReactNode;
	sidebar?: ReactNode;
	sidebarPreferenceKey: InnerSidebarPreferenceKey;
	sidebarSeparatorLabel?: string;
}) {
	return (
		<AppSurfaceLayout
			frameSlotName="space-window-frame"
			globalControls={<AppGlobalControls />}
			mobileSidebarTitle={resolveSpaceWindowSidebarTitle(
				input.sidebarPreferenceKey
			)}
			outerRail={input.outerRail}
			sidebar={
				input.sidebar ? (
					<AppInnerSidebar
						initialState={input.initialSidebarState}
						preferenceKey={input.sidebarPreferenceKey}
						separatorLabel={input.sidebarSeparatorLabel ?? "Resize the sidebar"}
					>
						{input.sidebar}
					</AppInnerSidebar>
				) : undefined
			}
			testId="space-window-frame"
		>
			<section className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
				{input.children}
			</section>
		</AppSurfaceLayout>
	);
}

function resolveSpaceWindowSidebarTitle(
	preferenceKey: InnerSidebarPreferenceKey
): string {
	if (preferenceKey === "spaces") {
		return "Spaces";
	}
	if (preferenceKey === "direct-messages") {
		return "Direct Messages";
	}
	throw new Error(
		`Unsupported Space window sidebar preference: ${preferenceKey}`
	);
}

type AppSpaceShellBaseProps = {
	children: ReactNode;
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
			key={`${input.currentProfileId ?? ""}:${input.currentSpaceId ?? ""}`}
		>
			<SpaceWindowShell
				initialOuterSidebarState={input.initialOuterSidebarState}
				initialSidebarState={input.initialSidebarState}
				sidebar={
					input.showSpacesSidebar === false ? undefined : (
						<AppSpacesSidebar
							browseSpacesActive={input.browseSpacesActive}
							currentProfileId={input.currentProfileId}
							currentSpaceId={input.currentSpaceId}
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
				<AppDirectMessagesSidebar
					currentProfileId={input.currentProfileId}
					currentSpaceId={input.currentSpaceId}
				/>
			}
			sidebarPreferenceKey="direct-messages"
			sidebarSeparatorLabel="Resize the Direct Messages sidebar"
		>
			{input.children}
		</SpaceWindowShell>
	);
}
