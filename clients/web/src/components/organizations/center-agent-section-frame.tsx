import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { APP_CONTEXTUAL_MAIN_TEXT_BASE_START_CLASS_NAME } from "#/components/app/app-contextual-layout-style";
import { AppMainContent } from "#/components/app/app-main-content";
import {
	SpaceHeaderIdentityIcon,
	SpaceWindowHeader,
} from "#/components/spaces/space-header";
import { resolveCenterAgentSectionId } from "#/lib/organizations/center-agent-navigation";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	CenterAgentHeaderMenu,
	CenterAgentHeaderTabs,
} from "./center-agent-header-navigation";
import {
	type CenterAgentRouteState,
	CenterAgentRouteStateProvider,
} from "./center-agent-route-state";

export function CenterAgentSectionFrame(input: {
	children: ReactNode;
	routeState?: Partial<CenterAgentRouteState>;
}) {
	const { currentOrganization } = useAppOrganization();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const activeSectionId = resolveCenterAgentSectionId(pathname);

	return (
		<AppMainContent
			bodySlotName="center-agent-section-scroll"
			header={
				<SpaceWindowHeader
					actions={
						<CenterAgentHeaderMenu
							organizationSlug={currentOrganization.slug}
						/>
					}
					leadingControl={<SpaceHeaderIdentityIcon isDirectMessage />}
					navigation={
						<CenterAgentHeaderTabs
							activeSectionId={activeSectionId}
							className="h-full gap-5"
							idPrefix="center-agent-section-view"
							organizationSlug={currentOrganization.slug}
						/>
					}
					renderFrame={false}
					secondaryContentClassName="overflow-x-auto"
					title="Center Agent"
				/>
			}
			headerSlotName="center-agent-section-header"
			scroll
		>
			<div className="mx-auto w-full max-w-7xl px-4 pt-3 pb-6 sm:px-6 lg:px-8">
				<CenterAgentRouteStateProvider value={input.routeState}>
					<div
						className={`flex flex-col gap-4 ${APP_CONTEXTUAL_MAIN_TEXT_BASE_START_CLASS_NAME}`}
					>
						{input.children}
					</div>
				</CenterAgentRouteStateProvider>
			</div>
		</AppMainContent>
	);
}
