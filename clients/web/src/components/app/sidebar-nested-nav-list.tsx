import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	SidebarMenuBadge,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@openmeld/ui/fluid/sidebar-menu";
import { cn } from "@openmeld/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAppNavigationPresentation } from "./app-navigation-presentation";

export type SidebarNestedNavItem = {
	id: string;
	label: string;
	to: string;
	/** Trailing marks, e.g. SpaceStatusIndicator. */
	accessory?: ReactNode;
	/** Include accessory meaning when the visible label alone is insufficient. */
	ariaLabel?: string;
};

export type SidebarNestedNavSection = {
	id: string;
	/** Shown above the section's rows when the list has several sections. */
	label?: string;
	/** Shown in place of the rows, e.g. a load failure. */
	notice?: ReactNode;
	items: readonly SidebarNestedNavItem[];
};

/**
 * Children of one sidebar row, indented under it and joined by the shared
 * sub-menu guide line, e.g. an Agent's chats under the Agent. Renders inside
 * the parent row's menu item so one hover highlight moves between the parent
 * and its children; a long list scrolls inside its own max height.
 */
export function SidebarNestedNavList(input: {
	ariaLabel: string;
	activeItemId: string | null;
	sections: readonly SidebarNestedNavSection[];
	/** Aligns the guide line under the parent row's icon. */
	className?: string;
	maxHeightClassName?: string;
	/** Collapses the children under their parent row; defaults to open. */
	open?: boolean;
	/** For the parent row's toggle to reference with aria-controls. */
	id?: string;
}) {
	const { dismiss } = useAppNavigationPresentation();
	const labeled = input.sections.length > 1;
	return (
		<ScrollArea
			aria-label={input.ariaLabel}
			className={cn(
				input.open === false ? null : "mt-0.5",
				input.maxHeightClassName ?? "max-h-64"
			)}
			data-slot="sidebar-nested-nav-list"
			id={input.id}
			role="navigation"
		>
			<SidebarMenuSub
				className={cn("border-foreground/15", input.className)}
				open={input.open}
			>
				{input.sections.flatMap((section) => [
					...(labeled && section.label
						? [
								<li
									className="truncate px-2 pt-1.5 pb-0.5 text-muted-foreground text-xs"
									key={`${section.id}:label`}
									role="presentation"
								>
									{section.label}
								</li>,
							]
						: []),
					...(section.notice
						? [
								<li
									className="px-2 py-1 text-muted-foreground text-xs"
									key={`${section.id}:notice`}
									role="presentation"
								>
									{section.notice}
								</li>,
							]
						: []),
					...section.items.map((item) => (
						<SidebarMenuSubItem data-nested-nav-item={item.id} key={item.id}>
							<SidebarMenuSubButton
								aria-label={item.ariaLabel ?? item.label}
								asChild
								isActive={item.id === input.activeItemId}
							>
								<Link
									onClick={(event) => {
										if (
											!(
												event.metaKey ||
												event.ctrlKey ||
												event.shiftKey ||
												event.altKey
											)
										) {
											dismiss();
										}
									}}
									resetScroll={false}
									to={item.to}
								>
									{item.label}
								</Link>
							</SidebarMenuSubButton>
							{item.accessory ? (
								<SidebarMenuBadge className="pointer-events-none">
									{item.accessory}
								</SidebarMenuBadge>
							) : null}
						</SidebarMenuSubItem>
					)),
				])}
			</SidebarMenuSub>
		</ScrollArea>
	);
}
