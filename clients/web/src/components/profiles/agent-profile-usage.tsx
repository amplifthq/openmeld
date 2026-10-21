import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import { Button } from "@openmeld/ui/components/button";
import {
	SettingsLocalAgentUsageCompactReadout,
	SettingsLocalAgentUsageLimits,
} from "@openmeld/ui/components/settings-computers";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { resolveStatusToneSoftTextClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { AgentUsageSkeleton } from "#/components/agents/agent-profile-skeleton";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { useNowMs } from "#/lib/spaces/use-now-ms";
import { organizationAgentRuntimeOverviewQueryOptions } from "#/query/organizations/organization-directory";
import { AgentConfigurationReadoutCard } from "./agent-configuration-card";
import {
	type AgentUsageAttention,
	resolveAgentUsageAttention,
} from "./agent-usage-attention";
import { resolveUsageResetHint } from "./agent-usage-reset-hint";
import { formatLocalAgentDisplayName } from "./local-agent-display-name";

type UsageVariant =
	| "summary"
	| "details"
	| "popover"
	| "reset"
	| "card"
	| "owner-card";

/**
 * Reads Core's team-visible usage projection for this Agent's current Binding.
 * Team-facing variants (summary, popover, card) show no quota percent; they
 * show a short warning only when the Agent is near or at its limit. The
 * owner's card ("owner-card") keeps the full usage readout.
 */
export function AgentProfileUsage({
	profileId,
	agentControllerRef,
	variant = "summary",
}: {
	profileId: string;
	agentControllerRef?: string | null;
	variant?: UsageVariant;
}) {
	const organization = useOptionalAppOrganization();
	return organization ? (
		<OrganizationAgentProfileUsage
			agentControllerRef={agentControllerRef}
			key={`${organization.currentOrganization.id}/${profileId}`}
			organizationId={organization.currentOrganization.id}
			profileId={profileId}
			variant={variant}
		/>
	) : null;
}

function useAgentUsageState({
	agentControllerRef,
	organizationId,
	profileId,
}: {
	agentControllerRef?: string | null;
	organizationId: string;
	profileId: string;
}) {
	const runtimes = useQuery({
		...organizationAgentRuntimeOverviewQueryOptions({
			enabled: true,
			organizationId,
		}),
	});
	const readiness =
		runtimes.data?.organizationId === organizationId
			? runtimes.data.agentProfiles.find(
					(profile) => profile.profileId === profileId
				)?.readiness
			: undefined;
	const reportedControllerRef =
		readiness?.publicProfileConfiguration?.agentControllerRef ??
		readiness?.agentControllerRef;
	const controllerRef = agentControllerRef ?? reportedControllerRef;
	const controller = controllerRef
		? parseAgentControllerRef(controllerRef)
		: null;
	// Preserve last-known display values only for transport failures, never for
	// revoked access, malformed identity/projections, or a changed Controller.
	const error = runtimes.error;
	const temporaryFailure =
		error !== null &&
		error.code !== "gateway.invalid_response" &&
		((error.status !== null && error.status >= 500) ||
			error.code?.startsWith("network."));
	const controllerChanged = Boolean(
		agentControllerRef &&
			reportedControllerRef &&
			agentControllerRef !== reportedControllerRef
	);
	const canDisplay = !controllerChanged && (!error || temporaryFailure);
	const limits = canDisplay ? readiness?.usageLimits : undefined;
	const displayLimits =
		error || runtimes.isStale
			? limits?.map((limit) => ({
					...limit,
					status:
						limit.status === "available" ? ("stale" as const) : limit.status,
				}))
			: limits;
	const loading = runtimes.isPending && runtimes.fetchStatus !== "paused";
	const agentName = controller
		? formatLocalAgentDisplayName(controller.id)
		: "Agent";
	return {
		agentName,
		applicable: !controller || controller.kind === "builtin",
		// Warnings judge freshness by each limit's own observation time, not by
		// the query's refetch state.
		currentLimits: limits,
		limits: displayLimits,
		loading,
		unavailable: Boolean(
			error || controllerChanged || runtimes.fetchStatus === "paused"
		),
		isFetching: runtimes.isFetching,
		retry: () => runtimes.refetch().catch(console.error),
	};
}

function AgentUsageWarning({ attention }: { attention: AgentUsageAttention }) {
	return (
		<span
			className={cn(
				"text-xs",
				resolveStatusToneSoftTextClassName(
					attention.kind === "reached" ? "danger" : "warning"
				)
			)}
			data-slot="agent-usage-warning"
		>
			{attention.label}
		</span>
	);
}

function AgentUsageCard({
	attention,
	usage,
}: {
	attention: AgentUsageAttention | null;
	usage: ReturnType<typeof useAgentUsageState>;
}) {
	if (!attention) {
		return null;
	}
	return (
		<AgentConfigurationReadoutCard compact itemId="usage" label="Usage limits">
			<AgentUsageWarning attention={attention} />
			{usage.unavailable ? (
				<div className="mt-2 space-y-2">
					<output className="block text-muted-foreground text-xs">
						Last-known usage. Refresh failed.
					</output>
					<Button
						disabled={usage.isFetching}
						onClick={usage.retry}
						size="sm"
						variant="ghost"
					>
						Try again
					</Button>
				</div>
			) : null}
		</AgentConfigurationReadoutCard>
	);
}

function OwnerAgentUsageCard({
	usage,
	nowMs,
}: {
	usage: ReturnType<typeof useAgentUsageState>;
	nowMs: number;
}) {
	return (
		<AgentConfigurationReadoutCard compact itemId="usage" label="Usage limits">
			{usage.loading ? <AgentUsageSkeleton /> : null}
			{!usage.loading && usage.limits ? (
				<SettingsLocalAgentUsageCompactReadout
					agentName={usage.agentName}
					limits={usage.limits}
					nowMs={nowMs}
				/>
			) : null}
			{usage.loading || usage.limits || usage.unavailable ? null : (
				<p className="text-muted-foreground text-xs">Usage not reported yet.</p>
			)}
			{usage.unavailable ? (
				<div className="mt-2 space-y-2">
					<output className="block text-muted-foreground text-xs">
						{usage.limits?.length
							? "Last-known usage. Refresh failed."
							: "Usage temporarily unavailable."}
					</output>
					<Button
						disabled={usage.isFetching}
						onClick={usage.retry}
						size="sm"
						variant="ghost"
					>
						Try again
					</Button>
				</div>
			) : null}
		</AgentConfigurationReadoutCard>
	);
}

function OrganizationAgentProfileUsage(input: {
	agentControllerRef?: string | null;
	organizationId: string;
	profileId: string;
	variant: UsageVariant;
}) {
	const usage = useAgentUsageState(input);
	const { agentName, limits, loading } = usage;
	const { variant } = input;
	const resetNowMs = useNowMs(variant === "reset" ? 60_000 : null);
	// The shared runtime query already refreshes; quota cards add no polling clock.
	const nowMs = variant === "reset" ? resetNowMs : Date.now();
	if (!usage.applicable) {
		return null;
	}
	if (variant === "owner-card") {
		return <OwnerAgentUsageCard nowMs={nowMs} usage={usage} />;
	}
	if (variant !== "reset" && variant !== "details") {
		// Quiet while loading, unavailable, or with room to spare.
		const attention =
			loading || !usage.currentLimits
				? null
				: resolveAgentUsageAttention(usage.currentLimits, nowMs);
		if (variant === "card") {
			return <AgentUsageCard attention={attention} usage={usage} />;
		}
		return attention ? <AgentUsageWarning attention={attention} /> : null;
	}
	if (loading) {
		return (
			<output aria-label="Loading usage limits">
				<Skeleton
					aria-hidden="true"
					className="inline-block h-3 w-20 align-middle"
				/>
			</output>
		);
	}
	if (usage.unavailable) {
		return (
			<span className="text-muted-foreground text-xs">
				Usage temporarily unavailable
			</span>
		);
	}
	if (variant === "reset") {
		return (
			<span className="text-muted-foreground text-xs">
				{resolveUsageResetHint(limits ?? [], nowMs)}
			</span>
		);
	}
	if (!limits?.length) {
		return null;
	}
	return (
		<SettingsLocalAgentUsageLimits
			agentName={agentName}
			fillColumns
			limits={limits}
			nowMs={nowMs}
		/>
	);
}
