"use client";

import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import { BrainIcon, GearSixIcon } from "@phosphor-icons/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
	SpaceHeaderNavigationMenu,
	type SpaceHeaderNavigationMenuItem,
} from "#/components/spaces/space-header-navigation-menu";
import {
	getSpaceViewIndex,
	resolveSpaceView,
	type SpaceView,
} from "#/components/spaces/space-view";
import type { CenterAgentSectionId } from "#/lib/organizations/center-agent-navigation";
import {
	buildOrganizationCenterAgentChatPath,
	buildOrganizationCenterAgentRoutinesPath,
	buildOrganizationCenterAgentSettingsPath,
	buildOrganizationCenterAgentTasksPath,
	buildOrganizationChannelsPath,
	buildOrganizationMemoryPath,
	buildOrganizationPluginsPath,
	buildOrganizationSkillsPath,
} from "#/lib/organizations/organization-routes";

const TASKS_TAB_INDEX = 3;
const ROUTINES_TAB_INDEX = 4;
const SKILLS_TAB_INDEX = 5;
const PLUGINS_TAB_INDEX = 6;
const CHANNELS_TAB_INDEX = 7;

export function CenterAgentHeaderTabs(input: {
	activeSectionId: CenterAgentSectionId;
	activeSpaceView?: SpaceView;
	className?: string;
	idPrefix: string;
	onSpaceViewChange?: (view: SpaceView) => void;
	organizationSlug: string;
}) {
	const navigate = useNavigate();
	const searchStr = useRouterState({
		select: (state) => state.location.searchStr,
	});
	const selector = new URLSearchParams(searchStr);
	const context = Object.fromEntries(
		["draft", "group", "session"].flatMap((key) => {
			const value = selector.get(key);
			return value === null ? [] : [[key, value]];
		})
	);
	const selectedIndex = resolveCenterAgentHeaderTabIndex({
		activeSectionId: input.activeSectionId,
		activeSpaceView: input.activeSpaceView,
	});

	return (
		<TabsSubtle
			aria-label="Center Agent"
			className={input.className ?? "h-full gap-5"}
			idPrefix={input.idPrefix}
			indicatorLayoutId={`center-agent-header-${input.organizationSlug}`}
			onSelect={(index) => {
				if (index <= 2) {
					const view = resolveSpaceView(index);
					if (input.onSpaceViewChange) {
						input.onSpaceViewChange(view);
						return;
					}
					navigate({
						to: buildOrganizationCenterAgentChatPath(input.organizationSlug, {
							...context,
							...(view === "messages" ? {} : { view }),
						}),
					}).catch((error: unknown) => {
						console.error(
							"Failed to open the Center Agent conversation.",
							error
						);
					});
					return;
				}
				const to = resolveCenterAgentHeaderDestination({
					index,
					organizationSlug: input.organizationSlug,
				});
				const contextQuery = new URLSearchParams(context).toString();
				navigate({ to: contextQuery ? `${to}?${contextQuery}` : to }).catch(
					(error: unknown) => {
						console.error("Failed to open Center Agent work.", error);
					}
				);
			}}
			selectedIndex={selectedIndex}
			variant="underline"
		>
			<TabsSubtleItem index={0} label="Messages" labelClassName="text-sm" />
			<TabsSubtleItem index={1} label="Graph" labelClassName="text-sm" />
			<TabsSubtleItem index={2} label="Files" labelClassName="text-sm" />
			<TabsSubtleItem index={3} label="Tasks" labelClassName="text-sm" />
			<TabsSubtleItem index={4} label="Routines" labelClassName="text-sm" />
			<TabsSubtleItem index={5} label="Skills" labelClassName="text-sm" />
			<TabsSubtleItem index={6} label="Plugins" labelClassName="text-sm" />
			<TabsSubtleItem index={7} label="Channels" labelClassName="text-sm" />
		</TabsSubtle>
	);
}

export function CenterAgentHeaderMenu(input: { organizationSlug: string }) {
	return (
		<SpaceHeaderNavigationMenu
			ariaLabel="Center Agent menu"
			items={buildCenterAgentHeaderMenuItems(input.organizationSlug)}
		/>
	);
}

export function buildCenterAgentHeaderMenuItems(
	organizationSlug: string
): readonly SpaceHeaderNavigationMenuItem[] {
	return [
		{
			icon: BrainIcon,
			label: "Memory",
			to: buildOrganizationMemoryPath(organizationSlug),
		},
		{
			icon: GearSixIcon,
			label: "Center Agent settings",
			to: buildOrganizationCenterAgentSettingsPath(organizationSlug),
		},
	];
}

function resolveCenterAgentHeaderTabIndex(input: {
	activeSectionId: CenterAgentSectionId;
	activeSpaceView?: SpaceView;
}): number {
	if (input.activeSectionId === "tasks") {
		return TASKS_TAB_INDEX;
	}
	if (input.activeSectionId === "routines") {
		return ROUTINES_TAB_INDEX;
	}
	if (input.activeSectionId === "skills") {
		return SKILLS_TAB_INDEX;
	}
	if (input.activeSectionId === "plugins") {
		return PLUGINS_TAB_INDEX;
	}
	if (input.activeSectionId === "channels") {
		return CHANNELS_TAB_INDEX;
	}
	if (input.activeSectionId === "chat") {
		return getSpaceViewIndex(input.activeSpaceView ?? "messages");
	}
	return -1;
}

function resolveCenterAgentHeaderDestination(input: {
	index: number;
	organizationSlug: string;
}): string {
	switch (input.index) {
		case CHANNELS_TAB_INDEX:
			return buildOrganizationChannelsPath(input.organizationSlug);
		case TASKS_TAB_INDEX:
			return buildOrganizationCenterAgentTasksPath(input.organizationSlug);
		case ROUTINES_TAB_INDEX:
			return buildOrganizationCenterAgentRoutinesPath(input.organizationSlug);
		case SKILLS_TAB_INDEX:
			return buildOrganizationSkillsPath(input.organizationSlug);
		case PLUGINS_TAB_INDEX:
			return buildOrganizationPluginsPath(input.organizationSlug);
		default:
			throw new Error(`Unknown Center Agent header tab index: ${input.index}`);
	}
}
