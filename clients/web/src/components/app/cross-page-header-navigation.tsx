"use client";

import {
	TabsSubtle,
	TabsSubtleItem,
	TabsSubtlePanel,
} from "@openmeld/ui/fluid/tabs-subtle";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useOptionalCurrentOrganizationSlug } from "#/lib/organizations/organization-context";
import { resolveAppNavigationItems } from "./app-navigation-items";
import type { AppShellSection } from "./shell-layout";

export function CrossPageHeaderNavigation(input: {
	currentSection: AppShellSection | null;
}) {
	const navigate = useNavigate();
	const orgSlug = useOptionalCurrentOrganizationSlug();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	if (!orgSlug) {
		return null;
	}
	const items = resolveAppNavigationItems({ orgSlug });
	const currentSection =
		input.currentSection === "space" ? "directMessages" : input.currentSection;
	const selectedIndex = items.findIndex(
		(item) => item.section === currentSection
	);

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
