import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { SkeletonForm } from "@openmeld/ui/components/skeleton-content";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { INVITE_PEOPLE_INTENT } from "#/lib/organizations/organization-entry-intent";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import { organizationMemberRoleQueryOptions } from "#/query/organizations/organization-directory";
import { OrganizationInviteControls } from "./organization-invite-controls";
import { PersonalWorkspaceOrganizationGuidance } from "./personal-workspace-organization-guidance";

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
	if (currentOrganization.isPersonal) {
		content = (
			<PersonalWorkspaceOrganizationGuidance
				description="Create or choose an organization to invite teammates. You can send invitations after opening it."
				intent={INVITE_PEOPLE_INTENT}
			/>
		);
	} else if (role.isPending) {
		content = <SkeletonForm fields={2} label="Loading invitation options" />;
	} else if (role.error) {
		content = <p role="alert">{role.error.message}</p>;
	}
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="max-h-[85dvh] overflow-hidden p-0 sm:max-w-xl">
				<ScrollArea
					className="max-h-[inherit]"
					contentClassName="grid gap-4 p-4"
				>
					<DialogHeader>
						<DialogTitle>
							{currentOrganization.isPersonal
								? "Invite teammates"
								: `Invite people to ${currentOrganization.name}`}
						</DialogTitle>
						<DialogDescription>
							{currentOrganization.isPersonal
								? "Work together in an organization."
								: "Send an email invitation or share an invite link."}
						</DialogDescription>
					</DialogHeader>
					{content}
				</ScrollArea>
			</DialogContent>
		</Dialog>
	);
}
