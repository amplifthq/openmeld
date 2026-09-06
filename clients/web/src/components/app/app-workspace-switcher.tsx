"use client";

import { Popover } from "@base-ui/react/popover";
import {
	FluidActionList,
	FluidActionListItem,
} from "@openmeld/ui/fluid/action-list";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import type { SidebarMode } from "@openmeld/ui/fluid/sidebar-state";
import { cn } from "@openmeld/ui/lib/utils";
import { BuildingsIcon, CaretDownIcon, PlusIcon } from "@phosphor-icons/react";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { selectLastSelectedOrganization } from "#/lib/organizations/account-organization-preference";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationNewOrganizationPath,
	buildOrganizationOrganizationsPath,
	resolveOrganizationSwitchPath,
} from "#/lib/organizations/organization-routes";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { CollapsedRailTooltip } from "./app-rail-navigation";

export type AppOuterRailAccount = {
	email?: string | null;
	image?: string | null;
	name?: string | null;
};

export type HumanProfileAvatarIdentity = {
	avatarImageUrl?: string | null;
	profileId: string;
	profileName: string;
};

export function OrganizationSwitcher(input: {
	account: AppOuterRailAccount;
	humanProfileAvatar: HumanProfileAvatarIdentity | null;
	tier: SidebarMode;
}) {
	const { dismiss } = useAppNavigationPresentation();
	const isCollapsed = input.tier === "icon";
	const isFull = input.tier === "expanded";
	const isAvatarOnly = !isFull;
	const { currentOrganization, organizations } = useAppOrganization();
	const orderedOrganizations = useMemo(
		() => orderOrganizationsForOrganizationSelector(organizations),
		[organizations]
	);
	const currentOrganizationDisplay = resolveOrganizationDisplay({
		account: input.account,
		organization: currentOrganization,
	});
	const navigate = useNavigate();
	const router = useRouter();
	const currentPathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const [open, setOpen] = useState(false);
	const [isSwitching, setIsSwitching] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const organizationTooltipLabel = `${currentOrganizationDisplay.name} organization`;
	const handleOpenChange = (nextOpen: boolean) => {
		if (isSwitching && !nextOpen) {
			return;
		}
		setOpen(nextOpen);
		if (!nextOpen) {
			setErrorMessage(null);
		}
	};

	const switchOrganization = async (
		nextOrganization: OrganizationSummary
	): Promise<void> => {
		if (isSwitching) {
			return;
		}
		const shouldNavigate = nextOrganization.id !== currentOrganization.id;

		setIsSwitching(true);
		setErrorMessage(null);
		try {
			await selectLastSelectedOrganization(nextOrganization.id);
			if (shouldNavigate) {
				await navigate({
					to: resolveOrganizationSwitchPath({
						currentPathname,
						nextOrgSlug: nextOrganization.slug,
					}),
				});
			} else {
				await router.invalidate({ sync: true });
			}
			setOpen(false);
			dismiss();
		} catch (error) {
			setErrorMessage(
				error instanceof Error
					? error.message
					: "OpenMeld could not switch organizations."
			);
		} finally {
			setIsSwitching(false);
		}
	};

	const openDestination = (to: string, fallbackMessage: string) => {
		if (isSwitching) {
			return;
		}

		setIsSwitching(true);
		setErrorMessage(null);
		navigate({ to })
			.then(() => {
				setOpen(false);
				dismiss();
			})
			.catch((error: unknown) => {
				setErrorMessage(
					error instanceof Error ? error.message : fallbackMessage
				);
			})
			.finally(() => {
				setIsSwitching(false);
			});
	};
	const openCreateOrganization = () => {
		openDestination(
			buildOrganizationNewOrganizationPath(currentOrganization.slug),
			"OpenMeld could not open organization setup."
		);
	};
	const openManageOrganizations = () => {
		openDestination(
			buildOrganizationOrganizationsPath(currentOrganization.slug),
			"OpenMeld could not open organization management."
		);
	};
	const popoverTrigger = (
		<Popover.Trigger
			render={
				<button
					aria-expanded={open}
					aria-haspopup="menu"
					aria-label="Switch organization"
					className={cn(
						"flex min-w-0 items-center rounded-md bg-transparent text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70",
						isAvatarOnly
							? "size-9 justify-center"
							: "h-7 w-full gap-1 ps-1 pe-[7px]"
					)}
					disabled={isSwitching}
					type="button"
				/>
			}
		>
			<OrganizationAvatar
				account={input.account}
				humanProfileAvatar={input.humanProfileAvatar}
				organization={currentOrganization}
				organizationDisplay={currentOrganizationDisplay}
				placement="rail"
			/>
			{isAvatarOnly ? null : (
				<span className="flex min-w-0 flex-1 items-center">
					<span className="truncate font-medium text-[13px] text-foreground leading-5">
						{currentOrganizationDisplay.name}
					</span>
				</span>
			)}
			{isFull ? (
				<CaretDownIcon aria-hidden="true" className="size-3.5 shrink-0" />
			) : null}
		</Popover.Trigger>
	);

	return (
		<div
			className={cn(
				"min-w-0",
				isAvatarOnly ? "flex flex-col items-center" : null
			)}
		>
			<Popover.Root modal={false} onOpenChange={handleOpenChange} open={open}>
				{isCollapsed ? (
					<CollapsedRailTooltip label={organizationTooltipLabel}>
						{popoverTrigger}
					</CollapsedRailTooltip>
				) : (
					popoverTrigger
				)}
				<OrganizationSwitcherPopover
					account={input.account}
					currentOrganization={currentOrganization}
					errorMessage={errorMessage}
					humanProfileAvatar={input.humanProfileAvatar}
					isSwitching={isSwitching}
					onCreateOrganization={openCreateOrganization}
					onManageOrganizations={openManageOrganizations}
					onSwitchOrganization={switchOrganization}
					organizations={orderedOrganizations}
				/>
			</Popover.Root>
		</div>
	);
}

