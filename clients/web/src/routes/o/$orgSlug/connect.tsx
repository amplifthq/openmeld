import { buttonVariants } from "@openmeld/ui/components/button";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
import { useStartFlowGuard } from "#/components/app/start-flow-guard";
import { BringAgentsSetupProvider } from "#/components/connect/bring-agents-setup-context";
import { StartBringAgentsSetupPage } from "#/components/connect/start-bring-agents-setup-page";
import { getDesktopPlatform } from "#/desktop/platform";
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
	return <WebConnectContent {...input} />;
}

function WebConnectContent(input: {
	initialOuterSidebarState?: SidebarPersistedState;
	orgSlug: string;
	search: ConnectRouteSearch;
}) {
	const { orgSlug, search } = input;
	const navigate = useNavigate();
	const isCreatingAgent = search.returnTo === "agent_creation";
	const profileHomeRoutes = buildProfileHomeRoutes(orgSlug);
	const routeIntent = useMemo<ConnectRouteIntent>(
		() => resolveConnectRouteIntent(search),
		[search]
	);
	const backTo = resolveConnectBackTarget(routeIntent, orgSlug);
	const centerNativeCard = Boolean(
		getDesktopPlatform() &&
			routeIntent.kind === "account_computer_setup" &&
			routeIntent.serviceAction !== "update_service" &&
			!isCreatingAgent &&
			!search.observePrepareSessionId
	);

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
	const onNativeCompleted = useCallback(() => {
		if (
			!(
				centerNativeCard &&
				(routeIntent.resetThisComputer || routeIntent.connectedComputerId)
			)
		) {
			return;
		}
		navigate({
			to: buildOrganizationConnectPath({ orgSlug }),
			search: buildConnectRouteSearch({
				...routeIntent,
				connectedComputerId: undefined,
				resetThisComputer: false,
			}),
			replace: true,
		}).catch((error: unknown) => {
			console.error(
				"Could not finish the computer connection navigation.",
				error
			);
		});
	}, [centerNativeCard, navigate, orgSlug, routeIntent]);

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
			contentLayout={centerNativeCard ? "flush" : "centered"}
			initialOuterSidebarState={
				input.initialOuterSidebarState ?? APP_SIDEBAR_DEFAULT_STATES.outer
			}
		>
			<div
				className={
					centerNativeCard
						? "flex min-h-full flex-1 flex-col gap-4 px-4 pt-8 pb-6 sm:px-6 lg:px-8"
						: "contents"
				}
			>
				<TooltipHint
					content={
						search.returnTo === "agent_creation"
							? "Back to creating Agent"
							: "Back"
					}
				>
					<Link
						aria-label={isCreatingAgent ? "Back to creating Agent" : "Back"}
						className={cn(
							buttonVariants({
								size: isCreatingAgent ? "sm" : "icon-sm",
								variant: "ghost",
							}),
							"self-start justify-self-start",
							isCreatingAgent ? "w-fit" : "aspect-square rounded-full"
						)}
						to={backTo}
					>
						<ArrowLeftIcon aria-hidden="true" />
						{isCreatingAgent ? "Back to creating Agent" : null}
					</Link>
				</TooltipHint>
				<div
					className={
						centerNativeCard
							? "flex flex-1 flex-col justify-center"
							: "contents"
					}
				>
					<BringAgentsSetupProvider routeIntent={routeIntent}>
						<StartBringAgentsSetupPage
							autoReturnOnCompletion={false}
							observePrepareSessionId={search.observePrepareSessionId}
							onCompleted={onNativeCompleted}
							orgSlug={orgSlug}
							selfRoute={buildOrganizationConnectPath({ orgSlug })}
							selfRouteSearch={resetConsumedSearch}
							showBackControl={false}
						/>
					</BringAgentsSetupProvider>
				</div>
			</div>
		</AppFullWidthLayout>
	);
}
