"use client";

import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@openmeld/ui/components/avatar";
import { FluidActionList } from "@openmeld/ui/fluid/action-list";
import { FluidDropdownMenuItem } from "@openmeld/ui/fluid/dropdown-menu";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowLeftIcon,
	CheckIcon,
	EnvelopeSimpleIcon,
	GearIcon,
	SignOutIcon,
	UserPlusIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { useDeviceSessions, useSwitchAccount } from "#/hooks/auth.hooks";
import { useLogoutAllAccountsAction } from "#/hooks/auth-form.hooks";
import type { AuthDeviceSession } from "#/lib/auth-client-types";
import type {
	AppOuterRailAccount,
	HumanProfileAvatarIdentity,
} from "./app-workspace-switcher";
export function useAccountSwitcher(
	account: AppOuterRailAccount,
	enabled: boolean
) {
	const deviceSessionsQuery = useDeviceSessions(enabled);
	const switchAccount = useSwitchAccount();
	const logoutAllAccounts = useLogoutAllAccountsAction();
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const isBusy = switchAccount.isPending || logoutAllAccounts.isPending;
	const switchToAccount = async (deviceSession: AuthDeviceSession) => {
		if (
			isBusy ||
			normalizeAccountEmail(deviceSession.user.email) ===
				normalizeAccountEmail(account.email)
		) {
			return;
		}

		setErrorMessage(null);
		try {
			await switchAccount.mutateAsync(deviceSession.session.token);
			window.location.assign("/");
		} catch (error) {
			setErrorMessage(
				error instanceof Error
					? error.message
					: "Unable to switch accounts. Try again."
			);
		}
	};
	const logOutAllAccounts = async () => {
		if (isBusy) {
			return;
		}

		setErrorMessage(null);
		try {
			await logoutAllAccounts.mutateAsync();
			window.location.assign("/");
		} catch (error) {
			setErrorMessage(
				error instanceof Error
					? error.message
					: "Unable to log out of all accounts. Try again."
			);
		}
	};
	return {
		errorMessage,
		setErrorMessage,
		isPending: isBusy,
		isError: deviceSessionsQuery.isError,
		isLoading: deviceSessionsQuery.isPending,
		sessions: deviceSessionsQuery.data ?? [],
		onRetry: () => deviceSessionsQuery.refetch(),
		onSwitchAccount: switchToAccount,
		onLogOutAll: logOutAllAccounts,
	};
}
const MAX_DEVICE_SESSIONS = 5;

export function AccountsSwitcherView(input: {
	humanProfileAvatar: HumanProfileAvatarIdentity | null;
	account: AppOuterRailAccount;
	errorMessage: string | null;
	isError: boolean;
	isLoading: boolean;
	isPending: boolean;
	onAddAccount: () => void;
	onOpenAccountSettings: () => void;
	onBack: () => void;
	onLogOutAll: () => void;
	onLogOutCurrent: () => void;
	onRetry: () => void;
	onSwitchAccount: (session: AuthDeviceSession) => void;
	sessions: readonly AuthDeviceSession[];
}) {
	const currentEmail = normalizeAccountEmail(input.account.email);
	const currentSession = input.sessions.find(
		(session) => normalizeAccountEmail(session.user.email) === currentEmail
	);
	const otherSessions = input.sessions.filter(
		(session) => session !== currentSession
	);
	const accountCount = input.sessions.length + (currentSession ? 0 : 1);
	const hasReachedAccountLimit = accountCount >= MAX_DEVICE_SESSIONS;
	const visibleError =
		input.errorMessage ??
		(input.isError ? "Unable to load accounts. Try again." : null);

	return (
		<>
			<FluidDropdownMenuItem
				aria-label="Back to account menu"
				className="flex min-h-10 w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm disabled:cursor-wait disabled:opacity-70"
				closeOnClick={false}
				disabled={input.isPending}
				index={0}
				onClick={input.onBack}
				role="menuitem"
			>
				<ArrowLeftIcon aria-hidden="true" className="size-4" />
				<span className="font-medium">Accounts</span>
			</FluidDropdownMenuItem>
			<output
				aria-atomic="true"
				aria-live="polite"
				className={cn(
					visibleError
						? "mx-2 mb-2 block rounded-sm bg-destructive/10 px-2.5 py-2 text-destructive text-xs leading-snug"
						: "sr-only"
				)}
			>
				{visibleError ?? ""}
			</output>
			{input.isError ? (
				<FluidDropdownMenuItem
					className="mx-2 mb-1 rounded-sm px-2 py-1 font-medium text-foreground text-xs outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
					closeOnClick={false}
					index={0}
					onClick={input.onRetry}
					role="menuitem"
				>
					Try again
				</FluidDropdownMenuItem>
			) : null}
			{input.isLoading ? (
				<p className="px-2.5 py-3 text-muted-foreground text-xs">
					Loading accounts…
				</p>
			) : (
				<ScrollArea className="max-h-72">
					<FluidActionList
						aria-label="Accounts"
						hoverIndicatorClassName="bg-interaction-hover"
					>
						<AccountSwitcherRow
							account={input.account}
							disabled={input.isPending}
							humanProfileAvatar={input.humanProfileAvatar}
							index={0}
							selected
						/>
						{otherSessions.map((session, index) => (
							<AccountSwitcherRow
								account={session.user}
								disabled={input.isPending}
								index={index + 1}
								key={session.session.token}
								onSelect={() => input.onSwitchAccount(session)}
							/>
						))}
					</FluidActionList>
				</ScrollArea>
			)}
			<FluidActionList
				aria-label="Account actions"
				className="mt-1 border-border border-t pt-1"
				hoverIndicatorClassName="bg-interaction-hover"
			>
				<FluidDropdownMenuItem
					className="flex min-h-10 w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
					closeOnClick={false}
					disabled={input.isPending || hasReachedAccountLimit}
					index={0}
					onClick={input.onAddAccount}
					role="menuitem"
				>
					<UserPlusIcon aria-hidden="true" className="size-4 shrink-0" />
					<span className="font-medium">Add account</span>
				</FluidDropdownMenuItem>
				<FluidDropdownMenuItem
					className="flex min-h-10 w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm"
					closeOnClick={false}
					index={1}
					onClick={() => window.location.assign("/invitations")}
					role="menuitem"
				>
					<EnvelopeSimpleIcon aria-hidden="true" className="size-4 shrink-0" />
					<span className="font-medium">Invitations</span>
				</FluidDropdownMenuItem>
				<FluidDropdownMenuItem
					className="flex min-h-10 w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm"
					disabled={input.isPending}
					index={2}
					onClick={input.onOpenAccountSettings}
					role="menuitem"
				>
					<GearIcon aria-hidden="true" className="size-4 shrink-0" />
					<span className="font-medium">Account settings</span>
				</FluidDropdownMenuItem>
				<FluidDropdownMenuItem
					className="flex min-h-10 w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-muted-foreground text-sm disabled:cursor-wait disabled:opacity-70"
					closeOnClick={false}
					disabled={input.isPending}
					index={3}
					onClick={input.onLogOutCurrent}
					role="menuitem"
				>
					<SignOutIcon aria-hidden="true" className="size-4 shrink-0" />
					<span className="font-medium">Log out of this account</span>
				</FluidDropdownMenuItem>
				{accountCount > 1 ? (
					<FluidDropdownMenuItem
						className="flex min-h-10 w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-muted-foreground text-sm disabled:cursor-wait disabled:opacity-70"
						closeOnClick={false}
						disabled={input.isPending}
						index={4}
						onClick={input.onLogOutAll}
						role="menuitem"
					>
						<SignOutIcon aria-hidden="true" className="size-4 shrink-0" />
						<span className="font-medium">Log out of all accounts</span>
					</FluidDropdownMenuItem>
				) : null}
			</FluidActionList>
			{hasReachedAccountLimit ? (
				<p className="px-2.5 py-2 text-muted-foreground text-xs leading-snug">
					You can keep up to 5 accounts signed in on this browser.
				</p>
			) : null}
		</>
	);
}

