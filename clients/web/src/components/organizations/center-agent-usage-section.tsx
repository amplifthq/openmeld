"use client";

import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { Progress } from "@openmeld/ui/components/progress";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
	AgentConfigurationGrid,
	AgentConfigurationReadoutCard,
} from "#/components/profiles/agent-configuration-card";
import { organizationUsageOverviewQueryOptions } from "#/query/organizations/organization-usage";

const USAGE_RESET_TIME_OPTIONS = {
	hour: "2-digit",
	hourCycle: "h23",
	minute: "2-digit",
} as const;

const UTC_USAGE_RESET_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	...USAGE_RESET_TIME_OPTIONS,
	timeZone: "UTC",
});

const BROWSER_USAGE_RESET_TIME_ZONE =
	typeof window === "undefined"
		? "UTC"
		: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const BROWSER_USAGE_RESET_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	...USAGE_RESET_TIME_OPTIONS,
	timeZone: BROWSER_USAGE_RESET_TIME_ZONE,
});

function subscribeToBrowserEnvironment() {
	return () => undefined;
}

function getBrowserEnvironmentSnapshot(): true {
	return true;
}

function getServerEnvironmentSnapshot(): false {
	return false;
}

export function CenterAgentUsageSection(input: {
	isPersonalWorkspace: boolean;
	organizationId: string;
}) {
	const usageQuery = useQuery(
		organizationUsageOverviewQueryOptions({
			organizationId: input.organizationId,
		})
	);

	return (
		<section className="space-y-3">
			<div>
				<h2 className="font-medium text-foreground text-sm">Usage</h2>
				<p className="mt-1 text-muted-foreground text-sm">
					{input.isPersonalWorkspace
						? "See today's AI model costs and current Routine limits."
						: "See today's shared AI model costs and current Routine limits."}
				</p>
			</div>
			<div>
				{usageQuery.isPending ? <UsageLoadingState /> : null}
				{usageQuery.isError ? (
					<UsageErrorState
						isRetrying={usageQuery.isRefetching}
						onRetry={() => {
							usageQuery.refetch().catch((error) => {
								console.error("Failed to refresh Center Agent usage.", error);
							});
						}}
					/>
				) : null}
				{usageQuery.data ? (
					<AgentConfigurationGrid>
						<AiSpendCard data={usageQuery.data.aiSpend} />
						<RoutinesUsageCard data={usageQuery.data.routines} />
					</AgentConfigurationGrid>
				) : null}
			</div>
		</section>
	);
}

function AiSpendCard(input: {
	data: {
		dailyLimitNanoUsd: number | null;
		resetsAt: string;
		usedNanoUsd: number;
		missingCostRequests: number;
		exhausted: boolean;
	};
}) {
	const resetTime = useUsageResetTime(input.data.resetsAt);

	return (
		<AgentConfigurationReadoutCard
			headerAccessory={
				<Badge
					className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
					variant="secondary"
				>
					Free
				</Badge>
			}
			itemId="ai-spend"
			label="AI usage"
		>
			<div className="flex flex-col gap-3">
				<div>
					<p className="font-medium text-2xl text-foreground tabular-nums">
						{formatAiSpend(input.data.usedNanoUsd)}
						{input.data.dailyLimitNanoUsd === null
							? null
							: ` / ${formatAiSpend(input.data.dailyLimitNanoUsd)}`}
					</p>
					<p className="mt-1 text-muted-foreground text-xs">
						Covered by OpenMeld today
					</p>
				</div>
				{input.data.dailyLimitNanoUsd !== null &&
				input.data.dailyLimitNanoUsd > 0 ? (
					<Progress
						aria-label="Shared AI allowance used today"
						max={input.data.dailyLimitNanoUsd}
						value={Math.min(
							input.data.usedNanoUsd,
							input.data.dailyLimitNanoUsd
						)}
					/>
				) : null}
				<div className="space-y-1 text-muted-foreground text-xs">
					<p>Shared by Center Agent and Remote Agents.</p>
					<p>
						{input.data.dailyLimitNanoUsd === null
							? "Free during preview. No daily limit."
							: "Free during preview."}
					</p>
					<p>{resetTime}</p>
					{input.data.missingCostRequests > 0 ? (
						<p>Some model costs are not yet available.</p>
					) : null}
					{input.data.exhausted ? (
						<p>Daily AI allowance used. New requests resume after the reset.</p>
					) : null}
				</div>
			</div>
		</AgentConfigurationReadoutCard>
	);
}

