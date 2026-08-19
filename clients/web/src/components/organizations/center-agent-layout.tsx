"use client";

import { SidebarContent, SidebarHeader } from "@openmeld/ui/components/sidebar";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	BrainIcon,
	CalendarDotsIcon,
	ChatCircleIcon,
	GearSixIcon,
	ListChecksIcon,
	PlugsConnectedIcon,
	SparkleIcon,
	SquaresFourIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import {
	type AppContextualNavGroup,
	AppContextualSidebarNav,
} from "#/components/app/app-contextual-layout";
import { AppGlobalControls } from "#/components/app/app-global-controls";
import { AppInnerSidebar } from "#/components/app/app-inner-sidebar";
import { AppOuterRail } from "#/components/app/app-outer-rail";
import { AppOuterRailFrame } from "#/components/app/app-outer-rail-frame";
import { useAppShellAccount } from "#/components/app/app-shell-account";
import { AppSurfaceLayout } from "#/components/app/app-surface-layout";
import { useComputerAttentionTone } from "#/components/app/use-computer-attention-tone";
import type { CenterAgentSectionId } from "#/lib/organizations/center-agent-navigation";
import {
	buildOrganizationAppsPath,
	buildOrganizationCenterAgentChatPath,
	buildOrganizationCenterAgentRoutinesPath,
	buildOrganizationCenterAgentSettingsPath,
	buildOrganizationCenterAgentTasksPath,
	buildOrganizationChannelsPath,
	buildOrganizationMemoryPath,
	buildOrganizationSkillsPath,
} from "#/lib/organizations/organization-routes";
import {
	resolveClientSidebarInitialState,
	type SidebarPersistedState,
} from "#/lib/sidebar-width-cookie";

export function CenterAgentLayout(input: {
	activeSectionId?: CenterAgentSectionId;
	children: ReactNode;
	currentPathname?: string;
	initialInnerSidebarState?: SidebarPersistedState;
	initialOuterSidebarState?: SidebarPersistedState;
	organizationSlug: string;
}) {
	const account = useAppShellAccount();
	const computerAttentionTone = useComputerAttentionTone();

	return (
		<AppSurfaceLayout
			frameSlotName="center-agent-layout"
			globalControls={
				<AppGlobalControls currentPathname={input.currentPathname} />
			}
			outerRail={
				<AppOuterRail
					account={account}
					computerAttentionTone={computerAttentionTone}
					initialState={input.initialOuterSidebarState}
				/>
			}
			sidebar={
				<AppInnerSidebar
					initialState={input.initialInnerSidebarState}
					preferenceKey="center-agent"
					separatorLabel="Resize the Center Agent sidebar"
				>
					<CenterAgentInnerSidebar
						activeSectionId={input.activeSectionId ?? "chat"}
						organizationSlug={input.organizationSlug}
					/>
				</AppInnerSidebar>
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
	initialInnerSidebarState?: SidebarPersistedState;
	initialOuterSidebarState?: SidebarPersistedState;
	organizationSlug: string;
	section: CenterAgentSectionId;
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
			sidebar={
				<AppInnerSidebar
					initialState={input.initialInnerSidebarState}
					preferenceKey="center-agent"
					separatorLabel="Resize the Center Agent sidebar"
				>
					<CenterAgentInnerSidebar
						activeSectionId={input.section}
						organizationSlug={input.organizationSlug}
					/>
				</AppInnerSidebar>
			}
		>
			<section className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
				{input.children}
			</section>
		</AppSurfaceLayout>
	);
}

function CenterAgentInnerSidebar(input: {
	activeSectionId: CenterAgentSectionId;
	organizationSlug: string;
}) {
	const groups = [
		{
			ariaLabel: "Center Agent work",
			id: "work",
			items: [
				{
					icon: ChatCircleIcon,
					id: "chat",
					label: "Chat",
					to: buildOrganizationCenterAgentChatPath(input.organizationSlug),
				},
				{
					icon: ListChecksIcon,
					id: "tasks",
					label: "Tasks",
					to: buildOrganizationCenterAgentTasksPath(input.organizationSlug),
				},
				{
					icon: CalendarDotsIcon,
					id: "routines",
					label: "Routines",
					to: buildOrganizationCenterAgentRoutinesPath(input.organizationSlug),
				},
			],
			label: "Work",
		},
		{
			ariaLabel: "Center Agent capabilities",
			id: "capabilities",
			items: [
				{
					icon: SparkleIcon,
					id: "skills",
					label: "Skills",
					to: buildOrganizationSkillsPath(input.organizationSlug),
				},
				{
					icon: PlugsConnectedIcon,
					id: "channels",
					label: "Channels",
					to: buildOrganizationChannelsPath(input.organizationSlug),
				},
				{
					icon: SquaresFourIcon,
					id: "apps",
					label: "Apps",
					to: buildOrganizationAppsPath(input.organizationSlug),
				},
				{
					icon: BrainIcon,
					id: "memory",
					label: "Memory",
					to: buildOrganizationMemoryPath(input.organizationSlug),
				},
			],
			label: "Capabilities",
		},
		{
			ariaLabel: "Center Agent management",
			id: "manage",
			items: [
				{
					icon: GearSixIcon,
					id: "settings",
					label: "Center Agent settings",
					to: buildOrganizationCenterAgentSettingsPath(input.organizationSlug),
				},
			],
			label: "Manage",
		},
	] as const satisfies readonly AppContextualNavGroup<CenterAgentSectionId>[];

	return (
		<AppContextualSidebarNav
			activeItemId={input.activeSectionId}
			ariaLabel="Center Agent"
			groups={groups}
			title="Center Agent"
		/>
	);
}

function CenterAgentPendingOuterRail(input: {
	initialState?: SidebarPersistedState;
}) {
	const [state] = useState(() =>
		resolveClientSidebarInitialState("outer", input.initialState)
	);

	// Matches AppRailBrand's own simplification: the compact tier reuses the
	// narrow/icon skeleton shape rather than a bespoke third placeholder, same
	// as it reuses the icon-mark brand treatment in the real (non-skeleton)
	// rail.
	const isIconLike = state.tier !== "full";

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
