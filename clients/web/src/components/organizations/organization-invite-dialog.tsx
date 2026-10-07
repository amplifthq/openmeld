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
							Invite people to {currentOrganization.name}
						</DialogTitle>
						<DialogDescription>
							Send an email invitation or share an invite link.
						</DialogDescription>
					</DialogHeader>
					{content}
				</ScrollArea>
			</DialogContent>
		</Dialog>
	);
}