function AccountSwitcherRow(input: {
	humanProfileAvatar?: HumanProfileAvatarIdentity | null;
	account: AppOuterRailAccount;
	disabled: boolean;
	index: number;
	onSelect?: () => void;
	selected?: boolean;
}) {
	return (
		<FluidDropdownMenuItem
			aria-checked={input.selected === true}
			aria-current={input.selected ? "true" : undefined}
			className={cn(
				"flex min-h-12 w-full min-w-0 items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm disabled:cursor-wait disabled:opacity-70",
				input.selected
					? "bg-interaction-active text-foreground"
					: "text-muted-foreground"
			)}
			closeOnClick={false}
			disabled={input.disabled}
			index={input.index}
			onClick={input.onSelect ?? (() => undefined)}
			role="menuitemradio"
		>
			<AccountAvatar
				account={input.account}
				humanProfileAvatar={input.humanProfileAvatar}
				image={input.selected ? null : input.account.image}
			/>
			<span className="grid min-w-0 flex-1 gap-0.5 leading-tight">
				<span className="truncate font-medium text-foreground">
					{input.account.name?.trim() || input.account.email || "Account"}
				</span>
				{input.account.email ? (
					<span className="truncate text-xs">{input.account.email}</span>
				) : null}
			</span>
			{input.selected ? (
				<CheckIcon aria-hidden="true" className="size-4 shrink-0" />
			) : null}
		</FluidDropdownMenuItem>
	);
}

function AccountAvatar(input: {
	account: AppOuterRailAccount;
	humanProfileAvatar?: HumanProfileAvatarIdentity | null;
	image?: string | null;
}) {
	const displayName =
		input.account.name?.trim() || input.account.email?.trim() || "Account";
	if (input.humanProfileAvatar) {
		return (
			<DitherProfileAvatar
				avatarImageUrl={input.humanProfileAvatar.avatarImageUrl}
				className="size-7 shrink-0"
				profileId={input.humanProfileAvatar.profileId}
				profileKind="human"
				profileName={input.humanProfileAvatar.profileName}
				size={28}
			/>
		);
	}
	// Only saved accounts use the device-session image. The active account
	// always uses the same canonical Human Profile identity as Settings.
	return (
		<Avatar aria-hidden="true" className="size-7 shrink-0">
			{input.image ? (
				<AvatarImage alt="" referrerPolicy="no-referrer" src={input.image} />
			) : null}
			<AvatarFallback className="bg-muted font-medium text-foreground text-xs">
				{(displayName.trim()[0] ?? "A").toUpperCase()}
			</AvatarFallback>
		</Avatar>
	);
}

function normalizeAccountEmail(email: string | null | undefined): string {
	return email?.trim().toLowerCase() ?? "";
}