function formatAiSpend(nanoUsd: number): string {
	const usd = nanoUsd / 1_000_000_000;
	return usd > 0 && usd < 0.0001
		? "<$0.0001"
		: new Intl.NumberFormat("en-US", {
				style: "currency",
				currency: "USD",
				minimumFractionDigits: 2,
				maximumFractionDigits: 4,
			}).format(usd);
}

function RoutinesUsageCard(input: {
	data: {
		count: number;
		limit: number;
	};
}) {
	return (
		<AgentConfigurationReadoutCard
			itemId="center-agent-routines"
			label="Routines"
		>
			<div className="flex flex-col gap-3">
				<RoutineUsageRow limit={input.data.limit} value={input.data.count} />
				<p className="text-muted-foreground text-xs">
					All {input.data.limit} Routines can be enabled.
				</p>
				{input.data.count === 0 ? (
					<p className="text-muted-foreground text-xs">
						No routines created yet.
					</p>
				) : null}
			</div>
		</AgentConfigurationReadoutCard>
	);
}

function RoutineUsageRow(input: { limit: number; value: number }) {
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between gap-4 text-xs">
				<p className="font-medium text-foreground">Created</p>
				<p className="text-muted-foreground tabular-nums">
					{input.value} / {input.limit}
				</p>
			</div>
			<Progress
				aria-label="Routines created"
				aria-valuetext={`${input.value} of ${input.limit}`}
				max={input.limit}
				value={input.value}
			/>
		</div>
	);
}

function UsageLoadingState() {
	return (
		<section aria-busy="true" aria-live="polite" className="space-y-3">
			<p className="text-muted-foreground text-sm">Loading usage.</p>
			<AgentConfigurationGrid>
				{["ai-spend", "routines"].map((key) => (
					<AgentConfigurationReadoutCard
						itemId={key}
						key={key}
						label="Loading usage"
					>
						<div>
							<Skeleton className="h-4 w-36" />
							<Skeleton className="h-3 w-64 max-w-full" />
						</div>
						<div className="space-y-4">
							<Skeleton className="h-8 w-24" />
							<Skeleton className="h-1.5 w-full" />
						</div>
					</AgentConfigurationReadoutCard>
				))}
			</AgentConfigurationGrid>
		</section>
	);
}

function UsageErrorState(input: { isRetrying: boolean; onRetry: () => void }) {
	return (
		<section className="rounded-md border border-destructive/50 bg-destructive/5 p-5">
			<h2 className="font-medium text-foreground text-sm">
				Could not load usage
			</h2>
			<p className="mt-2 text-destructive text-sm" role="alert">
				OpenMeld could not load usage. Try again.
			</p>
			<Button
				className="mt-4"
				disabled={input.isRetrying}
				onClick={input.onRetry}
				size="sm"
				type="button"
				variant="outline"
			>
				Retry
			</Button>
		</section>
	);
}

function useUsageResetTime(resetsAt: string): string {
	const canShowBrowserTimeZone = useSyncExternalStore(
		subscribeToBrowserEnvironment,
		getBrowserEnvironmentSnapshot,
		getServerEnvironmentSnapshot
	);

	const date = new Date(resetsAt);
	const utcTime = UTC_USAGE_RESET_TIME_FORMATTER.format(date);
	if (!canShowBrowserTimeZone) {
		return `Resets at ${utcTime} UTC`;
	}

	const localTime = BROWSER_USAGE_RESET_TIME_FORMATTER.format(date);
	return `Resets at ${localTime} (${utcTime} UTC)`;
}
