import { FluidDropdownMenuItem } from "@openmeld/ui/fluid/dropdown-menu";
import { UserPlusIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useState } from "react";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";

const OrganizationInviteDialog = lazy(() =>
	import("./organization-invite-dialog").then((module) => ({
		default: module.OrganizationInviteDialog,
	}))
);

export function useOrganizationInviteEntry(closeMenu: () => void) {
	const [open, setOpen] = useState(false);
	const context = useOptionalAppOrganization();
	const available = context && !context.currentOrganization.isPersonal;
	return {
		nextMenuIndex: available ? 2 : 1,
		menuItem: available ? (
			<FluidDropdownMenuItem
				index={1}
				onClick={() => {
					closeMenu();
					setOpen(true);
				}}
			>
				<UserPlusIcon />
				Invite people
			</FluidDropdownMenuItem>
		) : null,
		dialog:
			available && open ? (
				<Suspense fallback={null}>
					<OrganizationInviteDialog onOpenChange={setOpen} open={open} />
				</Suspense>
			) : null,
	};
}
