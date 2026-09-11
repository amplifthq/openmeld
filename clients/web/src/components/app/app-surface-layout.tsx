"use client";

import { ListIcon, SidebarSimpleIcon } from "@phosphor-icons/react";
import { type ReactNode, useRef, useState } from "react";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import type { SidebarPersistedState } from "#/lib/sidebar-width-cookie";
import { AppMobileNavigationDrawer } from "./app-mobile-navigation";
import {
	AppModuleSidebar,
	AppModuleSidebarProvider,
} from "./app-module-sidebar";
import { AppNavigationPresentationProvider } from "./app-navigation-presentation";

export function AppSurfaceLayout(input: {
	ariaBusy?: boolean;
	children: ReactNode;
	frameSlotName?: string;
	globalControls: ReactNode;
	mobileSidebarTitle?: string;
	outerRail: ReactNode;
	moduleNavigation?: ReactNode;
	moduleNavigationLabel?: string;
	moduleNavigationKey?: string;
	initialModuleSidebarState?: SidebarPersistedState;
	sidebar?: ReactNode;
	testId?: string;
}) {
	const organization = useOptionalAppOrganization();
	const navigationScope = `${organization?.currentUserId ?? ""}:${organization?.currentOrganization.id ?? ""}:${input.moduleNavigationKey ?? "conversations"}`;
	const [appNavigationOpen, setAppNavigationOpen] = useState(false);
	const [contextualNavigationOpen, setContextualNavigationOpen] =
		useState(false);
	const appNavigationTriggerRef = useRef<HTMLButtonElement>(null);
	const contextualNavigationTriggerRef = useRef<HTMLButtonElement>(null);
	const openAppNavigation = () => {
		setContextualNavigationOpen(false);
		setAppNavigationOpen(true);
	};
	const openContextualNavigation = () => {
		setAppNavigationOpen(false);
		setContextualNavigationOpen(true);
	};
	const sidebar = input.moduleNavigation ? (
		<AppModuleSidebar
			label={input.moduleNavigationLabel ?? "Messenger"}
			scrollKey={navigationScope}
		>
			{input.moduleNavigation}
		</AppModuleSidebar>
	) : (
		input.sidebar
	);
	const sidebarTitle = input.moduleNavigation
		? (input.moduleNavigationLabel ?? "Messenger")
		: input.mobileSidebarTitle;

	// The module geometry provider also owns header toggles, leaving the work
	// area's React tree mounted while the contextual list collapses.
	return (
		<AppModuleSidebarProvider
			available={!!input.moduleNavigation}
			initialState={input.initialModuleSidebarState}
			preferenceKey={input.moduleNavigationKey ?? "conversations"}
		>
			<div
				aria-busy={input.ariaBusy || undefined}
				className="group/app-surface relative flex h-dvh w-full overflow-hidden bg-[var(--app-canvas)] text-foreground [--app-toolbar-height:3rem]"
				data-slot={input.frameSlotName ?? "app-surface-layout"}
				data-testid={input.testId}
			>
				<div className="hidden lg:contents" data-slot="app-inline-navigation">
					<AppNavigationPresentationProvider presentation="inline">
						{input.outerRail}
					</AppNavigationPresentationProvider>
				</div>
				<div
					className="relative flex min-h-0 min-w-0 flex-1"
					data-slot="app-content-column"
				>
					<div
						className="relative mb-[calc(3.5rem+env(safe-area-inset-bottom))] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background transition-[margin-bottom] duration-180 ease-out motion-reduce:transition-none lg:mt-2 lg:mr-2 lg:mb-[var(--app-toolbar-height)] lg:rounded-md lg:shadow-surface-2 lg:after:pointer-events-none lg:after:absolute lg:after:inset-0 lg:after:z-20 lg:after:rounded-[inherit] lg:after:[box-shadow:inherit]"
						data-slot="app-surface"
					>
						<header
							className="flex min-h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-end border-border border-b bg-background px-2 pt-[env(safe-area-inset-top)] lg:hidden"
							data-slot="app-mobile-navigation-header"
						>
							<div className="flex h-14 w-full items-center gap-2">
								<button
									aria-expanded={appNavigationOpen}
									aria-label="Open app navigation"
									className="flex min-h-11 min-w-11 touch-manipulation items-center justify-center gap-2 rounded-md px-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
									onClick={openAppNavigation}
									ref={appNavigationTriggerRef}
									type="button"
								>
									<ListIcon aria-hidden="true" className="size-5" />
									<span>Menu</span>
								</button>
								{sidebar && sidebarTitle ? (
									<button
										aria-expanded={contextualNavigationOpen}
										aria-label={`Open ${sidebarTitle} navigation`}
										className="ml-auto flex min-h-11 min-w-0 touch-manipulation items-center justify-center gap-2 rounded-md px-3 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
										onClick={openContextualNavigation}
										ref={contextualNavigationTriggerRef}
										type="button"
									>
										<SidebarSimpleIcon
											aria-hidden="true"
											className="size-5 shrink-0"
										/>
										<span className="truncate">{sidebarTitle}</span>
									</button>
								) : null}
							</div>
						</header>
						<div
							className="flex min-h-0 min-w-0 flex-1"
							data-slot="app-surface-body"
						>
							{sidebar ? (
								<div
									className={
										input.moduleNavigation
											? "hidden lg:contents"
											: "hidden md:contents"
									}
									data-slot="app-inline-contextual-navigation"
								>
									<AppNavigationPresentationProvider presentation="inline">
										{sidebar}
									</AppNavigationPresentationProvider>
								</div>
							) : null}
							{input.children}
						</div>
					</div>
					{input.globalControls}
				</div>
				<AppMobileNavigationDrawer
					closeLabel="Close app navigation"
					description="Choose a destination in OpenMeld."
					onOpenChange={setAppNavigationOpen}
					open={appNavigationOpen}
					returnFocusRef={appNavigationTriggerRef}
					title="Plugin navigation"
				>
					{input.outerRail}
				</AppMobileNavigationDrawer>
				{sidebar && sidebarTitle ? (
					<AppMobileNavigationDrawer
						closeLabel={`Close ${sidebarTitle} navigation`}
						description={`Choose a destination in ${sidebarTitle}.`}
						hideEmbeddedHeader
						onOpenChange={setContextualNavigationOpen}
						open={contextualNavigationOpen}
						returnFocusRef={contextualNavigationTriggerRef}
						title={`${sidebarTitle} navigation`}
					>
						{sidebar}
					</AppMobileNavigationDrawer>
				) : null}
			</div>
		</AppModuleSidebarProvider>
	);
}
