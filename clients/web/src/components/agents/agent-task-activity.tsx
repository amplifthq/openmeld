import type { OrganizationAgentRuntimeOverviewResponse } from "@openmeld/schemas/types";
import { buildPublicSpaceEntryPath } from "@openmeld/space";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { useNowMs } from "#/lib/spaces/use-now-ms";
import { organizationAgentRuntimeOverviewQueryOptions } from "#/query/organizations/organization-directory";
import type { AgentProfileActivityNavigation } from "./agent-profile-activity-preview";

type Activity =
	OrganizationAgentRuntimeOverviewResponse["agentProfiles"][number];

export function agentTaskActivityNavigation(
	activity: Pick<Activity, "operationalContext"> | undefined
): AgentProfileActivityNavigation | null {
	const context = activity?.operationalContext;
	if (
		!context ||
		(context.status !== "working" && context.status !== "paused")
	) {
		return null;
	}
	const destination = (
		location: NonNullable<typeof context.currentWorkLocation>
	) => ({
		href: buildPublicSpaceEntryPath({
			spaceId: location.spaceId,
		}),
		source: "space" as const,
		title: location.spaceName,
	});
	return {
		current: context.currentWorkLocation
			? destination(context.currentWorkLocation)
			: null,
		queued: context.queuedWorkLocations?.map(destination) ?? [],
	};
}

export function useAgentTaskActivity(profileId: string) {
	const organization = useOptionalAppOrganization();
	const query = useQuery(
		organizationAgentRuntimeOverviewQueryOptions({
			enabled: Boolean(organization),
			organizationId: organization?.currentOrganization.id ?? "",
		})
	);
	const activity = query.data?.agentProfiles.find(
		(profile) => profile.profileId === profileId
	);
	return {
		activity,
		enabled: Boolean(organization),
		isError: query.isError,
		navigation: agentTaskActivityNavigation(activity),
	};
}

export function AgentTaskActivityTime({
	timestamp,
}: {
	timestamp: string | null | undefined;
}) {
	const now = useNowMs(timestamp ? 60_000 : null);
	const ms = Date.parse(timestamp ?? "");
	if (!Number.isFinite(ms)) {
		return null;
	}
	const minutes = Math.floor(Math.max(0, now - ms) / 60_000);
	let relative = "just now";
	if (minutes >= 1440) {
		relative = `${Math.floor(minutes / 1440)}d ago`;
	} else if (minutes >= 60) {
		relative = `${Math.floor(minutes / 60)}h ago`;
	} else if (minutes >= 1) {
		relative = `${minutes}m ago`;
	}
	return (
		<TooltipHint
			content={`Recorded task activity · ${new Date(ms).toLocaleString("en-US")}. This is not a live heartbeat.`}
		>
			<time
				className="block text-muted-foreground text-xs"
				dateTime={timestamp ?? undefined}
			>
				Last task activity {relative}
			</time>
		</TooltipHint>
	);
}

export function AgentTaskActivitySummary({ profileId }: { profileId: string }) {
	const { activity, enabled, isError, navigation } =
		useAgentTaskActivity(profileId);
	if (!enabled) {
		return null;
	}
	const context = activity?.operationalContext;
	const current = navigation?.current;
	const active = context?.status === "working";
	const queued =
		context && "waitingCount" in context ? context.waitingCount : 0;
	let label = "No current task";
	if (isError) {
		label = "Activity unavailable";
	} else if (!activity || context?.status === "checking") {
		label = "Checking activity…";
	} else if (!context) {
		label = "Current activity unavailable";
	} else if (active) {
		label = "Active task";
	} else if (context?.status === "paused") {
		label = "Waiting to continue";
	}
	return (
		<section
			aria-label="Agent activity"
			className="mt-3 grid gap-1.5 border-border/60 border-t pt-3"
		>
			<div className="flex min-w-0 items-center gap-2 text-sm">
				<span className="shrink-0">
					{label}
					{queued > 0 ? ` · ${queued} queued` : ""}
				</span>
				{current ? (
					<a
						className="flex min-w-0 items-center gap-1 text-muted-foreground hover:text-foreground"
						href={current.href}
					>
						<span className="truncate">{current.title}</span>
						<ArrowRightIcon aria-hidden="true" className="size-3.5 shrink-0" />
					</a>
				) : null}
			</div>
			<AgentTaskActivityTime timestamp={activity?.lastTaskActivityAt} />
			{activity?.lastTaskActivityAt === null ? (
				<span className="text-muted-foreground text-xs">
					No recorded task activity in the past 30 days
				</span>
			) : null}
		</section>
	);
}
