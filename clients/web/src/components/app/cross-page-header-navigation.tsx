"use client";

import {
	TabsSubtle,
	TabsSubtleItem,
	TabsSubtlePanel,
} from "@openmeld/ui/fluid/tabs-subtle";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useStartFlowState } from "#/components/app/start-flow-state";
import { useOptionalCurrentOrganizationSlug } from "#/lib/organizations/organization-context";
import { hasAccountSpaceItems } from "#/lib/spaces/account-spaces";
import { resolveAppSpacesProfileId } from "#/lib/spaces/app-spaces-profile";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import { resolveAppNavigationItems } from "./app-navigation-items";
import type { AppShellSection } from "./shell-layout";

export function CrossPageHeaderNavigation(input: {
	currentSection: AppShellSection | null;
	includeSpaces?: boolean;
}) {
	if (input.includeSpaces !== undefined) {
		return (
			<CrossPageHeaderNavigationTabs
				currentSection={input.currentSection}
				includeSpaces={input.includeSpaces}
			/>
		);
	}

	return (
		<DynamicCrossPageHeaderNavigation currentSection={input.currentSection} />
	);
}

function DynamicCrossPageHeaderNavigation(input: {
	currentSection: AppShellSection | null;
}) {
	const { state, storageScope } = useStartFlowState();
	const profilesQuery = useQuery(
		buildStartProfilesQueryOptions({
			enabled: true,
			storageScope,
		})
	);
	const spacesProfileId = resolveAppSpacesProfileId({
		profiles: profilesQuery.data ?? [],
		selectedHumanProfileId: state.selectedHumanProfileId,
	});
	const spacesQuery = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: spacesProfileId !== null,
			profileId: spacesProfileId ?? "",
		})
	);

	return (
		<CrossPageHeaderNavigationTabs
			currentSection={input.currentSection}
			includeSpaces={hasAccountSpaceItems(spacesQuery.data)}
		/>
	);
}

function CrossPageHeaderNavigationTabs(input: {
	currentSection: AppShellSection | null;
	includeSpaces: boolean;
}) {
	const navigate = useNavigate();
	const orgSlug = useOptionalCurrentOrganizationSlug();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	if (!orgSlug) {
		return null;
	}
	const items = resolveAppNavigationItems({
		includeSpaces: input.includeSpaces,
		orgSlug,
	});
	const selectedIndex = resolveSelectedIndex({
		currentSection: input.currentSection,
		items,
	});

	return (
		<>
			<TabsSubtle
				className="max-w-full"
				idPrefix="cross-page-header-navigation"
				onSelect={(nextIndex) => {
					const item = items[nextIndex];
					if (!item || item.to === pathname) {
						return;
					}

					navigate({ to: item.to });
				}}
				selectedIndex={selectedIndex}
			>
				{items.map((item, index) => (
					<TabsSubtleItem index={index} key={item.label} label={item.label} />
				))}
			</TabsSubtle>

			<div className="hidden">
				{items.map((item, index) => (
					<TabsSubtlePanel
						className="hidden"
						idPrefix="cross-page-header-navigation"
						index={index}
						key={item.label}
						selectedIndex={selectedIndex}
					>
						{item.label}
					</TabsSubtlePanel>
				))}
			</div>
		</>
	);
}

function resolveSelectedIndex(input: {
	currentSection: AppShellSection | null;
	items: ReturnType<typeof resolveAppNavigationItems>;
}): number {
	const selectedIndex = input.items.findIndex(
		(item) => item.section === input.currentSection
	);

	return selectedIndex;
}
