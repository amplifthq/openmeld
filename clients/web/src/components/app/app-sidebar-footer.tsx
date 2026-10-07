"use client";

import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@openmeld/ui/components/avatar";
import { DropdownMenuSeparator } from "@openmeld/ui/components/dropdown-menu";
import { Kbd, KbdGroup } from "@openmeld/ui/components/kbd";
import {
	FluidDropdownMenuGroup,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { SidebarFooter } from "@openmeld/ui/fluid/sidebar";
import { SidebarMenu } from "@openmeld/ui/fluid/sidebar-menu";
import type { SidebarMode } from "@openmeld/ui/fluid/sidebar-state";
import { SidebarUserMenuItem } from "@openmeld/ui/fluid/sidebar-user-footer";
import { cn } from "@openmeld/ui/lib/utils";
import {
	CaretRightIcon,
	DesktopTowerIcon,
	GlobeHemisphereWestIcon,
	MagnifyingGlassIcon,
	PaletteIcon,
	SignOutIcon,
} from "@phosphor-icons/react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { ThemeSelector } from "#/components/appearance/theme-selector";
import { useOrganizationInviteEntry } from "#/components/organizations/use-organization-invite-entry";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { useAppSettings } from "#/components/settings/use-app-settings";
import { DesktopSignOutMenuItem } from "#/desktop/desktop-account-actions";
import { getDesktopPlatform, openDesktopWeb } from "#/desktop/platform";
import {
	DESKTOP_UPDATE_ATTENTION_LABEL,
	DesktopUpdateIndicator,
	useDesktopUpdateAttention,
} from "#/desktop/updater";
import { useLogoutAction } from "#/hooks/auth-form.hooks";
import {
	AccountsSwitcherView,
	useAccountSwitcher,
} from "./app-account-switcher";
import { useAppNavigationPresentation } from "./app-navigation-presentation";
import { AppSettingsMenuItem } from "./app-settings-menu-item";
import type {
	AppOuterRailAccount,
	HumanProfileAvatarIdentity,
} from "./app-workspace-switcher";
import {
	CurrentComputerAttentionIndicator,
	useCurrentComputer,
} from "./current-computer";

function PlatformAppMenuItem(input: { index: number; webPath: string }) {
	const desktop = getDesktopPlatform();
	return (
		<FluidDropdownMenuItem
			index={input.index}
			onClick={() => {
				if (desktop) {
					openDesktopWeb(input.webPath).catch((error: unknown) =>
						toast.error(
							error instanceof Error
								? error.message
								: "Unable to open the web app. Try again."
						)
					);
					return;
				}
				window.location.assign("/desktop");
			}}
		>
			{desktop ? <GlobeHemisphereWestIcon /> : <DesktopTowerIcon />}
			{desktop ? "Open Web App" : "Download Desktop App"}
		</FluidDropdownMenuItem>
	);
}

function footerLayout(iconOnly: boolean, isDrawer: boolean) {
	return {
		actionsClassName: cn("app-sidebar-footer-actions", iconOnly && "w-8"),
		footerClassName: cn(
			"app-sidebar-footer p-2",
			iconOnly && "items-center",
			isDrawer &&
				"border-border border-t [&_a]:min-h-11 [&_a]:min-w-11 [&_button]:min-h-11 [&_button]:min-w-11"
		),
		userItemClassName: cn(
			iconOnly && "w-8",
			!(iconOnly || isDrawer) && "min-w-0 flex-1",
			isDrawer && "w-full min-w-0"
		),
	};
}

export function AppSidebarFooter({
	account,
	humanProfileAvatar,
	mode,
}: {
	account: AppOuterRailAccount;
	humanProfileAvatar: HumanProfileAvatarIdentity | null;
	mode: SidebarMode;
}) {
	const iconOnly = mode === "icon";
	const computerAttentionLabel = useCurrentComputer()?.attentionLabel;
	const updateAttention = useDesktopUpdateAttention();
	const navigate = useNavigate();
	const currentWebPath = useLocation({
		select: (location) => location.href,
	});
	const name = account.name?.trim() || account.email || "Account";
	const openSettings = useAppSettings();
	const { dismiss, presentation } = useAppNavigationPresentation();
	const logout = useLogoutAction();
	const desktop = getDesktopPlatform();
	const [menuOpen, setMenuOpen] = useState(false);
	const invitationEntry = useOrganizationInviteEntry(() => setMenuOpen(false));
	const [showAccounts, setShowAccounts] = useState(false);
	const accounts = useAccountSwitcher(
		account,
		!desktop && menuOpen && showAccounts
	);
	const isDrawer = presentation === "drawer";
	const openAccount = () => {
		dismiss();
		setMenuOpen(false);
		openSettings().catch((error: Error) => toast.error(error.message));
	};
	const avatar = (
		<AccountFooterAvatar
			account={account}
			humanProfileAvatar={humanProfileAvatar}
			iconOnly={iconOnly}
			name={name}
		/>
	);
	const { actionsClassName, footerClassName, userItemClassName } = footerLayout(
		iconOnly,
		isDrawer
	);
	return (
		<SidebarFooter className={footerClassName}>
			<SidebarMenu aria-label="App utilities" className={actionsClassName}>
				<SidebarUserMenuItem
					avatar={
						<AccountAvatarWithComputerAttention>
							{avatar}
						</AccountAvatarWithComputerAttention>
					}
					className={userItemClassName}
					iconOnly={iconOnly}
					menu={
						showAccounts && !desktop ? (
							<AccountsSwitcherView
								{...accounts}
								account={account}
								humanProfileAvatar={humanProfileAvatar}
								onAddAccount={() =>
									window.location.assign(
										"/login?intent=add-account&redirect=%2F"
									)
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
								<FluidDropdownMenuGroup>
									<FluidDropdownMenuItem
										className="gap-2 py-2"
										closeOnClick={false}
										index={0}
										onClick={() =>
											desktop ? openAccount() : setShowAccounts(true)
										}
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
								</FluidDropdownMenuGroup>
								<FluidDropdownMenuGroup>
									<FluidDropdownMenuItem
										index={0}
										onClick={() => {
											setMenuOpen(false);
											dismiss();
											window.dispatchEvent(
												new Event("openmeld:command-center")
											);
										}}
									>
										<MagnifyingGlassIcon />
										<span className="flex-1">Search</span>
										<KbdGroup>
											<Kbd>⌘</Kbd>
											<Kbd>K</Kbd>
										</KbdGroup>
									</FluidDropdownMenuItem>
								</FluidDropdownMenuGroup>
								<DropdownMenuSeparator />
								<FluidDropdownMenuGroup>
									{invitationEntry.menuItem}
									<ComputerMenuItem
										index={invitationEntry.nextMenuIndex}
										onNavigate={(destination) => {
											setMenuOpen(false);
											dismiss();
											navigate({ to: destination }).catch((error: Error) =>
												toast.error(error.message)
											);
										}}
									/>
									<AppSettingsMenuItem
										index={invitationEntry.nextMenuIndex + 1}
										onClick={openAccount}
									/>
									<PlatformAppMenuItem
										index={invitationEntry.nextMenuIndex + 2}
										webPath={currentWebPath}
									/>
								</FluidDropdownMenuGroup>
								<div className="flex h-8 items-center gap-2 px-2 text-xs">
									<PaletteIcon aria-hidden="true" className="size-4 shrink-0" />
									<span className="flex-1">Theme</span>
									<ThemeSelector inMenu />
								</div>
								<DropdownMenuSeparator />
								<FluidDropdownMenuGroup>
									{desktop ? (
										<DesktopSignOutMenuItem
											index={invitationEntry.nextMenuIndex + 3}
										/>
									) : (
										<FluidDropdownMenuItem
											disabled={logout.isPending}
											index={invitationEntry.nextMenuIndex + 3}
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
									)}
								</FluidDropdownMenuGroup>
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
					triggerClassName={iconOnly ? "size-8" : undefined}
					triggerLabel={[
						`Open user menu for ${name}`,
						computerAttentionLabel,
						updateAttention ? DESKTOP_UPDATE_ATTENTION_LABEL : null,
					]
						.filter(Boolean)
						.join(", ")}
				/>
			</SidebarMenu>
			{invitationEntry.dialog}
		</SidebarFooter>
	);
}

function AccountFooterAvatar(input: {
	account: AppOuterRailAccount;
	humanProfileAvatar: HumanProfileAvatarIdentity | null;
	iconOnly: boolean;
	name: string;
}) {
	if (input.humanProfileAvatar) {
		return (
			<DitherProfileAvatar
				{...input.humanProfileAvatar}
				className={
					input.iconOnly
						? "rounded-md after:rounded-md [&_[data-slot=avatar-fallback]]:rounded-md [&_[data-slot=avatar-image]]:rounded-md"
						: undefined
				}
				profileKind="human"
				size={input.iconOnly ? 32 : 20}
			/>
		);
	}
	return (
		<Avatar
			className={
				input.iconOnly ? "size-8 rounded-md after:rounded-md" : "size-5"
			}
		>
			<AvatarImage
				alt=""
				className={input.iconOnly ? "rounded-md" : undefined}
				src={input.account.image ?? undefined}
			/>
			<AvatarFallback className={input.iconOnly ? "rounded-md" : undefined}>
				{input.name.slice(0, 1)}
			</AvatarFallback>
		</Avatar>
	);
}

function AccountAvatarWithComputerAttention({
	children,
}: {
	children: ReactNode;
}) {
	const computer = useCurrentComputer();
	const updateAttention = useDesktopUpdateAttention();
	const showAttention = computer?.attentionLabel;
	return (
		<span className="relative inline-flex">
			{children}
			{updateAttention && !showAttention ? (
				<DesktopUpdateIndicator className="absolute -top-0.5 -right-0.5" />
			) : null}
			{showAttention ? (
				<>
					<span className="sr-only">{computer.accessibleLabel}</span>
					<span className="absolute -top-0.5 -right-0.5 flex size-2.5 items-center justify-center rounded-full bg-sidebar leading-none">
						<CurrentComputerAttentionIndicator status={computer.status} />
					</span>
				</>
			) : null}
		</span>
	);
}
function ComputerMenuItem(input: {
	index: number;
	onNavigate: (destination: string) => void;
}) {
	const computer = useCurrentComputer();
	return (
		<FluidDropdownMenuItem
			aria-label={computer?.accessibleLabel ?? "Computer"}
			disabled={!computer?.destination}
			index={input.index}
			onClick={() => {
				if (computer?.destination) {
					input.onNavigate(computer.destination);
				}
			}}
		>
			<DesktopTowerIcon />
			<span className="flex-1">Computer</span>
			{computer ? (
				<CurrentComputerAttentionIndicator status={computer.status} />
			) : null}
		</FluidDropdownMenuItem>
	);
}
