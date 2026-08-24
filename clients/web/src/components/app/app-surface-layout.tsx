"use client";

import { ListIcon, SidebarSimpleIcon } from "@phosphor-icons/react";
import { type ReactNode, useRef, useState } from "react";
import { AppMobileNavigationDrawer } from "./app-mobile-navigation";
import { AppNavigationPresentationProvider } from "./app-navigation-presentation";

export function AppSurfaceLayout(input: {
	ariaBusy?: boolean;
	children: ReactNode;
	frameSlotName?: string;
	globalControls: ReactNode;
	mobileSidebarTitle?: string;
	outerRail: ReactNode;
	sidebar?: ReactNode;
	testId?: string;
}) {
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

	return (
		<div
			aria-busy={input.ariaBusy || undefined}
			className="relative flex h-dvh w-full overflow-hidden bg-[var(--app-canvas)] text-foreground"
			data-slot={input.frameSlotName ?? "app-surface-layout"}
			data-testid={input.testId}
		>
			<div className="hidden lg:contents" data-slot="app-inline-navigation">
				<AppNavigationPresentationProvider presentation="inline">
					{input.outerRail}
				</AppNavigationPresentationProvider>
			</div>
			<div
				className="relative mb-[calc(3.5rem+env(safe-area-inset-bottom))] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background lg:mt-2 lg:mr-2 lg:mb-9 lg:rounded-md lg:border-[0.5px] lg:border-border"
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
						{input.sidebar && input.mobileSidebarTitle ? (
							<button
								aria-expanded={contextualNavigationOpen}
								aria-label={`Open ${input.mobileSidebarTitle} navigation`}
								className="ml-auto flex min-h-11 min-w-0 touch-manipulation items-center justify-center gap-2 rounded-md px-3 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:hidden"
								onClick={openContextualNavigation}
								ref={contextualNavigationTriggerRef}
								type="button"
							>
								<SidebarSimpleIcon
									aria-hidden="true"
									className="size-5 shrink-0"
								/>
								<span className="truncate">{input.mobileSidebarTitle}</span>
							</button>
						) : null}
					</div>
				</header>
				<div
					className="flex min-h-0 min-w-0 flex-1"
					data-slot="app-surface-body"
				>
					{input.sidebar ? (
						<div
							className="hidden md:contents"
							data-slot="app-inline-contextual-navigation"
						>
							<AppNavigationPresentationProvider presentation="inline">
								{input.sidebar}
							</AppNavigationPresentationProvider>
						</div>
					) : null}
					{input.children}
				</div>
			</div>
			<AppMobileNavigationDrawer
				closeLabel="Close app navigation"
				description="Choose a destination in OpenMeld."
				onOpenChange={setAppNavigationOpen}
				open={appNavigationOpen}
				returnFocusRef={appNavigationTriggerRef}
				title="App navigation"
			>
				{input.outerRail}
			</AppMobileNavigationDrawer>
			{input.sidebar && input.mobileSidebarTitle ? (
				<AppMobileNavigationDrawer
					closeLabel={`Close ${input.mobileSidebarTitle} navigation`}
					description={`Choose a destination in ${input.mobileSidebarTitle}.`}
					hideEmbeddedHeader
					onOpenChange={setContextualNavigationOpen}
					open={contextualNavigationOpen}
					returnFocusRef={contextualNavigationTriggerRef}
					title={`${input.mobileSidebarTitle} navigation`}
				>
					{input.sidebar}
				</AppMobileNavigationDrawer>
			) : null}
			{input.globalControls}
		</div>
	);
}
