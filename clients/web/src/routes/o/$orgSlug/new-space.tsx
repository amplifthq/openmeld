import { buttonVariants } from "@openmeld/ui/components/button";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppMainContent } from "#/components/app/app-main-content";
import { appShellStaticData } from "#/components/app/shell-layout";
import { useStartFlowState } from "#/components/app/start-flow-state";
import {
	AppSpaceShell,
	SpaceWindowShell,
} from "#/components/spaces/app-space-shell";
import { WelcomeFirstRun } from "#/components/welcome/welcome-first-run";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationSpacesPath } from "#/lib/organizations/organization-routes";
import {
	APP_SIDEBAR_DEFAULT_STATES,
	type AppSidebarPersistedStates,
	getAppSidebarStatesForRoute,
} from "#/lib/sidebar-width-cookie";
import { resolveAppSpacesProfileId } from "#/lib/spaces/app-spaces-profile";
import { organizationSpacesQueryOptions } from "#/query/organizations/organization-directory";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";

// /o/:orgSlug/new-space is the explicit new Space entry.
export const Route = createFileRoute("/o/$orgSlug/new-space")({
	staticData: appShellStaticData.space,
	loader: async () => ({
		sidebarStates: await getAppSidebarStatesForRoute("spaces"),
	}),
	component: AppNewSpaceRoute,
});

function AppNewSpaceRoute() {
	const { sidebarStates } = Route.useLoaderData();
	return <AppNewSpaceContent initialSidebarStates={sidebarStates} />;
}

export function AppNewSpaceContent(input: {
	initialSidebarStates?: AppSidebarPersistedStates;
}) {
	const { currentOrganization } = useAppOrganization();
	const { state, storageScope } = useStartFlowState();
	const profilesQuery = useQuery(
		buildStartProfilesQueryOptions({
			enabled: true,
			storageScope,
		})
	);
	const profileId = resolveAppSpacesProfileId({
		profiles: profilesQuery.data ?? [],
		selectedHumanProfileId: state.selectedHumanProfileId,
	});
	const organizationSpacesQuery = useQuery(
		organizationSpacesQueryOptions({
			enabled: profileId !== null,
			organizationId: currentOrganization.id,
		})
	);
	const hasCurrentOrganizationSpaces =
		organizationSpacesQuery.isSuccess &&
		organizationSpacesQuery.data.spaces.length > 0;
	const innerState =
		input.initialSidebarStates?.inner ?? APP_SIDEBAR_DEFAULT_STATES.inner;
	const outerState =
		input.initialSidebarStates?.outer ?? APP_SIDEBAR_DEFAULT_STATES.outer;

	if (!profileId) {
		return (
			<SpaceWindowShell
				initialOuterSidebarState={outerState}
				initialSidebarState={innerState}
				sidebarPreferenceKey="spaces"
			>
				<AppMainContent
					header={<NewSpaceHeader orgSlug={currentOrganization.slug} />}
					headerClassName="border-b-0"
					scroll
				>
					<WelcomeFirstRun showBack={false} />
				</AppMainContent>
			</SpaceWindowShell>
		);
	}

	return (
		<AppSpaceShell
			browseSpacesActive={false}
			currentProfileId={profileId}
			currentSpaceId=""
			initialOuterSidebarState={outerState}
			initialSidebarState={innerState}
			showSpacesSidebar={hasCurrentOrganizationSpaces}
		>
			<AppMainContent
				header={<NewSpaceHeader orgSlug={currentOrganization.slug} />}
				headerClassName={
					hasCurrentOrganizationSpaces ? undefined : "border-b-0"
				}
				scroll
			>
				<WelcomeFirstRun showBack={false} />
			</AppMainContent>
		</AppSpaceShell>
	);
}

function NewSpaceHeader(input: { orgSlug: string }) {
	return (
		<div className="flex h-full items-center px-4">
			<TooltipHint content="Back to Spaces">
				<Link
					aria-label="Back to Spaces"
					className={buttonVariants({ size: "icon-sm", variant: "ghost" })}
					to={buildOrganizationSpacesPath(input.orgSlug)}
				>
					<ArrowLeftIcon aria-hidden="true" />
				</Link>
			</TooltipHint>
		</div>
	);
}
