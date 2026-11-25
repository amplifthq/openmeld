import { Button } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { SkeletonRegion } from "@openmeld/ui/components/skeleton-content";
import { FileTextIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import {
	deriveActivityFeed,
	formatRelativeTime,
} from "#/components/organizations/agent-activity-derive";
import { useNowMs } from "#/lib/spaces/use-now-ms";
import {
	agentActivitySessionsQueryOptions,
	agentActivitySnapshotQueryOptions,
} from "#/query/organizations/agent-activity";
import { organizationAgentRuntimeOverviewQueryOptions } from "#/query/organizations/organization-directory";

const RECENT_ACTIVITY_LIMIT = 6;

type ActivityRow = {
	id: string;
	label: string;
	project?: string;
	timeMs: number;
};

export function TeamPersonActivity(input: {
	lastActiveAt?: string | null;
	organizationId: string;
	userId: string;
}) {
	const activity = useQuery(
		agentActivitySnapshotQueryOptions({
			memberUserId: input.userId,
			organizationId: input.organizationId,
		})
	);
	const snapshot =
		activity.data?.organizationId === input.organizationId
			? activity.data
			: undefined;
	const items = snapshot
		? deriveActivityFeed({
				filters: {
					memberUserId: input.userId,
					projectId: null,
					provider: null,
					status: null,
				},
				projectsById: new Map(
					snapshot.projects.map((project) => [project.id, project])
				),
				recentEvents: snapshot.recentEvents,
			}).items
		: [];
	const rows: ActivityRow[] = items
		.slice(0, RECENT_ACTIVITY_LIMIT)
		.map((item) => ({
			id: item.eventId,
			label: item.verb.charAt(0).toUpperCase() + item.verb.slice(1),
			project: item.projectName,
			timeMs: item.event.observedAtMs,
		}));
	const lastActiveAt = Date.parse(input.lastActiveAt ?? "");
	if (Number.isFinite(lastActiveAt)) {
		rows.push({
			id: "last-active",
			label: "Last activity in OpenMeld",
			timeMs: lastActiveAt,
		});
	}
	return (
		<TeamRecentActivity
			error={activity.isError}
			loading={activity.isPending}
			onRetry={() => activity.refetch()}
			rows={rows
				.sort((left, right) => right.timeMs - left.timeMs)
				.slice(0, RECENT_ACTIVITY_LIMIT)}
		/>
	);
}

export function TeamAgentActivity(input: {
	organizationId: string;
	profileId: string;
	lastTaskActivityAt?: string | null;
}) {
	const runtime = useQuery(
		organizationAgentRuntimeOverviewQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const agent = runtime.data?.agentProfiles.find(
		(profile) => profile.profileId === input.profileId
	);
	const binding = agent?.readiness.primaryBinding;
	const nativeSessionId =
		binding?.bindingState === "enabled_primary"
			? binding.executionTarget?.agentControllerConversationId
			: undefined;
	const sessions = useQuery(
		agentActivitySessionsQueryOptions({
			enabled: Boolean(nativeSessionId),
			limit: RECENT_ACTIVITY_LIMIT,
			nativeSessionId,
			organizationId: input.organizationId,
		})
	);
	// An exact native id can exist for multiple peers or controllers. Only the
	// inventory's authoritative Binding can attribute a Project to this Agent.
	const projects = new Map<string, ActivityRow>();
	for (const session of sessions.data?.sessions ?? []) {
		if (
			session.boundAgentProfileId === input.profileId &&
			!projects.has(session.project.id)
		) {
			projects.set(session.project.id, {
				id: session.project.id,
				label: "Project activity",
				project: session.project.name,
				timeMs: session.lastActiveAtMs,
			});
		}
	}
	const rows = [...projects.values()];
	const lastTaskAt = Date.parse(
		(agent ? agent.lastTaskActivityAt : input.lastTaskActivityAt) ?? ""
	);
	if (Number.isFinite(lastTaskAt)) {
		rows.push({
			id: "last-task",
			label: "Last recorded task activity",
			timeMs: lastTaskAt,
		});
	}
	return (
		<TeamRecentActivity
			error={runtime.isError || (Boolean(nativeSessionId) && sessions.isError)}
			loading={
				runtime.isPending || (Boolean(nativeSessionId) && sessions.isPending)
			}
			onRetry={() => {
				if (runtime.isError) {
					runtime.refetch();
				}
				if (nativeSessionId && sessions.isError) {
					sessions.refetch();
				}
			}}
			rows={rows.sort((left, right) => right.timeMs - left.timeMs)}
		/>
	);
}

function TeamRecentActivity(input: {
	rows: readonly ActivityRow[];
	error: boolean;
	loading: boolean;
	onRetry: () => void;
}) {
	const now = useNowMs(input.rows.length ? 60_000 : null);
	return (
		<section aria-labelledby="team-recent-activity" className="space-y-3">
			<h3 className="font-semibold text-base" id="team-recent-activity">
				Recent activity
			</h3>
			{input.error && (
				<TeamReadError
					label={
						input.rows.length
							? "Couldn’t refresh recent activity."
							: "Couldn’t load recent activity."
					}
					onRetry={input.onRetry}
				/>
			)}
			{input.rows.length > 0 ? (
				<ul className="divide-y divide-border/60">
					{input.rows.map((row) => (
						<li className="flex min-w-0 items-center gap-3 py-3" key={row.id}>
							<FileTextIcon
								aria-hidden="true"
								className="size-4 shrink-0 text-muted-foreground"
							/>
							<div className="min-w-0 flex-1">
								<p className="break-words font-medium text-sm">{row.label}</p>
								{row.project && (
									<p className="truncate text-muted-foreground text-xs">
										{row.project}
									</p>
								)}
							</div>
							<time
								className="shrink-0 text-muted-foreground text-xs"
								dateTime={new Date(row.timeMs).toISOString()}
							>
								{formatRelativeTime(row.timeMs, now)}
							</time>
						</li>
					))}
				</ul>
			) : (
				<TeamReadEmpty
					empty="No recent activity to show."
					loading={input.loading}
					pendingLabel="Loading recent activity"
					showEmpty={!input.error}
				/>
			)}
		</section>
	);
}

export function TeamTopics({ organizationId }: { organizationId: string }) {
	const activity = useQuery(
		agentActivitySnapshotQueryOptions({ organizationId })
	);
	const snapshot =
		activity.data?.organizationId === organizationId
			? activity.data
			: undefined;
	const projects = new Map(
		snapshot?.projects.map((project) => [project.id, project])
	);
	const summaries = (snapshot?.digests ?? []).filter(
		(digest) =>
			digest.status === "completed" &&
			digest.summary &&
			projects.has(digest.projectId)
	);
	const failedProjects = new Set(
		(snapshot?.digests ?? [])
			.filter(
				(digest) => digest.status === "failed" && projects.has(digest.projectId)
			)
			.map((digest) => digest.projectId)
	);
	return (
		<div className="mx-auto w-full max-w-3xl space-y-4 px-5 py-6 sm:px-8">
			{activity.isError && (
				<TeamReadError
					label={
						summaries.length
							? "Couldn’t refresh topics."
							: "Couldn’t load topics."
					}
					onRetry={() => activity.refetch()}
				/>
			)}
			{summaries.length > 0 ? (
				<ul className="divide-y divide-border/60">
					{summaries.map((digest) => (
						<li className="space-y-2 py-4 first:pt-0" key={digest.id}>
							<div className="flex flex-wrap items-baseline justify-between gap-2">
								<h2 className="font-semibold text-base">
									{projects.get(digest.projectId)?.name}
								</h2>
								<time
									className="text-muted-foreground text-xs"
									dateTime={new Date(digest.windowEndedAtMs).toISOString()}
								>
									{new Date(digest.windowEndedAtMs).toLocaleDateString(
										"en-US",
										{ dateStyle: "medium" }
									)}
								</time>
							</div>
							<p className="whitespace-pre-wrap break-words text-sm leading-6">
								{digest.summary}
							</p>
							{failedProjects.has(digest.projectId) && (
								<p className="text-muted-foreground text-xs">
									The latest summary couldn’t be generated.
								</p>
							)}
						</li>
					))}
				</ul>
			) : (
				<TeamReadEmpty
					empty={
						failedProjects.size
							? "A summary couldn’t be generated yet."
							: "No topic summaries yet."
					}
					loading={activity.isPending}
					pendingLabel="Loading topics"
					showEmpty={!activity.isError}
				/>
			)}
		</div>
	);
}

function TeamReadEmpty(input: {
	empty: string;
	loading: boolean;
	pendingLabel: string;
	showEmpty: boolean;
}) {
	if (input.loading) {
		return (
			<SkeletonRegion className="space-y-3 py-2" label={input.pendingLabel}>
				<Skeleton className="h-4 w-3/5" />
				<Skeleton className="h-4 w-2/5" />
			</SkeletonRegion>
		);
	}
	return input.showEmpty ? (
		<p className="text-muted-foreground text-sm">{input.empty}</p>
	) : null;
}

export function TeamReadError(input: { label: string; onRetry: () => void }) {
	return (
		<div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
			<output>{input.label}</output>
			<Button onClick={input.onRetry} size="sm" variant="outline">
				Retry
			</Button>
		</div>
	);
}