function OrganizationSwitcherPopover(input: {
	account: AppOuterRailAccount;
	currentOrganization: OrganizationSummary;
	errorMessage: string | null;
	humanProfileAvatar: HumanProfileAvatarIdentity | null;
	isSwitching: boolean;
	onCreateOrganization: () => void;
	onManageOrganizations: () => void;
	onSwitchOrganization: (organization: OrganizationSummary) => void;
	organizations: readonly OrganizationSummary[];
}) {
	return (
		<Popover.Portal>
			<Popover.Positioner
				align="start"
				className="z-50"
				collisionAvoidance={{
					align: "shift",
					fallbackAxisSide: "end",
					side: "flip",
				}}
				collisionPadding={12}
				side="right"
				sideOffset={8}
			>
				<Popover.Popup
					className="relative isolate w-72 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
					finalFocus={false}
					role="menu"
				>
					<div className="px-2 py-2">
						<p className="font-medium text-foreground text-xs">Organization</p>
					</div>
					<output
						aria-atomic="true"
						aria-live="polite"
						className={cn(
							input.errorMessage
								? "mx-2 mb-2 block rounded-sm bg-destructive/10 px-2.5 py-2 text-destructive text-xs leading-snug"
								: "sr-only"
						)}
					>
						{input.errorMessage ?? ""}
					</output>
					<ScrollArea className="max-h-72">
						<FluidActionList
							aria-label="Organizations"
							hoverIndicatorClassName="bg-interaction-hover"
						>
							{input.organizations.map((organization, index) => {
								const organizationDisplay = resolveOrganizationDisplay({
									account: input.account,
									organization,
								});
								const selected =
									organization.id === input.currentOrganization.id;
								return (
									<FluidActionListItem
										aria-checked={selected}
										aria-current={selected ? "true" : undefined}
										className={cn(
											"flex min-h-11 w-full min-w-0 items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm disabled:cursor-wait disabled:opacity-70",
											selected
												? "bg-interaction-active text-foreground"
												: "text-muted-foreground"
										)}
										disabled={input.isSwitching}
										index={index}
										key={organization.id}
										onClick={() => input.onSwitchOrganization(organization)}
										role="menuitemradio"
										type="button"
									>
										<OrganizationAvatar
											account={input.account}
											humanProfileAvatar={input.humanProfileAvatar}
											organization={organization}
											organizationDisplay={organizationDisplay}
											placement="menu"
										/>
										<span className="grid min-w-0 flex-1 gap-0.5 leading-tight">
											<span className="truncate font-medium">
												{organizationDisplay.name}
											</span>
											<span className="truncate text-xs">
												{organization.isPersonal
													? "Personal workspace"
													: "Organization"}
											</span>
										</span>
									</FluidActionListItem>
								);
							})}
						</FluidActionList>
					</ScrollArea>
					<OrganizationSwitcherActions
						disabled={input.isSwitching}
						onCreateOrganization={input.onCreateOrganization}
						onManageOrganizations={input.onManageOrganizations}
					/>
				</Popover.Popup>
			</Popover.Positioner>
		</Popover.Portal>
	);
}

