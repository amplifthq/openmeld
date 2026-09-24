import { Button } from "@openmeld/ui/components/button";
import { FluidDropdownMenuItem } from "@openmeld/ui/fluid/dropdown-menu";
import { SignOutIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useSignOut } from "#/hooks/auth.hooks";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationAccountSettingsPath } from "#/lib/organizations/organization-routes";
import { openDesktopWeb } from "./platform";

export function DesktopSignOutMenuItem({ index }: { index: number }) {
	const signOut = useDesktopSignOutAction();
	return (
		<FluidDropdownMenuItem
			disabled={signOut.isPending}
			index={index}
			onClick={signOut.run}
		>
			<SignOutIcon />
			Log out
		</FluidDropdownMenuItem>
	);
}

function useDesktopSignOutAction() {
	const signOut = useSignOut();
	const navigate = useNavigate();
	return {
		isPending: signOut.isPending,
		run: () =>
			signOut.mutate(undefined, {
				onSuccess: () => navigate({ to: "/desktop-shell", replace: true }),
				onError: (error) =>
					toast.error(error.message || "Unable to sign out. Try again."),
			}),
	};
}

export function DesktopAccountLogOutButton() {
	const signOut = useDesktopSignOutAction();
	return (
		<Button
			disabled={signOut.isPending}
			onClick={signOut.run}
			size="sm"
			variant="destructive"
		>
			<SignOutIcon aria-hidden="true" data-icon="inline-start" />
			{signOut.isPending ? "Logging out…" : "Log out"}
		</Button>
	);
}

export function DesktopAccountActions() {
	const { currentOrganization } = useAppOrganization();
	const [openError, setOpenError] = useState<string | null>(null);
	return (
		<section className="space-y-3">
			<h2 className="font-medium text-sm">More account settings</h2>
			<p className="text-muted-foreground text-sm">
				Manage sign-in and security settings in OpenMeld on the web.
			</p>
			{openError && (
				<p className="text-destructive text-sm" role="alert">
					{openError}
				</p>
			)}
			<Button
				onClick={() => {
					setOpenError(null);
					openDesktopWeb(
						buildOrganizationAccountSettingsPath(currentOrganization.slug)
					).catch((error: unknown) =>
						setOpenError(
							error instanceof Error
								? error.message
								: "Could not open account settings. Try again."
						)
					);
				}}
				variant="outline"
			>
				Open account settings on the web
			</Button>
		</section>
	);
}
