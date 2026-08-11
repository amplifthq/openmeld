"use client";

import { Button } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { ArrowClockwiseIcon, ChartBarIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { StaleDataNotice } from "#/components/stale-data-notice";
import { buildOrganizationAgentActivitySessionsPath } from "#/lib/organizations/organization-routes";
import { AgentActivityCoverageNote } from "./agent-activity-coverage-note";
import { formatDuration } from "./agent-activity-derive";
import {
	AgentActivityDataProvider,
	useAgentActivityData,
	useAgentActivityView,
} from "./agent-activity-page";
import { AgentActivityRhythm } from "./agent-activity-rhythm";
import {
	type AgentActivityWindowPreset,
	resolveAgentActivityWindowMs,
} from "./agent-activity-window";
import {
	OrganizationHomeEmpty,
	OrganizationHomeSection,
} from "./organization-home-ui";

const EMPTY_ACTIVITY_FILTERS = { provider: null, status: null } as const;

export function OrganizationHomeActivity(input: {
	headingLevel?: 2 | 3;
	organizationId: string;
	organizationSlug: string;
}) {
	return (
		<AgentActivityDataProvider
			organizationId={input.organizationId}
			projectFilterMode="organization"
			statsEnabled={false}
		>
			<OrganizationHomeActivityContent
				headingLevel={input.headingLevel}
				organizationSlug={input.organizationSlug}
			/>
		</AgentActivityDataProvider>
	);
}

function OrganizationHomeActivityContent(input: {
	headingLevel?: 2 | 3;
	organizationSlug: string;
}) {
	const navigate = useNavigate();
	const data = useAgentActivityData();
	const [windowPreset, setWindowPreset] =
		useState<AgentActivityWindowPreset>("4h");
	const view = useAgentActivityView(
		EMPTY_ACTIVITY_FILTERS,
		resolveAgentActivityWindowMs(windowPreset, data.currentTimeMs)
	);
	const activityIsStale =
		data.snapshotQuery.isError || view?.freshness.isStale === true;

	return (
		<OrganizationHomeSection
			className="h-full grid-rows-[auto_minmax(0,1fr)]"
			headingLevel={input.headingLevel}
			title="Agent Activity"
		>
			{data.snapshotQuery.isPending ? (
				<OrganizationHomeActivitySkeleton />
			) : null}
			{data.snapshotQuery.isError && !data.snapshotQuery.data ? (
				<div className="grid min-h-64 place-items-center rounded-lg border border-border/70 bg-card p-6 text-center">
					<div>
						<p className="text-muted-foreground text-sm">
							Couldn’t load Agent Activity.
						</p>
						<Button
							className="mt-3"
							onClick={() => data.snapshotQuery.refetch()}
							size="sm"
							variant="outline"
						>
							<ArrowClockwiseIcon aria-hidden="true" />
							Try again
						</Button>
					</div>
				</div>
			) : null}
			{data.snapshotQuery.data && view ? (
				<div
					className={
						activityIsStale
							? "grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3"
							: "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3"
					}
				>
					{activityIsStale ? (
						<StaleDataNotice
							className="mx-0 mt-0 rounded-lg bg-card"
							label={
								data.snapshotQuery.isError
									? "Agent Activity couldn’t refresh. Showing the latest available data."
									: "Agent Activity may be out of date."
							}
							onRetry={() => data.snapshotQuery.refetch()}
						/>
					) : null}
					<div className="grid gap-1.5">
						<ActivityStats isStale={activityIsStale} view={view} />
						{data.snapshotQuery.data.sessionsTruncated ? (
							<AgentActivityCoverageNote className="px-1" />
						) : null}
					</div>
					{view.setupState === "no_projects" ? (
						<div className="h-full rounded-lg border border-border/70 bg-card">
							<OrganizationHomeEmpty
								actionHref={buildOrganizationAgentActivitySessionsPath(
									input.organizationSlug
								)}
								actionLabel="Open Agent Activity"
								icon={<ChartBarIcon aria-hidden="true" className="size-4" />}
								label="No activity yet"
							/>
						</div>
					) : (
						<AgentActivityRhythm
							onMemberClick={(memberUserId) => {
								const path = buildOrganizationAgentActivitySessionsPath(
									input.organizationSlug
								);
								const search = new URLSearchParams({ member: memberUserId });
								navigate({ to: `${path}?${search.toString()}` }).catch(
									(error: unknown) => {
										console.error(
											"Failed to open Agent Activity sessions.",
											error
										);
									}
								);
							}}
							onWindowChange={setWindowPreset}
							snapshot={data.snapshotQuery.data}
							view={view}
							windowPreset={windowPreset}
						/>
					)}
				</div>
			) : null}
		</OrganizationHomeSection>
	);
}

function ActivityStats(input: {
	isStale: boolean;
	view: NonNullable<ReturnType<typeof useAgentActivityView>>;
}) {
	const stats = [
		{
			label: input.isStale ? "Last known working" : "Working now",
			value: String(input.view.stats.workingNow),
		},
		{
			label: input.isStale ? "Last known agent time" : "Agent time today",
			value: formatDuration(input.view.stats.agentTimeTodayMs),
		},
		{
			label: input.isStale ? "Last known sessions" : "Sessions today",
			value: String(input.view.stats.sessionsToday),
		},
	] as const;
	return (
		<dl className="grid grid-cols-3 overflow-hidden rounded-lg border border-border/70 bg-card">
			{stats.map((stat, index) => (
				<div
					className={index > 0 ? "border-border/70 border-s" : undefined}
					key={stat.label}
				>
					<div className="px-3 py-3 sm:px-4">
						<dt className="truncate text-[11px] text-muted-foreground sm:text-xs">
							{stat.label}
						</dt>
						<dd className="mt-1 truncate font-medium font-mono text-base tabular-nums sm:text-lg">
							{stat.value}
						</dd>
					</div>
				</div>
			))}
		</dl>
	);
}

function OrganizationHomeActivitySkeleton() {
	return (
		<div aria-busy="true" className="grid gap-3">
			<span className="sr-only">Loading Agent Activity</span>
			<Skeleton className="h-20 w-full rounded-lg motion-reduce:animate-none" />
			<Skeleton className="h-72 w-full rounded-lg motion-reduce:animate-none" />
		</div>
	);
}
