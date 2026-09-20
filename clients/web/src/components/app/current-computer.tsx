"use client";

import type {
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalRuntimeComputer,
	LocalRuntimesResponse,
} from "@openmeld/schemas/types";
import { buttonVariants } from "@openmeld/ui/components/button";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { resolveStatusToneIndicatorClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { DesktopTowerIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext, useEffect } from "react";
import { resolveCurrentExecutionTarget } from "#/components/agents/agents-page-computer";
import { useLocalRuntimeQueries } from "#/components/agents/use-local-runtime-queries";
import { useStartFlowState } from "#/components/app/start-flow-state";
import {
	type ComputerSummaryStatus,
	resolveCurrentLocalRuntimeComputerSummaryStatus,
	resolveCurrentLocalRuntimeSubjectDeviceId,
} from "#/lib/computer-summary-status";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationComputerPath,
	buildOrganizationComputersPath,
} from "#/lib/organizations/organization-routes";
import {
	type CurrentComputerToolbarDisplaySnapshot,
	createCurrentComputerToolbarDisplaySnapshot,
	currentComputerToolbarDisplaySnapshotQueryOptions,
	readCurrentComputerToolbarAttention,
} from "#/query/connect/current-computer-toolbar-display-snapshot";
import { startQueryKeys } from "#/query/query-keys";

type CurrentComputerPresentation = {
	attentionLabel?: string;
	status: ComputerSummaryStatus | null;
	destination?: string;
	deviceLabel: string;
	statusLabel: string;
	accessibleLabel: string;
};
const CurrentComputerContext =
	createContext<CurrentComputerPresentation | null>(null);

export function CurrentComputerProvider(input: { children: ReactNode }) {
	const organization = useOptionalAppOrganization();
	if (!organization) {
		return input.children;
	}
	return (
		<CurrentComputerProviderContent
			orgSlug={organization.currentOrganization.slug}
		>
			{input.children}
		</CurrentComputerProviderContent>
	);
}
function CurrentComputerProviderContent(input: {
	orgSlug: string;
	children: ReactNode;
}) {
	const presentation = useCurrentComputerPresentation(input.orgSlug);
	const value = {
		...presentation,
		attentionLabel:
			presentation.status?.tone === "warning" ||
			presentation.status?.tone === "danger"
				? presentation.accessibleLabel
				: undefined,
	};
	return (
		<CurrentComputerContext.Provider value={value}>
			{input.children}
		</CurrentComputerContext.Provider>
	);
}
export function useCurrentComputer() {
	return useContext(CurrentComputerContext);
}

