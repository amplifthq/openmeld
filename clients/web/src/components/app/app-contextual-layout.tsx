"use client";

import { SidebarContent } from "@openmeld/ui/components/sidebar";
import { FluidNavMenu, FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import { resolveStatusToneInteractiveTextClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import type { Icon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { MouseEvent, PointerEvent, ReactElement, ReactNode } from "react";
import type { ComputerAttentionTone } from "#/lib/computer-summary-status";
import { AppInnerSidebarHeader } from "./app-inner-sidebar";
import { AppMainContent } from "./app-main-content";
import {
	APP_NAV_GROUP_CLASS_NAME,
	APP_NAV_GROUP_LABEL_CLASS_NAME,
	APP_NAV_GROUP_SPACING_CLASS_NAME,
	APP_NAV_ITEM_FULL_DENSITY_CLASS_NAME,
	APP_NAV_ITEM_TONE_CLASS_NAME,
	APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
} from "./app-nav-item-style";
import { useAppNavigationPresentation } from "./app-navigation-presentation";
import { AppSidebarGroup } from "./app-sidebar-group";
import { CenterTruncatedText } from "./center-truncated-text";

export type AppContextualNavItem<ItemId extends string = string> = {
	id: ItemId;
	icon: Icon;
	label: string;
	accessory?: ReactNode;
	preserveSearch?: boolean;
	statusTone?: ComputerAttentionTone;
	to?: string;
};

type AppContextualNavGroupBase = {
	ariaLabel: string;
	id: string;
	label: string;
	labelAccessory?: ReactNode;
	labelTooltip?: string;
};

export type AppContextualNavGroup<ItemId extends string = string> =
	AppContextualNavGroupBase &
		(
			| {
					/** Specialized list content that still uses the shared group frame. */
					content: ReactElement;
					items?: never;
			  }
			| {
					content?: never;
					/** Standard contextual navigation rendered at the shared app-nav scale. */
					items: readonly AppContextualNavItem<ItemId>[];
			  }
		);

export type AppContextualSidebarNavProps<ItemId extends string> = {
	activeItemId: ItemId | null;
	ariaLabel: string;
	groups: readonly AppContextualNavGroup<ItemId>[];
	/** Optional primary action rendered before the first labeled group. */
	leadingContent?: ReactNode;
	onActivate?: (itemId: ItemId) => void;
	title: string;
	placement?: "main" | "secondary";
};

export function AppContextualContentFrame(input: {
	bodySlotName: string;
	children: ReactNode;
	contentClassName?: string;
	headerSlotName: string;
}) {
	return (
		<AppMainContent
			bodySlotName={input.bodySlotName}
			headerSlotName={input.headerSlotName}
			scroll
		>
			<div
				className={cn(
					"mx-auto w-full max-w-7xl px-4 pb-6 sm:px-6 lg:px-8",
					input.contentClassName
				)}
			>
				{input.children}
			</div>
		</AppMainContent>
	);
}

export function AppContextualSidebarNav<ItemId extends string>(
	input: AppContextualSidebarNavProps<ItemId>
) {
	const { presentation } = useAppNavigationPresentation();
	const isMain = input.placement === "main";
	const Content = isMain ? "div" : SidebarContent;
	return (
		<nav
			aria-label={input.ariaLabel}
			className={cn(
				"@container/contextual-sidebar flex w-full min-w-0 flex-col text-sidebar-foreground",
				!isMain && "h-full min-h-0"
			)}
			data-slot="app-contextual-sidebar"
		>
			{!isMain && <AppInnerSidebarHeader title={input.title} />}
			<Content className={isMain ? "min-w-0" : "px-3 pt-[9px] pb-2"}>
				{input.leadingContent ? (
					<div className="pb-4" data-slot="app-contextual-sidebar-leading">
						{input.leadingContent}
					</div>
				) : null}
				{input.groups.map((group, groupIndex) => (
					<AppSidebarGroup
						contentAriaLabel={
							group.content === undefined ? undefined : group.ariaLabel
						}
						contentRole={group.content === undefined ? undefined : "region"}
						groupClassName={cn(
							APP_NAV_GROUP_CLASS_NAME,
							groupIndex > 0 ? APP_NAV_GROUP_SPACING_CLASS_NAME : null
						)}
						groupId={isMain ? `${input.ariaLabel}:${group.id}` : group.id}
						key={group.id}
						label={
							<CenterTruncatedText
								className="min-w-0"
								text={group.label}
								title={group.label}
							/>
						}
						labelAccessory={group.labelAccessory}
						labelClassName={APP_NAV_GROUP_LABEL_CLASS_NAME}
						labelText={group.label}
						labelTooltip={group.labelTooltip}
					>
						{group.items !== undefined ? (
							<FluidNavMenu
								activeLayoutId={`secondary-sidebar-selection-${presentation}`}
								activeValue={input.activeItemId}
								aria-label={group.ariaLabel}
							>
								{group.items.map((item, index) => (
									<AppContextualSidebarNavItem
										index={index}
										isActive={item.id === input.activeItemId}
										item={item}
										key={item.id}
										onActivate={input.onActivate}
									/>
								))}
							</FluidNavMenu>
						) : (
							group.content
						)}
					</AppSidebarGroup>
				))}
			</Content>
		</nav>
	);
}

function AppContextualSidebarNavItem<ItemId extends string>(input: {
	index: number;
	isActive: boolean;
	item: AppContextualNavItem<ItemId>;
	onActivate?: (itemId: ItemId) => void;
}) {
	const { dismiss } = useAppNavigationPresentation();
	const Icon = input.item.icon;
	const content = (
		<span
			className={cn(
				"flex min-w-0 items-center border border-transparent",
				APP_NAV_ITEM_FULL_DENSITY_CLASS_NAME,
				APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
				APP_NAV_ITEM_TONE_CLASS_NAME,
				input.isActive ? "text-sidebar-accent-foreground" : null,
				resolveContextualNavStatusClassName(input.item.statusTone)
			)}
		>
			<Icon className="size-4 shrink-0" />
			<CenterTruncatedText className="flex-1" text={input.item.label} />
			{input.item.accessory}
		</span>
	);

	return (
		<FluidNavMenuItem index={input.index} value={input.item.id}>
			{input.item.to ? (
				<Link
					activeOptions={{ exact: true }}
					aria-current={input.isActive ? "page" : undefined}
					aria-label={input.item.label}
					className="block min-w-0 outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
					onClick={(event) => {
						if (isModifiedActivation(event)) {
							return;
						}

						input.onActivate?.(input.item.id);
						dismiss();
					}}
					onPointerDown={(event) => {
						if (event.button !== 0 || isModifiedActivation(event)) {
							return;
						}

						input.onActivate?.(input.item.id);
					}}
					search={input.item.preserveSearch ? true : undefined}
					to={input.item.to}
				>
					{content}
				</Link>
			) : (
				<button
					aria-current={input.isActive ? "page" : undefined}
					aria-label={input.item.label}
					className="block w-full min-w-0 text-left outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
					onClick={() => {
						input.onActivate?.(input.item.id);
						dismiss();
					}}
					type="button"
				>
					{content}
				</button>
			)}
		</FluidNavMenuItem>
	);
}

function isModifiedActivation(event: MouseEvent | PointerEvent): boolean {
	return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function resolveContextualNavStatusClassName(
	tone: ComputerAttentionTone | undefined
): string | null {
	return tone ? resolveStatusToneInteractiveTextClassName(tone) : null;
}
