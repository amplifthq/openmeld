"use client";

import { FluidCardItem } from "@openmeld/ui/fluid/card";
import { FluidContextMenu } from "@openmeld/ui/fluid/context-menu";
import { FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import { SidebarMenuButton } from "@openmeld/ui/fluid/sidebar-menu";
import { cn } from "@openmeld/ui/lib/utils";
import {
	APP_NAV_ITEM_TONE_CLASS_NAME,
	APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
} from "#/components/app/app-nav-item-style";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { ProfileMenuItems } from "#/components/app/profile-menu-items";
import { DirectoryHumanProfileAvatar } from "#/components/directory/directory-human-profile-avatar";
import type { DirectoryHumanProfileRow } from "#/components/directory/directory-human-profile-model";
import { DirectoryComputerStatusIcon } from "#/components/directory/directory-human-profile-presentation";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationPersonPath } from "#/lib/organizations/organization-routes";
import type { useSortableSidebarItem } from "../app/sidebar-drag";

export function HumanProfileItem(input: {
	index: number;
	isActive: boolean;
	member: DirectoryHumanProfileRow;
	onSelect: (profileId: string) => void;
	drag?: ReturnType<typeof useSortableSidebarItem>;
	starred?: boolean;
	actionsDisabled?: boolean;
	onToggleStar?: () => void;
	onChat?: () => void;
	presentation?: "card" | "sidebar";
}) {
	const { dismiss } = useAppNavigationPresentation();
	const { currentOrganization } = useAppOrganization();
	const card = input.presentation === "card";
	const openProfile = () => {
		input.onSelect(input.member.id);
		dismiss();
	};
	const row = (
		<SidebarMenuButton
			{...input.drag?.rowProps}
			aria-current={input.isActive ? "page" : undefined}
			aria-description={input.member.computer.label}
			aria-label={`Open ${input.member.name}'s profile`}
			className={cn(
				"h-auto min-w-0 flex-row items-center gap-2 py-1 text-left",
				APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
				APP_NAV_ITEM_TONE_CLASS_NAME,
				card && "min-h-16 w-full gap-3 px-4 py-2 text-foreground",
				input.isActive && "text-sidebar-accent-foreground"
			)}
			isActive={input.isActive}
			onClick={openProfile}
			type="button"
			// A Team card is not a row of a roving-focus menu, so it must be its
			// own tab stop; otherwise no keyboard path opens the member profile.
			{...(card ? { tabIndex: 0 } : {})}
		>
			<DirectoryHumanProfileAvatar
				context={card ? "card" : "sidebar"}
				member={input.member}
			/>
			<span
				className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden whitespace-nowrap"
				data-sidebar="menu-heading"
				data-slot="human-profile-sidebar-heading"
			>
				<span
					className={cn(
						"min-w-0 truncate font-medium text-[13px]",
						card && "text-sm"
					)}
				>
					{input.member.name}
				</span>
				{input.member.isCurrentUser ? (
					<span className="shrink-0 text-muted-foreground text-xs">(you)</span>
				) : null}
				<DirectoryComputerStatusIcon member={input.member} />
			</span>
		</SidebarMenuButton>
	);

	return (
		<FluidContextMenu
			target={
				card ? (
					<FluidCardItem
						className="border border-border"
						itemId={input.member.id}
						role="listitem"
					>
						{row}
					</FluidCardItem>
				) : (
					<FluidNavMenuItem
						className="relative"
						index={input.index}
						ref={input.drag?.ref}
						style={input.drag?.style}
						value={input.member.id}
					>
						{row}
					</FluidNavMenuItem>
				)
			}
		>
			<ProfileMenuItems
				disabled={input.actionsDisabled}
				href={buildOrganizationPersonPath({
					orgSlug: currentOrganization.slug,
					personId: input.member.id,
				})}
				onChat={input.onChat}
				onOpen={openProfile}
				onToggleStar={input.onToggleStar}
				starred={input.starred}
			/>
		</FluidContextMenu>
	);
}
