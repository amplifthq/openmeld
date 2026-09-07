import { useQuery } from "@tanstack/react-query";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { centerAgentDesignationQueryOptions } from "#/query/organizations/center-agent";
import { organizationDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { DitherProfileAvatar } from "../profiles/dither-profile-avatar";
import { resolveDesignatedCenterAgentProfile } from "./center-agent-profile-presentation";

export function CenterAgentChatAvatar() {
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
		<DitherProfileAvatar
			profileId={profile.profileId}
			profileKind="center-agent"
			profileName={profile.profileName}
			size={24}
		/>
	) : (
		<span className="size-6 shrink-0" />
	);
}
