import { buttonVariants } from "@openmeld/ui/components/button";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
import { useStartFlowGuard } from "#/components/app/start-flow-guard";
import { BringAgentsSetupProvider } from "#/components/connect/bring-agents-setup-context";
import { StartBringAgentsSetupPage } from "#/components/connect/start-bring-agents-setup-page";
import {
	buildConnectRouteSearch,
	type ConnectRouteIntent,
	type ConnectRouteSearch,
	normalizeConnectRouteSearch,
	resolveConnectBackTarget,
	resolveConnectCompletionTarget,
	resolveConnectRouteIntent,
} from "#/lib/connect/connect-route";
import { buildOrganizationConnectPath } from "#/lib/organizations/organization-routes";
import { buildProfileHomeRoutes } from "#/lib/profile-routes";
import { useSelectedHumanProfile } from "#/lib/profiles/use-selected-human-profile";
import {
	APP_SIDEBAR_DEFAULT_STATES,
	getAppSidebarStatesForRoute,
	type SidebarPersistedState,
} from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/connect")({
	staticData: appShellStaticData.connect,
	loader: async () => ({ sidebarStates: await getAppSidebarStatesForRoute() }),
	component: AppConnectRoute,
	validateSearch: normalizeConnectRouteSearch,
});

// "Connect this computer" owns the Web setup flow, command handshake, and live
// prepare-session stream. Local-agent selection happens in the CLI terminal,
// while the page stays inside the shared app shell.
//
// Default (no space params): account_computer_setup, so Back returns to People
// while completion opens the refreshed Computer setup result. When a Space's Connect/recovery action sends the user here with
// returnTo=space + spaceId (profileId optional — the Space route resolves the
// viewer from its last-used human profile), the page reuses the space_recovery
// intent so Back/completion return to that originating Space.
function AppConnectRoute() {
	const search = Route.useSearch();
	const { orgSlug } = Route.useParams();
	const { sidebarStates } = Route.useLoaderData();
	return (
		<AppConnectContent
			initialOuterSidebarState={sidebarStates.outer}
			orgSlug={orgSlug}
			search={search}
		/>
	);
}

export function AppConnectContent(input: {
	initialOuterSidebarState?: SidebarPersistedState;
	orgSlug: string;
	search: ConnectRouteSearch;
}) {
	const { orgSlug, search } = input;
	const profileHomeRoutes = buildProfileHomeRoutes(orgSlug);
	const routeIntent = useMemo<ConnectRouteIntent>(
		() => resolveConnectRouteIntent(search),
		[search]
	);
	const backTo = resolveConnectBackTarget(routeIntent, orgSlug);

	// Fresh-session consumption must land back on the org-scoped Connect route with session/reset
	// cleared. For space recovery the space params must survive so
	// the remount re-resolves the space_recovery intent; account setup keeps a
	// clean URL after the fresh session is loaded.
	const resetConsumedSearch = useMemo<ConnectRouteSearch>(
		() =>
			buildConnectRouteSearch({
				...routeIntent,
				resetThisComputer: false,
			}),
		[routeIntent]
	);

	// The org-scoped Connect route mounts setup directly, so it must guard missing or stale
	// human-profile state itself: without an active human profile the prepare
	// session can never start. Send the user back to where they came from — the
	// originating Space for recovery, or Profiles for account setup — instead of
	// stranding the page on an endless loading state.
	const missingProfileRedirectTo =
		routeIntent.kind === "space_recovery"
			? resolveConnectCompletionTarget(routeIntent, orgSlug)
			: profileHomeRoutes.people;
	const { canContinueWithSelectedHumanProfile } = useSelectedHumanProfile({
		selectDefaultWhenMissing: true,
		syncMissingSelectionToStartFlow: false,
	});
	const isAllowed = useStartFlowGuard({
		when: canContinueWithSelectedHumanProfile,
		redirectTo: missingProfileRedirectTo,
	});

	if (!isAllowed) {
		return null;
	}

	return (
		<AppFullWidthLayout
			initialOuterSidebarState={
				input.initialOuterSidebarState ?? APP_SIDEBAR_DEFAULT_STATES.outer
			}
		>
			<Link
				aria-label="Back"
				className={buttonVariants({ size: "icon-sm", variant: "ghost" })}
				title={
					search.returnTo === "agent_creation"
						? "Back to creating Agent"
						: "Back"
				}
				to={backTo}
			>
				<ArrowLeftIcon aria-hidden="true" />
			</Link>
			<BringAgentsSetupProvider routeIntent={routeIntent}>
				<StartBringAgentsSetupPage
					autoReturnOnCompletion={search.returnTo === "agent_creation"}
					orgSlug={orgSlug}
					selfRoute={buildOrganizationConnectPath({ orgSlug })}
					selfRouteSearch={resetConsumedSearch}
					showBackControl={false}
				/>
			</BringAgentsSetupProvider>
		</AppFullWidthLayout>
	);
}
