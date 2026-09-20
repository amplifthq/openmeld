import { InvitationForm } from "#/components/directory/directory-members-overview";
import { OrganizationInvitationRequestForm } from "./organization-invitation-request-form";
import { OrganizationInviteLink } from "./organization-invite-link";

export function OrganizationInviteControls(input: {
	organizationId: string;
	canManage: boolean;
}) {
	return input.canManage ? (
		<div className="space-y-4">
			<InvitationForm organizationId={input.organizationId} />
			<OrganizationInviteLink organizationId={input.organizationId} />
		</div>
	) : (
		<OrganizationInvitationRequestForm organizationId={input.organizationId} />
	);
}
