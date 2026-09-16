import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { PlusIcon, RobotIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { useOrganizationInviteEntry } from "#/components/organizations/use-organization-invite-entry";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationAgentCreationPath } from "#/lib/organizations/organization-routes";

export function TeamSidebarHeader() {
	const { currentOrganization } = useAppOrganization();
	const { dismiss } = useAppNavigationPresentation();
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const invitation = useOrganizationInviteEntry(
		() => setOpen(false),
		"Invite members"
	);
	return (
		<>
			<div className="mb-4 flex items-center justify-between gap-1 px-1">
				<h2 className="font-medium text-sm">Team</h2>
				<DropdownMenu onOpenChange={setOpen} open={open}>
					<DropdownMenuTrigger
						render={
							<Button aria-label="Add to Team" size="icon-sm" variant="ghost" />
						}
					>
						<PlusIcon />
					</DropdownMenuTrigger>
					<FluidDropdownMenuContent align="end" className="w-48">
						{invitation.menuItem}
						<FluidDropdownMenuItem
							index={invitation.nextMenuIndex}
							onClick={() => {
								setOpen(false);
								dismiss();
								navigate({
									to: buildOrganizationAgentCreationPath(
										currentOrganization.slug
									),
								}).catch(console.error);
							}}
						>
							<RobotIcon /> New Agent
						</FluidDropdownMenuItem>
					</FluidDropdownMenuContent>
				</DropdownMenu>
			</div>
			{invitation.dialog}
		</>
	);
}
