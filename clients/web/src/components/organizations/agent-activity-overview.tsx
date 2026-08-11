import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { resolveStatusToneIndicatorClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowRightIcon, InfoIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { AgentActivityCoverageNote } from "./agent-activity-coverage-note";
import type { ActivityView } from "./agent-activity-derive";
import {
	useAgentActivityData,
	useAgentActivityView,
} from "./agent-activity-page";
import { AgentActivityRhythm } from "./agent-activity-rhythm";
import { AgentActivitySessionTable } from "./agent-activity-session-table";
import {
	AgentActivityAwaitingFirstSession,
	AgentActivityNoProjectsSetup,
} from "./agent-activity-setup";
import {
	type AgentActivityWindowPreset,
	resolveAgentActivityWindowMs,
} from "./agent-activity-window";

const HOUR_MS = 60 * 60_000;
const EMPTY_FILTERS = { provider: null, status: null };
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "short",
	year: "numeric",
});
const HOUR_FORMATTER = new Intl.NumberFormat("en-US");
const PEAK_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	hour: "2-digit",
	hourCycle: "h23",
	minute: "2-digit",
});

export function AgentActivityOverview(input: {
	canManage: boolean;
	onNavigateToSessions: (search: { member?: string }) => void;
}) {
	const data = useAgentActivityData();
	const [windowPreset, setWindowPreset] =
		useState<AgentActivityWindowPreset>("4h");
	const windowMs = resolveAgentActivityWindowMs(
		windowPreset,
		data.currentTimeMs
	);
	const view = useAgentActivityView(EMPTY_FILTERS, windowMs);
	const successfulView = data.snapshotQuery.isSuccess ? view : null;
	if (successfulView?.setupState === "no_projects") {
		return <AgentActivityNoProjectsSetup canManage={input.canManage} />;
	}
	const firstActiveProject = data.projects.find(
		(project) => project.archivedAtMs === null
	);
	return (
		<div className="grid gap-6">
			{successfulView?.setupState === "awaiting_first_session" &&
			firstActiveProject ? (
				<AgentActivityAwaitingFirstSession />
			) : null}
			<OverviewStats
				sessionsTruncated={data.snapshotQuery.data?.sessionsTruncated === true}
				view={view}
			/>
			{view && data.snapshotQuery.data ? (
				<AgentActivityRhythm
					onMemberClick={(memberUserId) =>
						input.onNavigateToSessions({ member: memberUserId })
					}
					onWindowChange={setWindowPreset}
					snapshot={data.snapshotQuery.data}
					view={view}
					windowPreset={windowPreset}
				/>
			) : null}
			<RecentSessions
				onViewAll={() => input.onNavigateToSessions({})}
				view={view}
			/>
		</div>
	);
}