function useCurrentComputerPresentation(
	orgSlug: string
): CurrentComputerPresentation {
	const { state, storageScope } = useStartFlowState();
	const displaySnapshotQuery = useQuery(
		currentComputerToolbarDisplaySnapshotQueryOptions({ storageScope })
	);
	const runtimeQueries = useLocalRuntimeQueries({
		storageScope,
		selection: "browser",
		selectedHumanProfileId: state.selectedHumanProfileId,
	});

	const readinessQuery = runtimeQueries.currentLocalRuntimeReplyReadinessQuery;
	const inventory = runtimeQueries.localRuntimesQuery.data;
	const { computer, deviceId, readiness } =
		resolveCurrentComputerToolbarSubject({
			inventory,
			readiness: readinessQuery.data,
		});
	const isReconciling = Boolean(
		runtimeQueries.localRuntimesQuery.isFetching ||
			(readinessQuery.isFetching &&
				(!readiness || readiness.service.connected === true))
	);
	const liveStatus = resolveCurrentLocalRuntimeComputerSummaryStatus({
		executionTarget: resolveComputerExecutionTarget(computer),
		isReconcilingStatus: isReconciling,
		readiness,
	});
	const restoredCurrentComputer =
		displaySnapshotQuery.data?.currentComputer ?? null;
	const restoredStatus = readCurrentComputerToolbarAttention(
		displaySnapshotQuery.data
	);
	const canUseRestoredStatus = shouldUseRestoredCurrentComputerStatus({
		deviceId,
		hasLiveReadiness: Boolean(readiness),
		isReadinessError: readinessQuery.isError,
		isReadinessLoading: readinessQuery.isPending || readinessQuery.isFetching,
		restoredDeviceId: restoredCurrentComputer?.deviceId ?? null,
	});
	const status = liveStatus ?? (canUseRestoredStatus ? restoredStatus : null);
	usePersistCurrentComputerToolbarDisplaySnapshot({
		deviceId,
		hasLiveReadiness: Boolean(readiness),
		inventoryResolved: runtimeQueries.localRuntimesQuery.isSuccess,
		status: liveStatus,
		storageScope,
	});

	if (!inventory) {
		return unresolvedComputerPresentation(
			runtimeQueries.localRuntimesQuery.isError,
			restoredStatus,
			orgSlug
		);
	}

	const destination = deviceId
		? buildOrganizationComputerPath({
				deviceId,
				orgSlug,
			})
		: buildConnectComputerPath({
				orgSlug,
				session: "fresh",
			});
	const deviceLabel = computer?.deviceDisplayName ?? "Computer";
	const statusLabel =
		status?.label ?? (deviceId ? "Connection status delayed" : "Not connected");
	const accessibleLabel = deviceId
		? `Open ${deviceLabel} details, ${statusLabel}`
		: "Connect this Computer";

	return { status, destination, deviceLabel, statusLabel, accessibleLabel };
}
export function CurrentComputerToolbarLauncher() {
	const computer = useCurrentComputer();
	if (!computer) {
		return null;
	}
	const { status, destination, deviceLabel, statusLabel, accessibleLabel } =
		computer;
	if (!destination) {
		return (
			<CurrentComputerToolbarStatus
				accessibleLabel={accessibleLabel}
				attention={status}
				statusLabel={statusLabel}
			/>
		);
	}

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Link
						aria-label={accessibleLabel}
						className={cn(
							buttonVariants({ size: "sm", variant: "ghost" }),
							"pointer-events-auto min-w-0 border-0 bg-transparent px-2 text-muted-foreground shadow-none transition-colors duration-100 hover:bg-muted hover:text-foreground motion-reduce:transition-none dark:bg-transparent dark:hover:bg-muted/50"
						)}
						data-testid="current-computer-toolbar-launcher"
						to={destination}
					/>
				}
			>
				<DesktopTowerIcon aria-hidden="true" className="size-3.5" />
				<span>Computer</span>
				<CurrentComputerAttentionIndicator status={status} />
			</TooltipTrigger>
			<TooltipContent align="start" className="text-left" side="top">
				<span className="inline-flex items-center gap-1.5">
					{status?.localAgent ? (
						<LocalAgentLogo agentId={status.localAgent.agentId} size="xs" />
					) : null}
					<span>
						{deviceLabel} · {statusLabel}
					</span>
				</span>
			</TooltipContent>
		</Tooltip>
	);
}

function resolveCurrentComputerToolbarSubject(input: {
	inventory: LocalRuntimesResponse | undefined;
	readiness: CurrentLocalRuntimeReplyReadinessResponse | undefined;
}): {
	computer: LocalRuntimeComputer | null;
	deviceId: string | null;
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null;
} {
	const readinessDeviceId = resolveCurrentLocalRuntimeSubjectDeviceId(
		input.readiness
	);
	const readinessComputer = readinessDeviceId
		? (input.inventory?.localRuntimes.find(
				(candidate) => candidate.deviceId === readinessDeviceId
			) ?? null)
		: null;
	const inventoryCurrentComputer = input.inventory?.currentDeviceId
		? (input.inventory.localRuntimes.find(
				(candidate) => candidate.deviceId === input.inventory?.currentDeviceId
			) ?? null)
		: null;
	const deviceId =
		readinessComputer?.deviceId ??
		inventoryCurrentComputer?.deviceId ??
		input.inventory?.localRuntimes.find((computer) => computer.isCurrent)
			?.deviceId ??
		null;
	const computer = deviceId
		? (input.inventory?.localRuntimes.find(
				(candidate) => candidate.deviceId === deviceId
			) ?? null)
		: null;
	return {
		computer,
		deviceId,
		readiness:
			readinessDeviceId === deviceId ? (input.readiness ?? null) : null,
	};
}

function resolveComputerExecutionTarget(
	computer: Parameters<typeof resolveCurrentExecutionTarget>[0] | null
) {
	return computer ? resolveCurrentExecutionTarget(computer) : null;
}

function resolveUnresolvedCurrentComputerAccessibleLabel(input: {
	attention: ComputerSummaryStatus | null;
	inventoryFailed: boolean;
}): string {
	if (input.attention) {
		return `Computer, ${input.attention.label}`;
	}
	if (input.inventoryFailed) {
		return "Open Computers; couldn’t load Computer status";
	}
	return "Checking this Computer";
}

