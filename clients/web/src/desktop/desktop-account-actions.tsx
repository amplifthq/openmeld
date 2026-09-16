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
	const signOut = useSignOut();
	const navigate = useNavigate();
	return (
		<FluidDropdownMenuItem
			disabled={signOut.isPending}
			index={index}
			onClick={() =>
				signOut.mutate(undefined, {
					onSuccess: () => navigate({ to: "/desktop-shell", replace: true }),
					onError: (error) =>
						toast.error(error.message || "Unable to sign out. Try again."),
				})
			}
		>
			<SignOutIcon />
			Sign out of Desktop
		</FluidDropdownMenuItem>
	);
}

export function DesktopAccountActions() {
	const signOut = useSignOut();
	const navigate = useNavigate();
	const { currentOrganization } = useAppOrganization();
	const [openError, setOpenError] = useState<string | null>(null);
	return (
		<section className="space-y-3">
			<h2 className="font-medium text-sm">Desktop sign-in</h2>
			<p className="text-muted-foreground text-sm">
				Manage sign-in security, CLI access, and other sessions in OpenMeld Web.
				To use another account here, sign out and sign in with your browser.
			</p>
			<p className="text-muted-foreground text-sm">
				Signing out of Desktop leaves this computer’s OpenMeld Service running.
			</p>
			{signOut.error && (
				<p className="text-destructive text-sm" role="alert">
					{signOut.error.message}
				</p>
			)}
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
				Open account settings in browser
			</Button>
			<Button
				disabled={signOut.isPending}
				onClick={() =>
					signOut.mutate(undefined, {
						onSuccess: () => navigate({ to: "/desktop-shell", replace: true }),
					})
				}
				variant="outline"
			>
				{signOut.isPending ? "Signing out…" : "Sign out of Desktop"}
			</Button>
		</section>
	);
}
