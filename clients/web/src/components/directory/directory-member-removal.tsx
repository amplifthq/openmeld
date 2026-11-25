import type { OrganizationDirectoryResponse } from "@openmeld/schemas/types";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { OrganizationMemberRemovalAction } from "#/components/organizations/organization-member-removal-action";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import { buildOrganizationPeoplePath } from "#/lib/organizations/organization-routes";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";

export function DirectoryMemberRemoval(input: {
	directoryQuery: {
		data?: Pick<OrganizationDirectoryResponse, "members">;
		isError: boolean;
	};
	organization: OrganizationSummary;
	profileId: string | null;
	userId: string;
	roleQuery: { data?: string | null; isError: boolean };
}) {
	const navigate = useNavigate();
	const members = input.directoryQuery.data?.members ?? [];
	const member = members.find(
		(candidate) =>
			(candidate.humanProfile?.profileId ?? `member:${candidate.memberId}`) ===
			input.profileId
	);
	if (
		!member ||
		input.organization.isPersonal ||
		member.userId === input.userId ||
		member.role.split(",").includes("owner") ||
		input.directoryQuery.isError ||
		input.roleQuery.isError ||
		!canManageOrganizationArea(input.roleQuery.data, { member: ["delete"] })
	) {
		return null;
	}
	return (
		<OrganizationMemberRemovalAction
			key={member.memberId}
			label="Remove member"
			member={member}
			members={members}
			onError={(message) => {
				if (message) {
					toast.error(message);
				}
			}}
			onRemoved={() => {
				toast.success("Member removed.");
				navigate({
					replace: true,
					search: {},
					to: buildOrganizationPeoplePath(input.organization.slug),
				}).catch((error: unknown) => {
					console.error("Failed to return to Team after removal.", error);
				});
			}}
			organizationId={input.organization.id}
			presentation="menu"
		/>
	);
}
