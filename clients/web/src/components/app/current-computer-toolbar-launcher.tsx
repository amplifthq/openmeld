"use client";

import { buttonVariants } from "@openmeld/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { resolveStatusToneIndicatorClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { DesktopTowerIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useLocalRuntimeQueries } from "#/components/agents/use-local-runtime-queries";
import { useStartFlowState } from "#/components/app/start-flow-state";
import {
	resolveCurrentLocalRuntimeComputerSummaryStatus,
	resolveCurrentLocalRuntimeSubjectDeviceId,
} from "#/lib/computer-summary-status";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationComputerPath } from "#/lib/organizations/organization-routes";

export function CurrentComputerToolbarLauncher() {
	const organizationContext = useOptionalAppOrganization();
	if (!organizationContext) {
		return null;
	}
	return (
		<CurrentComputerToolbarLauncherContent
			orgSlug={organizationContext.currentOrganization.slug}
		/>
	);
}

function CurrentComputerToolbarLauncherContent(input: { orgSlug: string }) {
	const { storageScope } = useStartFlowState();
	const runtimeQueries = useLocalRuntimeQueries({ storageScope });

	const readinessQuery = runtimeQueries.currentLocalRuntimeReplyReadinessQuery;
	const inventory = runtimeQueries.localRuntimesQuery.data;
	const deviceId =
		resolveCurrentLocalRuntimeSubjectDeviceId(readinessQuery.data) ??
		inventory?.currentDeviceId ??
		inventory?.localRuntimes.find((computer) => computer.isCurrent)?.deviceId ??
		null;
	const computer = deviceId
		? (inventory?.localRuntimes.find(
				(candidate) => candidate.deviceId === deviceId
			) ?? null)
		: null;
	const isReconciling =
		readinessQuery.isFetching && !readinessQuery.isFetchedAfterMount;
	const status = resolveCurrentLocalRuntimeComputerSummaryStatus({
		isReconcilingStatus: isReconciling,
		readiness: readinessQuery.data,
	});
	const destination = deviceId
		? buildOrganizationComputerPath({
				deviceId,
				orgSlug: input.orgSlug,
			})
		: buildConnectComputerPath({
				orgSlug: input.orgSlug,
				session: "fresh",
			});
	const deviceLabel = computer?.deviceDisplayName ?? "Computer";
	const statusLabel =
		status?.label ?? (deviceId ? "Status unavailable" : "Not connected");
	const accessibleLabel = deviceId
		? `Open ${deviceLabel} details, ${statusLabel}`
		: "Connect this Computer";

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
				{status?.tone === "warning" || status?.tone === "danger" ? (
					<span
						aria-hidden="true"
						className={cn(
							"size-2 shrink-0 rounded-full ring-2 ring-background",
							resolveStatusToneIndicatorClassName(status.tone, "quiet")
						)}
						data-testid="current-computer-toolbar-status"
					/>
				) : null}
			</TooltipTrigger>
			<TooltipContent side="top">
				{deviceLabel} · {statusLabel}
			</TooltipContent>
		</Tooltip>
	);
}
