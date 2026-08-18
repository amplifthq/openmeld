"use client";

import type { LocalRuntimeComputer } from "@openmeld/schemas/types";
import { buttonVariants } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { formatComputerTabPlatform } from "#/components/agents/agents-page-computer";
import {
	SelectedComputerPanel,
	useRefreshComputersAfterSetupComplete,
} from "#/components/agents/selected-computer-panel";
import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { AppPageHeader } from "#/components/app/app-page-header";
import { resolveConnectedLocalRuntime } from "#/lib/connect/connected-runtime";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationComputersPath } from "#/lib/organizations/organization-routes";
import {
	organizationComputersQueryOptions,
	organizationDirectoryQueryOptions,
} from "#/query/organizations/organization-directory";
import { ComputersPicker } from "./computers-picker";
import { OrganizationComputerDetail } from "./organization-computer-card";
import {
	formatOrganizationComputerPlatform,
	type OrganizationComputer,
	type OrganizationComputerGroup,
	resolveOrganizationComputerGroups,
} from "./organization-computers";

const COMPUTERS_SERVICE_STATUS_REFETCH_INTERVAL_MS = 10_000;

/**
 * The first-level Computers home.
 *
 * `/o/:orgSlug/computers` opens on a picker grouped by owner in Organization
 * workspaces. The signed-in member's cards come from their complete personal
 * inventory. Other members' read-only cards come from Core's team-safe
 * Organization Computer projection, so a connected computer remains visible
 * before its owner creates an Agent Profile. They expose only the bounded team
 * status defined by that projection and never local accounts, paths, versions,
 * policies, or controls. Selecting a computer navigates to
 * `/o/:orgSlug/computers/:deviceId` with an opaque directory route id.
 *
 * This reuses the same `useLocalAgentRecoveryController` hook, the same device
 * list / current-device sources, and the same
 * `ComputerSummaryCardContent`, `ComputerActionsDialog`, and the same OpenMeld
 * Tools and local-agent cards. Another member's detail keeps those shared cards
 * read-only and conditionally omits private facts and owner-only controls.
 * While this status surface is visible, it periodically reconciles the
 * Core-owned Service liveness projection so an explicit local stop or restart
 * does not leave a persisted Connected result on screen.
 */
export type ComputersRouteState = {
	computersFocusFileAccess: boolean;
	computersFocusService: boolean;
	computersSelectedDeviceId: string | null;
	computersSetupCompleteRefresh: boolean;
	onComputerRouteResolved?: (deviceId: string) => void;
	onFocusConsumed?: () => void;
};

