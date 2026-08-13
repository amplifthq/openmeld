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
import { organizationDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { ComputersPicker } from "./computers-picker";
import { OrganizationComputerDetail } from "./organization-computer-card";
import {
	formatAgentCount,
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
 * inventory. Other members' read-only cards come only from active ordinary
 * Agents in the current Organization Directory, and expose the owner and those
 * visible Agent relationships without local diagnostics or controls. Selecting
 * a computer navigates to `/o/:orgSlug/computers/:deviceId`; other-member links
 * use an Agent Profile reference instead of exposing the runtime device id.
 *
 * This reuses the same `useLocalAgentRecoveryController` hook, the same device
 * list / current-device sources, and the same
 * `ComputerSummaryCardContent`, `ComputerActionsDialog`, and
 * `SelectedComputerPanel`. The detail here is the OpenMeld Service card + the local
 * agents card only. Another member's detail is a separate read-only summary.
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
	const computerGroups = resolveOrganizationComputerGroups({
		currentUserId,
		directory: organizationDirectoryQuery.data ?? null,
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

	// A Computers deep-link can target one current-Computer control. Resolve the
	// current connected Computer to its canonical detail route before the reused
	// detail panel consumes focus.
	useEffect(() => {
		if (
			!(
				routeState.computersFocusFileAccess || routeState.computersFocusService
			) ||
			selectedDeviceId !== null
		) {
			return;
		}
		if (preferredDeviceId && canResolvePreferredDeviceRoute) {
			routeState.onComputerRouteResolved?.(preferredDeviceId);
		}
	}, [
		canResolvePreferredDeviceRoute,
		preferredDeviceId,
		routeState.computersFocusFileAccess,
		routeState.computersFocusService,
		routeState.onComputerRouteResolved,
		selectedDeviceId,
	]);

	let body = (
		<ComputersPicker
			computerGroups={computerGroups}
			directoryError={
				organizationDirectoryQuery.isError
					? "OpenMeld couldn't load other members' computers."
					: null
			}
			directoryIsPending={organizationDirectoryQuery.isPending}
			isOrganizationContext={isOrganizationContext}
			isPending={recovery.localRuntimesQuery.isPending}
			isReconcilingCurrentToolsStatus={isReconcilingCurrentToolsStatus}
			orgSlug={orgSlug}
			recovery={recovery}
		/>
	);
	if (
		selectedDeviceId !== null &&
		(recovery.localRuntimesQuery.isPending ||
			(isOrganizationContext && organizationDirectoryQuery.isPending))
	) {
		body = <SelectedComputerLoading />;
	} else if (selectedDeviceId !== null && selectedComputer) {
		body = (
			<SelectedComputerPanel
				computer={selectedComputer}
				focusFileAccess={routeState.computersFocusFileAccess}
				focusService={routeState.computersFocusService}
				isReconcilingStatus={isReconcilingCurrentToolsStatus}
				onFocusConsumed={routeState.onFocusConsumed}
				queryClient={queryClient}
				recovery={recovery}
				setupCompleteRefreshPending={setupCompleteRefreshStatus === "pending"}
			/>
		);
	} else if (selectedDeviceId !== null && selectedOrganizationComputer) {
		body = (
			<OrganizationComputerDetail computer={selectedOrganizationComputer} />
		);
	} else if (selectedDeviceId !== null) {
		body = <ComputerNotFoundState orgSlug={orgSlug} />;
	}

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
				{body}
			</section>
		</>
	);
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
		return `Owned by ${input.selectedOrganizationComputer.ownerLabel} · ${formatAgentCount(input.selectedOrganizationComputer.agents.length)}`;
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
