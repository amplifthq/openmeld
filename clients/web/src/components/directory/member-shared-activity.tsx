import { AGENT_ACTIVITY_PRESENCE_TTL_MAX_MS } from "@openmeld/schemas";
import type {
	AgentActivityInventorySession,
	AgentActivitySessionInventoryResponse,
} from "@openmeld/schemas/types";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { agentActivitySessionsQueryOptions } from "#/query/organizations/agent-activity";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

export function MemberSharedActivity(input: {
	organizationId: string;
	memberUserId: string;
	nowMs: number;
}) {
	const viewer = useOptionalAppOrganization();
	const hasViewer =
		Boolean(viewer?.currentUserId) &&
		viewer?.currentOrganization.id === input.organizationId;
	const options = agentActivitySessionsQueryOptions({
		enabled: hasViewer,
		limit: 12,
		organizationId: input.organizationId,
		memberUserId: input.memberUserId,
	});
	const query = useQuery({
		...options,
		// Do not reuse an authorized response under another account.
		queryKey: [...options.queryKey, "member-profile", viewer?.currentUserId],
		gcTime: 0,
		staleTime: 0,
	});
	if (
		!(hasViewer && query.isSuccess) ||
		query.fetchStatus === "paused" ||
		query.data.organization.id !== input.organizationId
	) {
		return null;
	}
	return (
		<MemberSharedActivityReadout
			inventory={query.data}
			memberUserId={input.memberUserId}
			nowMs={input.nowMs}
		/>
	);
}

function currentFocus(session: AgentActivityInventorySession, nowMs: number) {
	return (
		session.dataState === "current" &&
		session.computer.state === "online" &&
		session.status === "working" &&
		session.lastActiveAtMs + AGENT_ACTIVITY_PRESENCE_TTL_MAX_MS > nowMs
	);
}

export function MemberSharedActivityReadout(input: {
	inventory: AgentActivitySessionInventoryResponse;
	memberUserId: string;
	nowMs: number;
}) {
	const sessions = input.inventory.sessions
		.filter(
			(session) =>
				session.owner.userId === input.memberUserId &&
				session.organization.id === input.inventory.organization.id
		)
		.toSorted((a, b) => b.lastActiveAtMs - a.lastActiveAtMs);
	const focus = [
		...new Set(
			sessions
				.filter((session) => currentFocus(session, input.nowMs))
				.map((session) => session.project.name)
		),
	].slice(0, 3);
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
							at={session.lastActiveAtMs}
							detail={session.project.name}
							key={`${session.localAgent.agentControllerRef}:${session.nativeSessionId}`}
							title={session.nativeSessionTitle ?? session.localAgent.name}
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
