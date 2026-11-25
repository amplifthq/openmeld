import type { AgentActivitySnapshotResponse } from "@openmeld/schemas/types";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import { agentActivitySnapshotQueryOptions } from "#/query/organizations/agent-activity";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

const eventLabels = {
	session_started: "Started",
	session_ended: "Ended",
	session_error: "Failed",
	session_idle: "Paused",
} as const;

export function MemberSharedActivity(input: {
	organizationId: string;
	memberUserId: string;
	nowMs: number;
}) {
	const query = useQuery(
		agentActivitySnapshotQueryOptions({
			organizationId: input.organizationId,
			memberUserId: input.memberUserId,
		})
	);
	if (!query.isSuccess || query.data.organizationId !== input.organizationId) {
		return null;
	}
	return (
		<MemberSharedActivityReadout
			memberUserId={input.memberUserId}
			nowMs={input.nowMs}
			snapshot={query.data}
		/>
	);
}

export function MemberSharedActivityReadout(input: {
	snapshot: AgentActivitySnapshotResponse;
	memberUserId: string;
	nowMs: number;
}) {
	const projects = new Map(
		input.snapshot.projects.map((project) => [project.id, project.name])
	);
	const sessions = input.snapshot.sessions
		.filter((session) => session.memberUserId === input.memberUserId)
		.toSorted((a, b) => b.lastObservedAtMs - a.lastObservedAtMs);
	const focus = [
		...new Set(
			sessions
				.filter(
					(session) =>
						session.isActive &&
						session.expiresAtMs > input.nowMs &&
						session.lastObservedAtMs + input.snapshot.stalenessThresholdMs >
							input.nowMs
				)
				.map((session) => projects.get(session.projectId))
				.filter((name): name is string => Boolean(name))
		),
	].slice(0, 3);
	const recentEvents = input.snapshot.recentEvents
		.filter(
			(event) =>
				event.memberUserId === input.memberUserId &&
				Object.hasOwn(eventLabels, event.eventType)
		)
		.toSorted((a, b) => b.observedAtMs - a.observedAtMs)
		.slice(0, 4);
	return (
		<>
			{focus.length > 0 ? (
				<ActivitySection title="Current focus">
					{focus.map((project) => (
						<li className="break-words px-4 py-2" key={project}>
							{project}
						</li>
					))}
				</ActivitySection>
			) : null}
			{sessions.length > 0 ? (
				<ActivitySection title="Recent sessions">
					{sessions.slice(0, 5).map((session) => (
						<ActivityRow
							at={session.lastObservedAtMs}
							detail={projects.get(session.projectId)}
							key={session.id}
							title={
								session.title || formatLocalAgentDisplayName(session.provider)
							}
						/>
					))}
				</ActivitySection>
			) : null}
			{recentEvents.length > 0 ? (
				<ActivitySection title="Activity">
					{recentEvents.map((event) => (
						<ActivityRow
							at={event.observedAtMs}
							detail={eventLabels[event.eventType as keyof typeof eventLabels]}
							key={event.eventId}
							title={
								event.title ||
								projects.get(event.projectId) ||
								formatLocalAgentDisplayName(event.provider)
							}
						/>
					))}
				</ActivitySection>
			) : null}
		</>
	);
}

function ActivitySection(input: { title: string; children: ReactNode }) {
	return (
		<section aria-label={input.title} className="min-w-0 space-y-2">
			<h2 className="font-medium text-sm">{input.title}</h2>
			<ul className="divide-y divide-border rounded-lg border border-border text-sm">
				{input.children}
			</ul>
		</section>
	);
}

function ActivityRow(input: { title: string; detail?: string; at: number }) {
	return (
		<li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2">
			<span className="min-w-0 break-words">
				{input.title}
				{input.detail ? (
					<span className="text-muted-foreground"> · {input.detail}</span>
				) : null}
			</span>
			<time
				className="text-muted-foreground text-xs"
				dateTime={new Date(input.at).toISOString()}
			>
				{dateFormatter.format(input.at)}
			</time>
		</li>
	);
}
