"use client";

import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@openmeld/ui/components/avatar";
import { DropdownMenuSeparator } from "@openmeld/ui/components/dropdown-menu";
import { FluidDropdownMenuItem } from "@openmeld/ui/fluid/dropdown-menu";
import { SidebarFooter } from "@openmeld/ui/fluid/sidebar";
import type { SidebarMode } from "@openmeld/ui/fluid/sidebar-state";
import { SidebarUserFooter } from "@openmeld/ui/fluid/sidebar-user-footer";
import { resolveStatusToneIndicatorClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	CaretRightIcon,
	GearSixIcon,
	MoonIcon,
	SignOutIcon,
	SunIcon,
} from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { useState } from "react";
import { toast } from "sonner";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { useLogoutAction } from "#/hooks/auth-form.hooks";
import { buildOrganizationAccountSettingsPath } from "#/lib/organizations/organization-routes";
import { useInvitationReviewCount } from "#/query/organizations/invitation-requests";
import {
	AccountsSwitcherView,
	useAccountSwitcher,
} from "./app-account-switcher";
import { useAppNavigationPresentation } from "./app-navigation-presentation";
import { CollapsedRailTooltip } from "./app-rail-navigation";
import type {
	AppOuterRailAccount,
	HumanProfileAvatarIdentity,
} from "./app-workspace-switcher";

export function AppSidebarFooter({
	account,
	humanProfileAvatar,
	mode,
	orgSlug,
	isSettingsActive,
}: {
	account: AppOuterRailAccount;
	humanProfileAvatar: HumanProfileAvatarIdentity | null;
	mode: SidebarMode;
	orgSlug: string;
	isSettingsActive: boolean;
}) {
	const iconOnly = mode === "icon";
	const name = account.name?.trim() || account.email || "Account";
	const settingsPath = buildOrganizationAccountSettingsPath(orgSlug);
	const invitationReviewCount = useInvitationReviewCount().data ?? 0;
	const settingsLabel =
		invitationReviewCount > 0
			? "Settings, invitation requests need attention"
			: "Settings";
	const navigate = useNavigate();
	const { dismiss, presentation } = useAppNavigationPresentation();
	const logout = useLogoutAction();
	const [menuOpen, setMenuOpen] = useState(false);
	const [showAccounts, setShowAccounts] = useState(false);
	const accounts = useAccountSwitcher(account, menuOpen && showAccounts);
	const { resolvedTheme, setTheme } = useTheme();
	const dark = resolvedTheme === "dark";
	const openAccount = () => {
		dismiss();
		navigate({ to: settingsPath }).catch((error: Error) =>
			toast.error(error.message)
		);
	};
	const avatar = humanProfileAvatar ? (
		<DitherProfileAvatar
			{...humanProfileAvatar}
			profileKind="human"
			size={20}
		/>
	) : (
		<Avatar className="size-5">
			<AvatarImage alt="" src={account.image ?? undefined} />
			<AvatarFallback>{name.slice(0, 1)}</AvatarFallback>
		</Avatar>
	);
	const actionClass =
		"flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/60 outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-ring";
	return (
		<SidebarFooter
			className={cn(
				"app-sidebar-footer gap-1 p-2",
				presentation === "drawer" &&
					"[&_a]:min-h-11 [&_a]:min-w-11 [&_button]:min-h-11 [&_button]:min-w-11",
				iconOnly ? "items-center" : "flex-row items-center"
			)}
		>
			<SidebarUserFooter
				avatar={avatar}
				className={iconOnly ? "w-9" : "min-w-0 flex-1"}
				iconOnly={iconOnly}
				menu={
					showAccounts ? (
						<AccountsSwitcherView
							{...accounts}
							account={account}
							humanProfileAvatar={humanProfileAvatar}
							onAddAccount={() =>
								window.location.assign("/login?intent=add-account&redirect=%2F")
							}
							onBack={() => {
								accounts.setErrorMessage(null);
								setShowAccounts(false);
							}}
							onLogOutCurrent={() => window.location.assign("/logout")}
							onOpenAccountSettings={openAccount}
						/>
					) : (
						<>
							<FluidDropdownMenuItem
								className="gap-2 py-2"
								closeOnClick={false}
								index={0}
								onClick={() => setShowAccounts(true)}
							>
								{avatar}
								<span className="min-w-0 flex-1 text-left">
									<span className="block truncate font-medium">{name}</span>
									<span className="block truncate text-muted-foreground text-xs">
										{account.email}
									</span>
								</span>
								<CaretRightIcon className="size-3.5 shrink-0" />
							</FluidDropdownMenuItem>
							<DropdownMenuSeparator className="my-1" />
							<FluidDropdownMenuItem index={1} onClick={openAccount}>
								<GearSixIcon />
								Settings
							</FluidDropdownMenuItem>
							<FluidDropdownMenuItem
								disabled={logout.isPending}
								index={2}
								onClick={() => {
									logout.mutate(undefined, {
										onSuccess: () => window.location.assign("/"),
										onError: (error) =>
											toast.error(
												error.message || "Unable to log out. Try again."
											),
									});
								}}
							>
								<SignOutIcon />
								Log out
							</FluidDropdownMenuItem>
						</>
					)
				}
				name={name}
				onOpenChange={(open) => {
					if (!open && (accounts.isPending || logout.isPending)) {
						return;
					}
					setMenuOpen(open);
					if (!open) {
						setShowAccounts(false);
						accounts.setErrorMessage(null);
					}
				}}
				open={menuOpen}
			/>
			<div
				className={cn(
					"app-sidebar-footer-actions flex shrink-0 gap-1",
					iconOnly && "flex-col"
				)}
			>
				<CollapsedRailTooltip label={settingsLabel}>
					<Link
						aria-current={isSettingsActive ? "page" : undefined}
						aria-label={settingsLabel}
						className={cn(actionClass, "relative")}
						onClick={dismiss}
						to={settingsPath}
					>
						<GearSixIcon className="size-4" />
						{invitationReviewCount > 0 && (
							<span
								aria-hidden="true"
								className={cn(
									"status-dot absolute top-0 right-0",
									resolveStatusToneIndicatorClassName("warning", "quiet")
								)}
								data-app-rail-status-indicator="invitation-review"
							/>
						)}
					</Link>
				</CollapsedRailTooltip>
				<CollapsedRailTooltip
					label={dark ? "Switch to light mode" : "Switch to dark mode"}
				>
					<button
						aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
						className={actionClass}
						onClick={() => setTheme(dark ? "light" : "dark")}
						type="button"
					>
						{dark ? (
							<SunIcon className="size-4" />
						) : (
							<MoonIcon className="size-4" />
						)}
					</button>
				</CollapsedRailTooltip>
			</div>
		</SidebarFooter>
	);
}