export function ComputersPage(input: { routeState: ComputersRouteState }) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const orgSlug = currentOrganization.slug;
	const isOrganizationContext = currentOrganization.isPersonal !== true;
	const queryClient = useQueryClient();
	const { routeState } = input;
	// Bound-runtime scope keeps the Computer data binding aligned with Wake
	// availability while this page stays focused on machines and local agents.
	const recovery = useLocalAgentRecoveryController({
		agentExecutionReadinessScope: "bound_runtime",
		currentLocalRuntimeReplyReadinessRefetchIntervalMs:
			COMPUTERS_SERVICE_STATUS_REFETCH_INTERVAL_MS,
		loadSetupState: false,
	});
	const setupCompleteRefreshStatus = useRefreshComputersAfterSetupComplete({
		enabled: routeState.computersSetupCompleteRefresh,
		queryClient,
		recovery,
	});
	const devices = recovery.localRuntimesQuery.data?.localRuntimes ?? [];
	const organizationDirectoryQuery = useQuery(
		organizationDirectoryQueryOptions({
			enabled: isOrganizationContext,
			organizationId: currentOrganization.id,
		})
	);
	const organizationComputersQuery = useQuery(
		organizationComputersQueryOptions({
			enabled: isOrganizationContext,
			organizationId: currentOrganization.id,
		})
	);
	const directoryIsPending =
		isOrganizationContext &&
		(organizationDirectoryQuery.isPending ||
			organizationComputersQuery.isPending);
	const directoryError =
		isOrganizationContext &&
		(organizationDirectoryQuery.isError || organizationComputersQuery.isError)
			? "OpenMeld couldn't load other members' computers."
			: null;
	const computerGroups = resolveOrganizationComputerGroups({
		currentUserId,
		directory: organizationDirectoryQuery.data ?? null,
		organizationComputers: organizationComputersQuery.data ?? null,
		ownedComputers: devices,
	});
	const isReconcilingCurrentToolsStatus =
		recovery.currentLocalRuntimeReplyReadinessQuery.isFetching &&
		!recovery.currentLocalRuntimeReplyReadinessQuery.isFetchedAfterMount;
	const selectedDeviceId = routeState.computersSelectedDeviceId;
	const preferredDeviceId =
		resolveConnectedLocalRuntime(recovery)?.deviceId ??
		recovery.selectedTargetDevice?.deviceId ??
		recovery.currentComputer?.deviceId ??
		recovery.localRuntimesQuery.data?.currentDeviceId ??
		null;
	const selectedComputer =
		selectedDeviceId === null
			? null
			: (devices.find((device) => device.deviceId === selectedDeviceId) ??
				null);
	const selectedOrganizationComputer = resolveSelectedOrganizationComputer({
		computerGroups,
		selectedComputer,
		selectedDeviceId,
	});
	const canResolvePreferredDeviceRoute =
		preferredDeviceId !== null &&
		devices.some((device) => device.deviceId === preferredDeviceId);

	useResolvePreferredComputerRoute({
		canResolvePreferredDeviceRoute,
		onComputerRouteResolved: routeState.onComputerRouteResolved,
		preferredDeviceId,
		shouldResolve:
			(routeState.computersFocusFileAccess ||
				routeState.computersFocusService) &&
			selectedDeviceId === null,
	});

	const sectionTitle = resolveComputersSectionTitle({
		selectedOrganizationComputer,
		selectedComputer,
		selectedDeviceId,
	});
	const sectionDescription = resolveComputersSectionDescription({
		isOrganizationContext,
		organizationName: currentOrganization.name,
		selectedOrganizationComputer,
		selectedComputer,
		selectedDeviceId,
	});
	return (
		<>
			<AppPageHeader
				description={sectionDescription}
				eyebrow="Run agents locally"
				id="computers-heading"
				title={sectionTitle}
			/>
			<section
				aria-labelledby="computers-heading"
				className="flex flex-col pb-6"
				id="computers-machines"
			>
				{selectedDeviceId ? (
					<div className="mb-3">
						<Link
							className="inline-flex min-h-5 items-center gap-2 font-medium text-foreground text-sm leading-5 outline-none transition-colors hover:text-foreground/80 focus-visible:ring-1 focus-visible:ring-ring"
							data-testid="all-computers-link"
							to={buildOrganizationComputersPath(orgSlug)}
						>
							<ArrowLeftIcon
								aria-hidden="true"
								className="size-4 shrink-0"
								data-icon="inline-start"
							/>
							All computers
						</Link>
					</div>
				) : null}
				<ComputersPageBody
					computerGroups={computerGroups}
					directoryError={directoryError}
					directoryIsPending={directoryIsPending}
					isOrganizationContext={isOrganizationContext}
					isReconcilingCurrentToolsStatus={isReconcilingCurrentToolsStatus}
					orgSlug={orgSlug}
					queryClient={queryClient}
					recovery={recovery}
					routeState={routeState}
					selectedComputer={selectedComputer}
					selectedDeviceId={selectedDeviceId}
					selectedOrganizationComputer={selectedOrganizationComputer}
					setupCompleteRefreshPending={setupCompleteRefreshStatus === "pending"}
				/>
			</section>
		</>
	);
}

function ComputersPageBody(input: {
	computerGroups: readonly OrganizationComputerGroup[];
	directoryError: string | null;
	directoryIsPending: boolean;
	isOrganizationContext: boolean;
	isReconcilingCurrentToolsStatus: boolean;
	orgSlug: string;
	queryClient: ReturnType<typeof useQueryClient>;
	recovery: ReturnType<typeof useLocalAgentRecoveryController>;
	routeState: ComputersRouteState;
	selectedComputer: LocalRuntimeComputer | null;
	selectedDeviceId: string | null;
	selectedOrganizationComputer: OrganizationComputer | null;
	setupCompleteRefreshPending: boolean;
}) {
	if (
		input.selectedDeviceId !== null &&
		(input.recovery.localRuntimesQuery.isPending || input.directoryIsPending)
	) {
		return <SelectedComputerLoading />;
	}
	if (input.selectedDeviceId !== null && input.selectedComputer) {
		return (
			<SelectedComputerPanel
				computer={input.selectedComputer}
				focusFileAccess={input.routeState.computersFocusFileAccess}
				focusService={input.routeState.computersFocusService}
				isReconcilingStatus={input.isReconcilingCurrentToolsStatus}
				onFocusConsumed={input.routeState.onFocusConsumed}
				queryClient={input.queryClient}
				recovery={input.recovery}
				setupCompleteRefreshPending={input.setupCompleteRefreshPending}
			/>
		);
	}
	if (input.selectedDeviceId !== null && input.selectedOrganizationComputer) {
		return (
			<OrganizationComputerDetail
				computer={input.selectedOrganizationComputer}
			/>
		);
	}
	if (input.selectedDeviceId !== null) {
		return <ComputerNotFoundState orgSlug={input.orgSlug} />;
	}
	return (
		<ComputersPicker
			computerGroups={input.computerGroups}
			directoryError={input.directoryError}
			directoryIsPending={input.directoryIsPending}
			isOrganizationContext={input.isOrganizationContext}
			isPending={input.recovery.localRuntimesQuery.isPending}
			isReconcilingCurrentToolsStatus={input.isReconcilingCurrentToolsStatus}
			orgSlug={input.orgSlug}
			recovery={input.recovery}
		/>
	);
}

