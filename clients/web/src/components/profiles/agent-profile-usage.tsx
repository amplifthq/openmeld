import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import {
	SettingsLocalAgentUsageLimits,
	SettingsLocalAgentUsageSummary,
} from "@openmeld/ui/components/settings-computers";
import { useQuery } from "@tanstack/react-query";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { useNowMs } from "#/lib/spaces/use-now-ms";
import { organizationAgentRuntimeOverviewQueryOptions } from "#/query/organizations/organization-directory";
import { resolveUsageResetHint } from "./agent-usage-reset-hint";
import { formatLocalAgentDisplayName } from "./local-agent-display-name";

/** Reads Core's team-visible usage projection for this Agent's current Binding. */
export function AgentProfileUsage({
	profileId,
	variant = "summary",
}: {
	profileId: string;
	variant?: "summary" | "details" | "popover" | "reset";
}) {
	const organization = useOptionalAppOrganization();
	return organization ? (
		<OrganizationAgentProfileUsage
			organizationId={organization.currentOrganization.id}
			profileId={profileId}
			variant={variant}
		/>
	) : null;
}

function OrganizationAgentProfileUsage({
	organizationId,
	profileId,
	variant,
}: {
	organizationId: string;
	profileId: string;
	variant: "summary" | "details" | "popover" | "reset";
}) {
	const nowMs = useNowMs(variant === "reset" ? 60_000 : null);
	const runtimes = useQuery({
		...organizationAgentRuntimeOverviewQueryOptions({
			enabled: true,
			organizationId,
		}),
	});
	const readiness = runtimes.data?.agentProfiles.find(
		(profile) => profile.profileId === profileId
	)?.readiness;
	const controllerRef =
		readiness?.publicProfileConfiguration?.agentControllerRef ??
		readiness?.agentControllerRef;
	const controller = controllerRef
		? parseAgentControllerRef(controllerRef)
		: null;
	if (controller && controller.kind !== "builtin") {
		return null;
	}
	const limits = readiness?.usageLimits;
	if (variant === "reset") {
		return (
			<span className="text-muted-foreground text-xs">
				{resolveUsageResetHint(limits ?? [], nowMs)}
			</span>
		);
	}
	if (!limits?.length) {
		return (
			<span className="text-muted-foreground text-xs">
				{runtimes.isPending ? "Checking usage…" : "Usage unknown"}
			</span>
		);
	}
	const agentName = controller
		? formatLocalAgentDisplayName(controller.id)
		: "Agent";
	return variant !== "summary" ? (
		<SettingsLocalAgentUsageLimits
			agentName={agentName}
			compact={variant === "popover"}
			fillColumns
			limits={limits}
		/>
	) : (
		<SettingsLocalAgentUsageSummary agentName={agentName} limits={limits} />
	);
}
