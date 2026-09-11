"use client";

import { Skeleton } from "@openmeld/ui/components/skeleton";
import type { ReactNode } from "react";
import { AppGlobalControls } from "#/components/app/app-global-controls";
import { AppOuterRail } from "#/components/app/app-outer-rail";
import { useAppShellAccount } from "#/components/app/app-shell-account";
import { AppSurfaceLayout } from "#/components/app/app-surface-layout";
import type { SidebarPersistedState } from "#/lib/sidebar-width-cookie";
import { APP_APPLICATION_RAIL_CLASS_NAME } from "../app/app-nav-item-style";
import { SidebarListSkeleton } from "../app/sidebar-list-skeleton";
import { ConversationsSidebar } from "../spaces/conversations-sidebar";

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
			initialModuleSidebarState={input.initialOuterSidebarState}
			moduleNavigation={<ConversationsSidebar />}
			moduleNavigationLabel="Spaces"
			outerRail={<AppOuterRail account={account} />}
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
			initialModuleSidebarState={input.initialOuterSidebarState}
			moduleNavigation={
				<SidebarListSkeleton
					label="Loading conversations"
					rowCount={5}
					showPreview
				/>
			}
			moduleNavigationLabel="Spaces"
			outerRail={
				<aside
					aria-hidden="true"
					className={APP_APPLICATION_RAIL_CLASS_NAME}
					data-testid="center-agent-pending-outer-rail"
				>
					<div className="flex h-20 items-center justify-center">
						<Skeleton className="size-9 rounded-xl motion-reduce:animate-none" />
					</div>
					<div className="flex flex-col items-center gap-5 py-3">
						{[0, 1, 2, 3].map((index) => (
							<Skeleton
								className="h-10 w-9 motion-reduce:animate-none"
								key={index}
							/>
						))}
					</div>
				</aside>
			}
		>
			<section className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
				{input.children}
			</section>
		</AppSurfaceLayout>
	);
}