// A Computers deep-link can target one current-Computer control. Resolve the
// current connected Computer to its canonical detail route before the reused
// detail panel consumes focus.
function useResolvePreferredComputerRoute(input: {
	canResolvePreferredDeviceRoute: boolean;
	onComputerRouteResolved?: (deviceId: string) => void;
	preferredDeviceId: string | null;
	shouldResolve: boolean;
}) {
	useEffect(() => {
		if (
			input.shouldResolve &&
			input.preferredDeviceId &&
			input.canResolvePreferredDeviceRoute
		) {
			input.onComputerRouteResolved?.(input.preferredDeviceId);
		}
	}, [
		input.canResolvePreferredDeviceRoute,
		input.onComputerRouteResolved,
		input.preferredDeviceId,
		input.shouldResolve,
	]);
}

function resolveSelectedOrganizationComputer(input: {
	computerGroups: readonly OrganizationComputerGroup[];
	selectedComputer: LocalRuntimeComputer | null;
	selectedDeviceId: string | null;
}): OrganizationComputer | null {
	if (input.selectedComputer || input.selectedDeviceId === null) {
		return null;
	}
	return (
		input.computerGroups
			.flatMap((group) => group.computers)
			.find((computer) => computer.routeId === input.selectedDeviceId) ?? null
	);
}

function resolveComputersSectionTitle(input: {
	selectedOrganizationComputer: OrganizationComputer | null;
	selectedComputer: LocalRuntimeComputer | null;
	selectedDeviceId: string | null;
}): string {
	if (input.selectedDeviceId === null) {
		return "Computers";
	}
	return (
		input.selectedComputer?.deviceDisplayName ??
		input.selectedOrganizationComputer?.deviceDisplayName ??
		"Computer not found"
	);
}

function resolveComputersSectionDescription(input: {
	isOrganizationContext: boolean;
	organizationName: string;
	selectedOrganizationComputer: OrganizationComputer | null;
	selectedComputer: LocalRuntimeComputer | null;
	selectedDeviceId: string | null;
}): string {
	if (input.selectedDeviceId === null) {
		if (input.isOrganizationContext) {
			return `See the computers used by Agents in ${input.organizationName}. You can manage only the computers connected to your account.`;
		}
		return "Connect a computer to let OpenMeld run Agents through local tools such as Codex, Claude Code, and Grok Build.";
	}
	if (input.selectedComputer) {
		return formatComputerTabPlatform(input.selectedComputer);
	}
	if (input.selectedOrganizationComputer) {
		return formatOrganizationComputerPlatform(
			input.selectedOrganizationComputer
		);
	}
	return "This computer is no longer available in this workspace.";
}

function SelectedComputerLoading() {
	return (
		<div className="flex flex-col gap-4" data-testid="computer-detail-loading">
			<Skeleton className="h-56 w-full" />
			<Skeleton className="h-72 w-full" />
		</div>
	);
}

function ComputerNotFoundState(input: { orgSlug: string }) {
	return (
		<div
			className="border border-border/70 bg-card/35 px-4 py-5"
			data-testid="computer-not-found-state"
		>
			<p className="max-w-xl text-muted-foreground text-sm">
				This computer is no longer available. Return to all computers to choose
				another machine.
			</p>
			<Link
				className={cn(
					buttonVariants({ size: "sm", variant: "outline" }),
					"mt-4"
				)}
				to={buildOrganizationComputersPath(input.orgSlug)}
			>
				All computers
			</Link>
		</div>
	);
}
