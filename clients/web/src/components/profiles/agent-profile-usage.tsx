import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import { SettingsLocalAgentUsageSummary } from "@openmeld/ui/components/settings-computers";
import { useQuery } from "@tanstack/react-query";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { resolveAgentProfileUsage } from "#/lib/profiles/agent-profile-usage";
import {
	organizationAgentRuntimeOverviewQueryOptions,
	organizationComputersQueryOptions,
} from "#/query/organizations/organization-directory";
import { formatLocalAgentDisplayName } from "./local-agent-display-name";

/** Uses the same team-visible Computer evidence as the directory and Computer detail. */
export function AgentProfileUsage({ profileId }: { profileId: string }) {
	const organization = useOptionalAppOrganization();
	return organization ? (
		<OrganizationAgentProfileUsage
			organizationId={organization.currentOrganization.id}
			profileId={profileId}
		/>
	) : null;
}

function OrganizationAgentProfileUsage({
	organizationId,
	profileId,
}: {
	organizationId: string;
	profileId: string;
}) {
	const runtimes = useQuery(
		organizationAgentRuntimeOverviewQueryOptions({
			enabled: true,
			organizationId,
		})
	);
	const computers = useQuery(
		organizationComputersQueryOptions({ enabled: true, organizationId })
	);
	const readiness = runtimes.data?.agentProfiles.find(
		(profile) => profile.profileId === profileId
	)?.readiness;
	const controller = readiness?.agentControllerRef
		? parseAgentControllerRef(readiness.agentControllerRef)
		: null;
	if (!controller || controller.kind !== "builtin") {
		return null;
	}
	const usage = resolveAgentProfileUsage(
		readiness,
		computers.data?.computers ?? []
	);
	if (!usage) {
		return null;
	}
	return (
		<div className="mt-2 flex items-center gap-2 text-muted-foreground text-xs">
			<span>{usage.computerName} · Usage</span>
			<SettingsLocalAgentUsageSummary
				agentName={formatLocalAgentDisplayName(controller.id)}
				limits={usage.limits}
			/>
		</div>
	);
}