function OrganizationSwitcherActions(input: {
	disabled: boolean;
	onCreateOrganization: () => void;
	onManageOrganizations: () => void;
}) {
	return (
		<FluidActionList
			aria-label="Organization actions"
			className="mt-1 border-border border-t pt-1"
			hoverIndicatorClassName="bg-interaction-hover"
		>
			<FluidActionListItem
				className="flex min-h-12 w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-muted-foreground text-sm disabled:cursor-wait disabled:opacity-70"
				disabled={input.disabled}
				index={0}
				onClick={input.onCreateOrganization}
				role="menuitem"
				type="button"
			>
				<PlusIcon aria-hidden="true" className="size-4 shrink-0" />
				<span className="grid min-w-0 gap-0.5 leading-tight">
					<span className="block font-medium text-foreground">
						Create organization
					</span>
					<span className="block text-xs">
						Set up shared work with your team.
					</span>
				</span>
			</FluidActionListItem>
			<FluidActionListItem
				className="flex min-h-12 w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-muted-foreground text-sm disabled:cursor-wait disabled:opacity-70"
				disabled={input.disabled}
				index={1}
				onClick={input.onManageOrganizations}
				role="menuitem"
				type="button"
			>
				<BuildingsIcon aria-hidden="true" className="size-4 shrink-0" />
				<span className="grid min-w-0 gap-0.5 leading-tight">
					<span className="block font-medium text-foreground">
						Manage organizations
					</span>
					<span className="block text-xs">
						Browse and manage your organizations.
					</span>
				</span>
			</FluidActionListItem>
		</FluidActionList>
	);
}

function orderOrganizationsForOrganizationSelector(
	organizations: readonly OrganizationSummary[]
): OrganizationSummary[] {
	return [...organizations].sort((left, right) => {
		if (left.isPersonal === true && right.isPersonal !== true) {
			return -1;
		}
		if (right.isPersonal === true && left.isPersonal !== true) {
			return 1;
		}
		return left.name.localeCompare(right.name);
	});
}

function resolveOrganizationDisplay(input: {
	account: AppOuterRailAccount;
	organization: OrganizationSummary;
}): { fallback: string; image?: string | null; name: string } {
	if (input.organization.isPersonal) {
		const name =
			input.account.name?.trim() ||
			input.account.email?.trim() ||
			input.organization.name;
		return {
			fallback: resolveIdentityFallback(name),
			image: input.account.image,
			name,
		};
	}

	return {
		fallback: resolveIdentityFallback(input.organization.name),
		image: input.organization.logo,
		name: input.organization.name,
	};
}

function resolveIdentityFallback(displayName: string): string {
	const trimmed = displayName.trim();
	return (trimmed[0] ?? "A").toUpperCase();
}

function OrganizationAvatar(input: {
	account: AppOuterRailAccount;
	humanProfileAvatar: HumanProfileAvatarIdentity | null;
	organizationDisplay: {
		fallback: string;
		image?: string | null;
		name: string;
	};
	organization: OrganizationSummary;
	placement: "menu" | "rail";
}) {
	if (input.organization.isPersonal && input.humanProfileAvatar) {
		const size = input.placement === "rail" ? 20 : 28;
		return (
			<DitherProfileAvatar
				avatarImageUrl={input.humanProfileAvatar.avatarImageUrl}
				className={cn(
					"shrink-0",
					input.placement === "rail" ? "size-5" : "size-7"
				)}
				data-testid={
					input.placement === "menu"
						? "personal-workspace-human-profile-avatar"
						: "personal-workspace-rail-human-profile-avatar"
				}
				profileId={input.humanProfileAvatar.profileId}
				profileKind="human"
				profileName={input.humanProfileAvatar.profileName}
				size={size}
			/>
		);
	}

	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex shrink-0 items-center justify-center overflow-hidden bg-background text-foreground",
				input.placement === "rail"
					? "size-5 text-[0.6875rem]"
					: "size-7 text-xs",
				input.organization.isPersonal ? "rounded-full" : "rounded-sm"
			)}
			style={
				input.organizationDisplay.image
					? {
							backgroundImage: `url(${input.organizationDisplay.image})`,
							backgroundPosition: "center",
							backgroundSize: "cover",
						}
					: undefined
			}
		>
			{input.organizationDisplay.image
				? null
				: input.organizationDisplay.fallback}
		</span>
	);
}
