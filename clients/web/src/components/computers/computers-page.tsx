"use client";

import type { LocalRuntimeComputer } from "@openmeld/schemas/types";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
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
import { APP_INLINE_BACK_LINK_CLASS_NAME } from "#/components/app/app-inline-navigation";
import { AppPageHeader } from "#/components/app/app-page-header";
import { resolveConnectedLocalRuntime } from "#/lib/connect/connected-runtime";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationPeoplePath } from "#/lib/organizations/organization-routes";
import {
	organizationComputersQueryOptions,
	organizationDirectoryQueryOptions,
} from "#/query/organizations/organization-directory";
import { OrganizationComputerDetail } from "./organization-computer-card";
import {
	formatOrganizationComputerPlatform,
	type OrganizationComputer,
	type OrganizationComputerGroup,
	resolveOrganizationComputerGroups,
} from "./organization-computers";

const COMPUTERS_SERVICE_STATUS_REFETCH_INTERVAL_MS = 10_000;

type ComputerProjectionQueryState = {
	isFetchedAfterMount: boolean;
	isFetching: boolean;
	isPending: boolean;
};

/**
 * Computer detail route owner. `/o/:orgSlug/computers` is now only a legacy
 * handoff that resolves the current Computer and immediately opens its detail.
 * Human-owned Computer lists live in People > Human Profile.
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
	onComputerRouteUnavailable?: () => void;
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
		organizationId: currentOrganization.id,
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
	const organizationProjectionNeedsFreshEvidence =
		needsFreshOrganizationProjection(
			isOrganizationContext,
			organizationDirectoryQuery,
			organizationComputersQuery
		);
	const computerResolutionError = resolveComputerResolutionError([
		recovery.localRuntimesQuery.error,
		...(isOrganizationContext
			? [organizationDirectoryQuery.error, organizationComputersQuery.error]
			: []),
	]);
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
	const computerResolutionIsPending =
		selectedDeviceId !== null &&
		selectedComputer === null &&
		selectedOrganizationComputer === null &&
		(recovery.localRuntimesQuery.isPending ||
			organizationProjectionNeedsFreshEvidence);
	const canResolvePreferredDeviceRoute =
		preferredDeviceId !== null &&
		devices.some((device) => device.deviceId === preferredDeviceId);
	// Any successful inventory snapshot is enough to leave this legacy handoff.
	// People is the canonical Computer home, so a cached empty result may safely
	// return there while a background refresh continues. Setup completion still
	// waits for its explicit reconciliation status below.
	const inventoryIsSettled =
		!recovery.localRuntimesQuery.isPending &&
		recovery.localRuntimesQuery.isSuccess &&
		!recovery.localRuntimesQuery.isError &&
		setupCompleteRefreshStatus !== "pending" &&
		setupCompleteRefreshStatus !== "error";

	useResolvePreferredComputerRoute({
		canResolvePreferredDeviceRoute,
		inventoryIsSettled,
		onComputerRouteResolved: routeState.onComputerRouteResolved,
		preferredDeviceId,
		shouldResolve: selectedDeviceId === null,
	});
	useResolveMissingComputerRoute({
		canResolvePreferredDeviceRoute,
		inventoryIsSettled,
		onComputerRouteUnavailable: routeState.onComputerRouteUnavailable,
		preferredDeviceId,
		shouldResolve: selectedDeviceId === null,
	});
	const ownerProfileId = resolveComputerOwnerProfileId({
		currentUserId,
		directory: organizationDirectoryQuery.data ?? null,
		selectedComputer,
		selectedOrganizationComputer,
	});

	const sectionTitle = resolveComputersSectionTitle({
		hasResolutionError: computerResolutionError !== null,
		isResolutionPending: computerResolutionIsPending,
		selectedOrganizationComputer,
		selectedComputer,
		selectedDeviceId,
	});
	const sectionDescription = resolveComputersSectionDescription({
		hasResolutionError: computerResolutionError !== null,
		isResolutionPending: computerResolutionIsPending,
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
							className={cn(
								APP_INLINE_BACK_LINK_CLASS_NAME,
								"text-foreground hover:text-foreground/80"
							)}
							data-testid="computer-owner-profile-link"
							search={
								ownerProfileId ? { profileId: ownerProfileId } : undefined
							}
							to={buildOrganizationPeoplePath(orgSlug)}
						>
							<ArrowLeftIcon
								aria-hidden="true"
								className="size-4 shrink-0"
								data-icon="inline-start"
							/>
							Back to profile
						</Link>
					</div>
				) : null}
				<ComputersPageBody
					computerGroups={computerGroups}
					computerResolutionIsPending={computerResolutionIsPending}
					isReconcilingCurrentToolsStatus={isReconcilingCurrentToolsStatus}
					onRetry={() => {
						Promise.all([
							recovery.refreshAll(),
							...(isOrganizationContext
								? [
										organizationDirectoryQuery.refetch(),
										organizationComputersQuery.refetch(),
									]
								: []),
						]).catch((error: unknown) => {
							console.error("Failed to refresh Computer details.", error);
						});
					}}
					organizationId={currentOrganization.id}
					orgSlug={orgSlug}
					queryClient={queryClient}
					recovery={recovery}
					resolutionError={
						computerResolutionError ??
						(setupCompleteRefreshStatus === "error"
							? "OpenMeld could not refresh this Computer after setup."
							: null)
					}
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

function needsFreshOrganizationProjection(
	enabled: boolean,
	...queries: readonly ComputerProjectionQueryState[]
): boolean {
	return (
		enabled &&
		queries.some(
			(query) =>
				query.isPending || (query.isFetching && !query.isFetchedAfterMount)
		)
	);
}

function ComputersPageBody(input: {
	computerGroups: readonly OrganizationComputerGroup[];
	computerResolutionIsPending: boolean;
	isReconcilingCurrentToolsStatus: boolean;
	onRetry: () => void;
	orgSlug: string;
	organizationId: string;
	queryClient: ReturnType<typeof useQueryClient>;
	recovery: ReturnType<typeof useLocalAgentRecoveryController>;
	routeState: ComputersRouteState;
	selectedComputer: LocalRuntimeComputer | null;
	selectedDeviceId: string | null;
	selectedOrganizationComputer: OrganizationComputer | null;
	resolutionError: string | null;
	setupCompleteRefreshPending: boolean;
}) {
	if (input.computerResolutionIsPending) {
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
				organizationId={input.organizationId}
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
	if (input.resolutionError) {
		return (
			<ComputerResolutionErrorState
				errorMessage={input.resolutionError}
				onRetry={input.onRetry}
			/>
		);
	}
	if (input.selectedDeviceId !== null) {
		return <ComputerNotFoundState orgSlug={input.orgSlug} />;
	}
	return <SelectedComputerLoading />;
}

// A Computers deep-link can target one current-Computer control. Resolve the
// current connected Computer to its canonical detail route before the reused
// detail panel consumes focus.
function useResolvePreferredComputerRoute(input: {
	canResolvePreferredDeviceRoute: boolean;
	inventoryIsSettled: boolean;
	onComputerRouteResolved?: (deviceId: string) => void;
	preferredDeviceId: string | null;
	shouldResolve: boolean;
}) {
	useEffect(() => {
		if (
			input.shouldResolve &&
			input.inventoryIsSettled &&
			input.preferredDeviceId &&
			input.canResolvePreferredDeviceRoute
		) {
			input.onComputerRouteResolved?.(input.preferredDeviceId);
		}
	}, [
		input.canResolvePreferredDeviceRoute,
		input.inventoryIsSettled,
		input.onComputerRouteResolved,
		input.preferredDeviceId,
		input.shouldResolve,
	]);
}

function useResolveMissingComputerRoute(input: {
	canResolvePreferredDeviceRoute: boolean;
	inventoryIsSettled: boolean;
	onComputerRouteUnavailable?: () => void;
	preferredDeviceId: string | null;
	shouldResolve: boolean;
}) {
	useEffect(() => {
		if (
			input.shouldResolve &&
			input.inventoryIsSettled &&
			!(input.preferredDeviceId && input.canResolvePreferredDeviceRoute)
		) {
			input.onComputerRouteUnavailable?.();
		}
	}, [
		input.canResolvePreferredDeviceRoute,
		input.inventoryIsSettled,
		input.onComputerRouteUnavailable,
		input.preferredDeviceId,
		input.shouldResolve,
	]);
}

function resolveComputerOwnerProfileId(input: {
	currentUserId: string;
	directory: Parameters<
		typeof resolveOrganizationComputerGroups
	>[0]["directory"];
	selectedComputer: LocalRuntimeComputer | null;
	selectedOrganizationComputer: OrganizationComputer | null;
}): string | null {
	const ownerUserId = input.selectedComputer
		? input.currentUserId
		: input.selectedOrganizationComputer?.ownerUserId;
	if (!ownerUserId) {
		return null;
	}
	const ownerMember = input.directory?.members.find(
		(member) => member.userId === ownerUserId
	);
	if (!ownerMember) {
		return null;
	}
	return (
		ownerMember.humanProfile?.profileId ?? `member:${ownerMember.memberId}`
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
	hasResolutionError: boolean;
	isResolutionPending: boolean;
	selectedOrganizationComputer: OrganizationComputer | null;
	selectedComputer: LocalRuntimeComputer | null;
	selectedDeviceId: string | null;
}): string {
	if (input.isResolutionPending) {
		return "Computer";
	}
	if (input.selectedDeviceId === null) {
		if (input.hasResolutionError) {
			return "Computer details are unavailable";
		}
		return "Computer";
	}
	if (
		input.hasResolutionError &&
		!input.selectedComputer &&
		!input.selectedOrganizationComputer
	) {
		return "Computer details are unavailable";
	}
	return (
		input.selectedComputer?.deviceDisplayName ??
		input.selectedOrganizationComputer?.deviceDisplayName ??
		"Computer not found"
	);
}

function resolveComputersSectionDescription(input: {
	hasResolutionError: boolean;
	isResolutionPending: boolean;
	selectedOrganizationComputer: OrganizationComputer | null;
	selectedComputer: LocalRuntimeComputer | null;
	selectedDeviceId: string | null;
}): string {
	if (input.isResolutionPending) {
		return "Opening this computer's details.";
	}
	if (input.selectedDeviceId === null) {
		if (input.hasResolutionError) {
			return "OpenMeld could not load this Computer. Try again to refresh its details.";
		}
		return "Opening this computer's details.";
	}
	if (input.selectedComputer) {
		return formatComputerTabPlatform(input.selectedComputer);
	}
	if (input.selectedOrganizationComputer) {
		return formatOrganizationComputerPlatform(
			input.selectedOrganizationComputer
		);
	}
	if (input.hasResolutionError) {
		return "OpenMeld could not load this Computer. Try again to refresh its details.";
	}
	return "This computer is no longer available in this workspace.";
}

function resolveComputerResolutionError(
	errors: readonly unknown[]
): string | null {
	for (const error of errors) {
		if (error instanceof Error && error.message.trim()) {
			return error.message.trim();
		}
		if (
			typeof error === "object" &&
			error !== null &&
			"message" in error &&
			typeof error.message === "string" &&
			error.message.trim()
		) {
			return error.message.trim();
		}
	}
	return null;
}

function SelectedComputerLoading() {
	return (
		<div className="flex flex-col gap-4" data-testid="computer-detail-loading">
			<Skeleton className="h-56 w-full" />
			<Skeleton className="h-72 w-full" />
		</div>
	);
}

function ComputerResolutionErrorState(input: {
	errorMessage: string;
	onRetry: () => void;
}) {
	return (
		<div className="border border-border/70 bg-card/35 px-4 py-5" role="alert">
			<p className="max-w-xl text-muted-foreground text-sm">
				{input.errorMessage}
			</p>
			<Button
				className="mt-4"
				onClick={input.onRetry}
				size="sm"
				type="button"
				variant="outline"
			>
				Try again
			</Button>
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
				This computer is no longer available. Return to People to choose another
				computer from its owner's profile.
			</p>
			<Link
				className={cn(
					buttonVariants({ size: "sm", variant: "outline" }),
					"mt-4"
				)}
				to={buildOrganizationPeoplePath(input.orgSlug)}
			>
				Back to People
			</Link>
		</div>
	);
}
