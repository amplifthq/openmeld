"use client";

import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
	getSpaceViewIndex,
	resolveSpaceView,
	type SpaceView,
} from "#/components/spaces/space-view";

type CenterAgentConversationView = SpaceView;

import type { CenterAgentSectionId } from "#/lib/organizations/center-agent-navigation";
import { buildOrganizationCenterAgentChatPath } from "#/lib/organizations/organization-routes";

export function CenterAgentHeaderTabs(input: {
	activeSectionId: CenterAgentSectionId;
	activeSpaceView?: CenterAgentConversationView;
	className?: string;
	idPrefix: string;
	onSpaceViewChange?: (view: CenterAgentConversationView) => void;
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
				if (index < 4) {
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
			}}
			selectedIndex={selectedIndex}
			variant="underline"
		>
			<TabsSubtleItem index={0} label="Messages" labelClassName="text-sm" />
			<TabsSubtleItem index={3} label="Tasks" labelClassName="text-sm" />
			<TabsSubtleItem index={1} label="Graph" labelClassName="text-sm" />
			<TabsSubtleItem index={2} label="Files" labelClassName="text-sm" />
		</TabsSubtle>
	);
}

function resolveCenterAgentHeaderTabIndex(input: {
	activeSectionId: CenterAgentSectionId;
	activeSpaceView?: CenterAgentConversationView;
}): number {
	if (input.activeSectionId === "chat") {
		return getSpaceViewIndex(input.activeSpaceView ?? "messages");
	}
	return -1;
}
