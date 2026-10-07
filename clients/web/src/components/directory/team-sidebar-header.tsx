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
import { createContext, type ReactNode, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { AppModuleSidebarToggle } from "#/components/app/app-module-sidebar";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { useOrganizationInviteEntry } from "#/components/organizations/use-organization-invite-entry";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationAgentCreationPath } from "#/lib/organizations/organization-routes";

const TeamHeaderActionSlot = createContext<{
	slot: HTMLDivElement | null;
	setSlot: (node: HTMLDivElement | null) => void;
} | null>(null);

export function TeamSidebarHeaderActionsProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [slot, setSlot] = useState<HTMLDivElement | null>(null);
	return (
		<TeamHeaderActionSlot.Provider value={{ slot, setSlot }}>
			{children}
		</TeamHeaderActionSlot.Provider>
	);
}

export function TeamSidebarHeaderAction({ children }: { children: ReactNode }) {
	const context = useContext(TeamHeaderActionSlot);
	return context?.slot ? createPortal(children, context.slot) : null;
}

export function TeamSidebarHeader() {
	const { currentOrganization } = useAppOrganization();
	const { dismiss } = useAppNavigationPresentation();
	const navigate = useNavigate();
	const actions = useContext(TeamHeaderActionSlot);
	const [open, setOpen] = useState(false);
	const invitation = useOrganizationInviteEntry(
		() => setOpen(false),
		"Invite members"
	);
	return (
		<>
			<div className="mb-2 flex items-center justify-between gap-1 px-1">
				<div className="flex items-center gap-1">
					<AppModuleSidebarToggle placement="sidebar" />
					<h2 className="font-medium text-sm">Team</h2>
				</div>
				<div className="flex items-center gap-1">
					<DropdownMenu onOpenChange={setOpen} open={open}>
						<DropdownMenuTrigger
							render={
								<Button
									aria-label="Add to Team"
									size="icon-sm"
									variant="ghost"
								/>
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
					<div className="flex items-center" ref={actions?.setSlot} />
				</div>
			</div>
			{invitation.dialog}
		</>
	);
}
