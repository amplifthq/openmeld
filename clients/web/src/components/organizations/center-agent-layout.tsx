"use client";

import { SidebarContent, SidebarHeader } from "@openmeld/ui/components/sidebar";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { type ReactNode, useState } from "react";
import { AppGlobalControls } from "#/components/app/app-global-controls";
import { AppOuterRail } from "#/components/app/app-outer-rail";
import { AppOuterRailFrame } from "#/components/app/app-outer-rail-frame";
import { useAppShellAccount } from "#/components/app/app-shell-account";
import { AppSurfaceLayout } from "#/components/app/app-surface-layout";
import {
	resolveClientSidebarInitialState,
	type SidebarPersistedState,
} from "#/lib/sidebar-width-cookie";
import { CenterAgentChatSidebar } from "./center-agent-chat-sidebar";

export function CenterAgentLayout(input: {
	children: ReactNode;
	currentPathname?: string;
	initialOuterSidebarState?: SidebarPersistedState;
}) {
	const account = useAppShellAccount();
	return (
		<AppSurfaceLayout
			frameSlotName="center-agent-layout"
			globalControls={
				<AppGlobalControls currentPathname={input.currentPathname} />
			}
			outerRail={
				<AppOuterRail
					account={account}
					contextualNavigation={<CenterAgentChatSidebar />}
					initialState={input.initialOuterSidebarState}
				/>
			}
		>
			<section
				className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
				data-slot="center-agent-content"
			>
				{input.children}
			</section>
		</AppSurfaceLayout>
	);
}

export function CenterAgentPendingLayout(input: {
	children: ReactNode;
	initialOuterSidebarState?: SidebarPersistedState;
}) {
	return (
		<AppSurfaceLayout
			frameSlotName="center-agent-pending-layout"
			globalControls={<AppGlobalControls />}
			outerRail={
				<CenterAgentPendingOuterRail
					initialState={input.initialOuterSidebarState}
				/>
			}
		>
			<section className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
				{input.children}
			</section>
		</AppSurfaceLayout>
	);
}

function CenterAgentPendingOuterRail(input: {
	initialState?: SidebarPersistedState;
}) {
	const [state] = useState(() =>
		resolveClientSidebarInitialState("outer", input.initialState)
	);

	// Match the persisted icon rail. Hidden mode has no visible panel.
	const isIconLike = state.tier !== "expanded";

	return (
		<AppOuterRailFrame
			ariaHidden
			state={state}
			testId="center-agent-pending-outer-rail"
		>
			<SidebarHeader className="h-[var(--space-conversation-header-height)] justify-center overflow-hidden border-b-0 px-2 py-0">
				{isIconLike ? (
					<Skeleton
						className="mx-auto size-8 motion-reduce:animate-none"
						data-testid="center-agent-pending-outer-rail-collapsed"
					/>
				) : (
					<div
						className="flex w-full items-center gap-2 px-2"
						data-testid="center-agent-pending-outer-rail-expanded"
					>
						<Skeleton className="size-6 shrink-0 motion-reduce:animate-none" />
						<Skeleton className="h-4 min-w-0 flex-1 motion-reduce:animate-none" />
					</div>
				)}
			</SidebarHeader>
			<SidebarContent className="overflow-hidden px-2 py-3">
				<div className="flex flex-col gap-3">
					{[0, 1, 2, 3, 4, 5].map((item) => (
						<Skeleton
							className={
								isIconLike
									? "mx-auto size-9 motion-reduce:animate-none"
									: "h-9 w-full motion-reduce:animate-none"
							}
							key={item}
						/>
					))}
				</div>
			</SidebarContent>
		</AppOuterRailFrame>
	);
}
