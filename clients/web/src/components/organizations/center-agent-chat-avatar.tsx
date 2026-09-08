import { useQuery } from "@tanstack/react-query";
import { RemoteAgentAvatar } from "#/components/agents/remote-agent-avatar";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { centerAgentDesignationQueryOptions } from "#/query/organizations/center-agent";
import { organizationDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { resolveDesignatedCenterAgentProfile } from "./center-agent-profile-presentation";

export function CenterAgentChatAvatar({
	working = false,
}: {
	working?: boolean;
}) {
	const { currentOrganization: org } = useAppOrganization();
	const designation = useQuery(
		centerAgentDesignationQueryOptions({
			enabled: true,
			organizationId: org.id,
		})
	);
	const directory = useQuery(
		organizationDirectoryQueryOptions({ enabled: true, organizationId: org.id })
	);
	const profile = resolveDesignatedCenterAgentProfile({
		agentProfiles: directory.data?.agentProfiles ?? [],
		designation: designation.data?.designation ?? null,
	});
	return profile ? (
		<RemoteAgentAvatar
			profileName={profile.profileName}
			shape="circle"
			size={24}
			working={working}
		/>
	) : (
		<span className="size-6 shrink-0" />
	);
}