function OverviewStats(input: {
	sessionsTruncated: boolean;
	view: ActivityView | null;
}) {
	const data = useAgentActivityData();
	const peak = input.view?.stats.peakConcurrency;
	const cards = [
		{
			footer: `peak ${String(peak?.count ?? 0)} · ${formatPeakTime(peak?.atMs ?? null)}`,
			key: "working-now",
			label: "Working now",
			tooltip:
				"Current sessions with fresh active evidence. Peak concurrency scans today's overlapping session spans.",
			value: input.view ? String(input.view.stats.workingNow) : "—",
			working: (input.view?.stats.workingNow ?? 0) > 0,
		},
		{
			footer: null,
			key: "agent-time-today",
			label: "Agent time today",
			tooltip:
				"The sum of session spans that overlap today. Parallel sessions are added together.",
			value: input.view
				? formatSpanDuration(input.view.stats.agentTimeTodayMs)
				: "—",
			working: false,
		},
		{
			footer: data.statsQuery.data?.sinceMs
				? `since ${formatDate(data.statsQuery.data.sinceMs)} · updated daily`
				: "updated daily",
			key: "earlier-agent-time",
			label: "Earlier agent time",
			loading: data.statsQuery.isPending,
			tooltip: "Agent time from completed daily records. Updated once a day.",
			value: data.statsQuery.data
				? formatTotalAgentTime(data.statsQuery.data.totalActiveDurationMs)
				: "—",
			working: false,
		},
		{
			footer: `busiest: ${input.view?.stats.busiestProject?.name ?? "—"}`,
			key: "sessions-today",
			label: "Sessions today",
			tooltip:
				"Sessions that were observed or started today in your local time.",
			value: input.view ? String(input.view.stats.sessionsToday) : "—",
			working: false,
		},
	];
	return (
		<section
			aria-label="Agent Activity overview statistics"
			className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
		>
			{cards.map((card) => (
				<Card className="rounded-md py-0" key={card.key}>
					<CardHeader className="gap-2 pt-4 pb-3">
						<CardDescription>
							<StatLabel label={card.label} tooltip={card.tooltip} />
						</CardDescription>
						<CardTitle className="flex items-center gap-2 font-mono text-2xl tabular-nums">
							{"loading" in card && card.loading ? (
								<Skeleton className="h-7 w-20" />
							) : (
								card.value
							)}
							{card.working ? (
								<span
									aria-label="Currently active"
									className={cn(
										"agent-activity-presence-breathe size-2",
										resolveStatusToneIndicatorClassName("ready", "solid")
									)}
									role="img"
								/>
							) : null}
						</CardTitle>
					</CardHeader>
					{card.footer ? (
						<CardFooter className="min-h-9 border-t px-4 py-2 font-mono text-muted-foreground text-xs tabular-nums">
							<span className="truncate">{card.footer}</span>
						</CardFooter>
					) : null}
				</Card>
			))}
			{input.sessionsTruncated ? (
				<AgentActivityCoverageNote className="sm:col-span-2 xl:col-span-4" />
			) : null}
		</section>
	);
}

function StatLabel(input: { label: string; tooltip: string }) {
	return (
		<span className="inline-flex items-center gap-1">
			{input.label}
			<Tooltip>
				<TooltipTrigger
					aria-label={`About ${input.label}`}
					className="text-muted-foreground outline-none focus-visible:text-foreground"
				>
					<InfoIcon aria-hidden="true" className="size-3" />
				</TooltipTrigger>
				<TooltipContent>{input.tooltip}</TooltipContent>
			</Tooltip>
		</span>
	);
}

function RecentSessions(input: {
	onViewAll: () => void;
	view: ActivityView | null;
}) {
	const data = useAgentActivityData();
	const sessions = (input.view?.sessions ?? [])
		.slice()
		.sort((left, right) => right.lastObservedAtMs - left.lastObservedAtMs)
		.slice(0, 10);
	return (
		<Card className="rounded-md py-0">
			<CardHeader className="border-b py-3">
				<CardTitle>Recent sessions</CardTitle>
				<CardDescription>Newest observed sessions</CardDescription>
			</CardHeader>
			<CardContent className="px-0">
				<AgentActivitySessionTable
					emptyMessage="No sessions yet."
					membersByUserId={data.membersByUserId}
					mode="recent"
					nowMs={data.currentTimeMs}
					projects={data.projects}
					sessions={sessions}
				/>
			</CardContent>
			<CardFooter className="justify-end border-t px-3 py-2">
				<Button onClick={input.onViewAll} size="sm" variant="link">
					View all sessions <ArrowRightIcon aria-hidden="true" />
				</Button>
			</CardFooter>
		</Card>
	);
}

function formatSpanDuration(durationMs: number) {
	const totalMinutes = Math.floor(durationMs / 60_000);
	if (totalMinutes === 0) {
		return durationMs > 0 ? "<1m" : "0m";
	}
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours === 0) {
		return `${String(minutes)}m`;
	}
	return minutes === 0
		? `${String(hours)}h`
		: `${String(hours)}h ${String(minutes)}m`;
}

function formatTotalAgentTime(durationMs: number) {
	const hours = Math.round(durationMs / HOUR_MS);
	return `${HOUR_FORMATTER.format(hours)}h`;
}

function formatDate(timestampMs: number) {
	return DATE_FORMATTER.format(new Date(timestampMs));
}

function formatPeakTime(timestampMs: number | null) {
	if (timestampMs === null) {
		return "—";
	}
	return PEAK_TIME_FORMATTER.format(new Date(timestampMs));
}