function CurrentComputerToolbarStatus(input: {
	accessibleLabel: string;
	attention: ComputerSummaryStatus | null;
	destination?: string;
	statusLabel: string;
}) {
	const trigger = input.destination ? (
		<Link
			aria-label={input.accessibleLabel}
			className={cn(
				buttonVariants({ size: "sm", variant: "ghost" }),
				"pointer-events-auto min-w-0 border-0 bg-transparent px-2 text-muted-foreground shadow-none transition-colors duration-100 hover:bg-muted hover:text-foreground motion-reduce:transition-none dark:bg-transparent dark:hover:bg-muted/50"
			)}
			data-testid="current-computer-toolbar-launcher"
			to={input.destination}
		/>
	) : (
		<output
			aria-label={input.accessibleLabel}
			className={cn(
				buttonVariants({ size: "sm", variant: "ghost" }),
				"pointer-events-auto min-w-0 border-0 bg-transparent px-2 text-muted-foreground shadow-none dark:bg-transparent"
			)}
			data-testid="current-computer-toolbar-launcher"
		/>
	);
	return (
		<Tooltip>
			<TooltipTrigger render={trigger}>
				<DesktopTowerIcon aria-hidden="true" className="size-3.5" />
				<span>Computer</span>
				<CurrentComputerAttentionIndicator status={input.attention} />
			</TooltipTrigger>
			<TooltipContent align="start" className="text-left" side="top">
				Computer · {input.statusLabel}
			</TooltipContent>
		</Tooltip>
	);
}

export function CurrentComputerAttentionIndicator(input: {
	status: ComputerSummaryStatus | null;
}) {
	if (
		!input.status ||
		(input.status.reason !== "service_not_connected" &&
			input.status.tone !== "warning" &&
			input.status.tone !== "danger")
	) {
		return null;
	}
	return (
		<span
			aria-hidden="true"
			className={cn(
				"status-dot",
				resolveStatusToneIndicatorClassName(input.status.tone, "quiet")
			)}
			data-testid="current-computer-toolbar-status"
		/>
	);
}

function areCurrentComputerToolbarSnapshotsEqual(
	left: CurrentComputerToolbarDisplaySnapshot | undefined,
	right: CurrentComputerToolbarDisplaySnapshot
): boolean {
	if (left?.currentComputer === null || right.currentComputer === null) {
		return left?.currentComputer === right.currentComputer;
	}
	return (
		left?.currentComputer?.deviceId === right.currentComputer.deviceId &&
		left.currentComputer.attention?.reason ===
			right.currentComputer.attention?.reason &&
		left.currentComputer.attention?.tone ===
			right.currentComputer.attention?.tone
	);
}

function usePersistCurrentComputerToolbarDisplaySnapshot(input: {
	deviceId: string | null;
	hasLiveReadiness: boolean;
	inventoryResolved: boolean;
	status: ComputerSummaryStatus | null;
	storageScope: string;
}) {
	const queryClient = useQueryClient();
	useEffect(() => {
		if (!input.inventoryResolved) {
			return;
		}
		if (input.deviceId && !input.hasLiveReadiness) {
			return;
		}
		const nextSnapshot = createCurrentComputerToolbarDisplaySnapshot({
			deviceId: input.deviceId,
			status: input.status,
		});
		queryClient.setQueryData<CurrentComputerToolbarDisplaySnapshot>(
			startQueryKeys.currentComputerToolbarDisplaySnapshot(input.storageScope),
			(currentSnapshot) =>
				areCurrentComputerToolbarSnapshotsEqual(currentSnapshot, nextSnapshot)
					? currentSnapshot
					: nextSnapshot
		);
	}, [
		input.deviceId,
		input.hasLiveReadiness,
		input.inventoryResolved,
		input.status,
		input.storageScope,
		queryClient,
	]);
}

function shouldUseRestoredCurrentComputerStatus(input: {
	deviceId: string | null;
	hasLiveReadiness: boolean;
	isReadinessError: boolean;
	isReadinessLoading: boolean;
	restoredDeviceId: string | null;
}): boolean {
	return Boolean(
		input.deviceId &&
			input.restoredDeviceId === input.deviceId &&
			!input.hasLiveReadiness &&
			!input.isReadinessError &&
			input.isReadinessLoading
	);
}

function unresolvedComputerPresentation(
	inventoryFailed: boolean,
	restoredStatus: ComputerSummaryStatus | null,
	orgSlug: string
): CurrentComputerPresentation {
	const attention = inventoryFailed ? null : restoredStatus;
	return {
		status: attention,
		destination: inventoryFailed
			? buildOrganizationComputersPath(orgSlug)
			: undefined,
		deviceLabel: "Computer",
		statusLabel:
			attention?.label ??
			(inventoryFailed ? "Couldn’t load Computer status" : "Checking status"),
		accessibleLabel: resolveUnresolvedCurrentComputerAccessibleLabel({
			attention,
			inventoryFailed,
		}),
	};
}
