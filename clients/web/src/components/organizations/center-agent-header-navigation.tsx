"use client";

import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
	getSpaceViewIndex,
	resolveSpaceView,
	type SpaceView,
} from "#/components/spaces/space-view";

type CenterAgentConversationView = Exclude<SpaceView, "tasks">;

import type { CenterAgentSectionId } from "#/lib/organizations/center-agent-navigation";
import {
	buildOrganizationCenterAgentChatPath,
	buildOrganizationChannelsPath,
	buildOrganizationMemoryPath,
} from "#/lib/organizations/organization-routes";

const CHANNELS_TAB_INDEX = 3;
const MEMORY_TAB_INDEX = 4;

export function CenterAgentHeaderTabs(input: {
	activeSectionId: CenterAgentSectionId;
	activeSpaceView?: CenterAgentConversationView;
	className?: string;
	idPrefix: string;
	onSpaceViewChange?: (view: CenterAgentConversationView) => void;
	organizationSlug: string;
}) {
	const navigate = useNavigate();
	const router = useRouter();
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
	const preloadSection = (index: number) => {
		const to = resolveCenterAgentHeaderDestination({
			index,
			organizationSlug: input.organizationSlug,
		});
		const query = new URLSearchParams(context).toString();
		router.preloadRoute({ to: query ? `${to}?${query}` : to }).catch(() => {
			// Ordinary navigation owns visible errors if this speculative read fails.
		});
	};

	return (
		<TabsSubtle
			aria-label="Center Agent"
			className={input.className ?? "h-full gap-5"}
			idPrefix={input.idPrefix}
			indicatorLayoutId={`center-agent-header-${input.organizationSlug}`}
			onSelect={(index) => {
				if (index <= 2) {
					const view = resolveSpaceView(index);
					if (view === "tasks") {
						return;
					}
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

			<TabsSubtleItem
				index={3}
				label="Channels"
				labelClassName="text-sm"
				onFocus={() => preloadSection(3)}
				onPointerEnter={() => preloadSection(3)}
			/>
			<TabsSubtleItem
				index={4}
				label="Memory"
				labelClassName="text-sm"
				onFocus={() => preloadSection(4)}
				onPointerEnter={() => preloadSection(4)}
			/>
		</TabsSubtle>
	);
}

function resolveCenterAgentHeaderTabIndex(input: {
	activeSectionId: CenterAgentSectionId;
	activeSpaceView?: CenterAgentConversationView;
}): number {
	if (input.activeSectionId === "channels") {
		return CHANNELS_TAB_INDEX;
	}
	if (input.activeSectionId === "memory") {
		return MEMORY_TAB_INDEX;
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
		case MEMORY_TAB_INDEX:
			return buildOrganizationMemoryPath(input.organizationSlug);
		case CHANNELS_TAB_INDEX:
			return buildOrganizationChannelsPath(input.organizationSlug);
		default:
			throw new Error(`Unknown Center Agent header tab index: ${input.index}`);
	}
}
