"use client";

import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Progress } from "@openmeld/ui/components/progress";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
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
		<section className="overflow-hidden rounded-md border border-border/70 bg-card/20">
			<div className="border-border/70 border-b px-5 py-4">
				<h2 className="font-medium text-foreground text-sm">Usage</h2>
				<p className="mt-1 text-muted-foreground text-sm">
					{input.isPersonalWorkspace
						? "See today's Center Agent usage and current Routine limits."
						: "See today's organization-wide Center Agent usage and current Routine limits."}
				</p>
			</div>
			<div className="px-5 py-5">
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
					<div className="grid gap-4 lg:grid-cols-2">
						<CenterAgentWakesCard data={usageQuery.data.centerAgentWakes} />
						<RoutinesUsageCard data={usageQuery.data.routines} />
					</div>
				) : null}
			</div>
		</section>
	);
}

function CenterAgentWakesCard(input: {
	data: {
		dailyLimit: number;
		resetsAt: string;
		usedToday: number;
	};
}) {
	const resetTime = useUsageResetTime(input.data.resetsAt);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Center Agent wakes</CardTitle>
				<CardDescription>Hosted requests admitted today.</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div>
					<p className="font-medium text-2xl text-foreground tabular-nums">
						{input.data.usedToday} / {input.data.dailyLimit}
					</p>
					<p className="mt-1 text-muted-foreground text-xs">used today</p>
				</div>
				<Progress
					aria-label="Center Agent wakes used today"
					aria-valuetext={`${input.data.usedToday} of ${input.data.dailyLimit}`}
					max={input.data.dailyLimit}
					value={input.data.usedToday}
				/>
				<div className="space-y-1 text-muted-foreground text-xs">
					<p>{resetTime}</p>
					{input.data.usedToday === 0 ? (
						<p>No Center Agent wakes used today.</p>
					) : null}
				</div>
			</CardContent>
		</Card>
	);
}

function RoutinesUsageCard(input: {
	data: {
		count: number;
		limit: number;
	};
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Routines</CardTitle>
				<CardDescription>
					Automated work your Center Agent can run on a schedule.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-5">
				<RoutineUsageRow limit={input.data.limit} value={input.data.count} />
				<p className="text-muted-foreground text-xs">
					All {input.data.limit} Routines can be enabled.
				</p>
				{input.data.count === 0 ? (
					<p className="text-muted-foreground text-xs">
						No routines created yet.
					</p>
				) : null}
			</CardContent>
		</Card>
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
			<div className="grid gap-4 lg:grid-cols-2">
				{["center-agent-wakes", "routines"].map((key) => (
					<Card key={key}>
						<CardHeader>
							<Skeleton className="h-4 w-36" />
							<Skeleton className="h-3 w-64 max-w-full" />
						</CardHeader>
						<CardContent className="space-y-4">
							<Skeleton className="h-8 w-24" />
							<Skeleton className="h-1.5 w-full" />
						</CardContent>
					</Card>
				))}
			</div>
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
