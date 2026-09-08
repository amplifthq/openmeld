import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { useQuery } from "@tanstack/react-query";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import { organizationMemberRoleQueryOptions } from "#/query/organizations/organization-directory";
import { OrganizationInviteControls } from "./organization-invite-controls";

export function OrganizationInviteDialog(input: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const role = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: input.open && !currentOrganization.isPersonal,
			organizationId: currentOrganization.id,
			userId: currentUserId,
		})
	);
	let content = (
		<OrganizationInviteControls
			canManage={canManageOrganizationArea(role.data, {
				invitation: ["create"],
			})}
			organizationId={currentOrganization.id}
		/>
	);
	if (role.isPending) {
		content = <p>Loading invitation options…</p>;
	} else if (role.error) {
		content = <p role="alert">{role.error.message}</p>;
	}
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Invite people to {currentOrganization.name}</DialogTitle>
					<DialogDescription>
						Send an email invitation or share an invite link.
					</DialogDescription>
				</DialogHeader>
				{content}
			</DialogContent>
		</Dialog>
	);
}
