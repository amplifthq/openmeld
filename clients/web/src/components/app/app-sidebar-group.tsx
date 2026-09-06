"use client";

import { Collapsible } from "@base-ui/react/collapsible";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
} from "@openmeld/ui/components/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { cn } from "@openmeld/ui/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
} from "react";

type AppSidebarGroupState = {
	isOpen: (groupId: string) => boolean;
	setOpen: (groupId: string, open: boolean) => void;
};

const AppSidebarGroupStateContext = createContext<AppSidebarGroupState | null>(
	null
);

export function useAppSidebarGroupState() {
	return useContext(AppSidebarGroupStateContext);
}

const EMPTY_COLLAPSED_GROUP_IDS: readonly string[] = [];

export function AppSidebarGroupStateProvider({
	children,
	collapsedGroupIds = EMPTY_COLLAPSED_GROUP_IDS,
	onCollapsedGroupIdsChange,
}: {
	children: ReactNode;
	collapsedGroupIds?: readonly string[];
	onCollapsedGroupIdsChange: (groupIds: readonly string[]) => void;
}) {
	const collapsedGroupIdSet = useMemo(
		() => new Set(collapsedGroupIds),
		[collapsedGroupIds]
	);
	const isOpen = useCallback(
		(groupId: string) => !collapsedGroupIdSet.has(groupId),
		[collapsedGroupIdSet]
	);
	const setOpen = useCallback(
		(groupId: string, open: boolean) => {
			const isCurrentlyOpen = !collapsedGroupIdSet.has(groupId);
			if (open === isCurrentlyOpen) {
				return;
			}
			onCollapsedGroupIdsChange(
				open
					? collapsedGroupIds.filter((id) => id !== groupId)
					: [...collapsedGroupIds, groupId]
			);
		},
		[collapsedGroupIdSet, collapsedGroupIds, onCollapsedGroupIdsChange]
	);
	const value = useMemo(() => ({ isOpen, setOpen }), [isOpen, setOpen]);

	return (
		<AppSidebarGroupStateContext.Provider value={value}>
			{children}
		</AppSidebarGroupStateContext.Provider>
	);
}

export function AppSidebarGroup(input: {
	children: ReactNode;
	contentAriaLabel?: string;
	contentRole?: "region";
	groupClassName?: string;
	groupId: string;
	label: ReactNode;
	labelAccessory?: ReactNode;
	labelClassName?: string;
	labelText: string;
	labelTooltip?: string;
}) {
	const state = useContext(AppSidebarGroupStateContext);
	const rootStateProps = state
		? {
				onOpenChange: (open: boolean) => state.setOpen(input.groupId, open),
				open: state.isOpen(input.groupId),
			}
		: { defaultOpen: true };

	const trigger = (
		<Collapsible.Trigger
			aria-label={input.labelText}
			className="group/sidebar-group-trigger inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
		>
			<span className="min-w-0">{input.label}</span>
			<CaretRightIcon
				aria-hidden="true"
				className="size-3 shrink-0 transition-transform duration-150 ease-[cubic-bezier(0.645,0.045,0.355,1)] group-data-[panel-open]/sidebar-group-trigger:rotate-90 motion-reduce:transition-none"
				data-slot="sidebar-group-caret"
			/>
		</Collapsible.Trigger>
	);

	return (
		<Collapsible.Root
			className="group/sidebar-group-root"
			data-sidebar-group-id={input.groupId}
			{...rootStateProps}
		>
			<SidebarGroup className={input.groupClassName}>
				<SidebarGroupLabel
					aria-label={input.labelText}
					className={cn(
						"flex min-w-0 items-center gap-1",
						input.labelClassName
					)}
				>
					{input.labelTooltip ? (
						<Tooltip>
							<TooltipTrigger render={trigger} />
							<TooltipContent side="top">{input.labelTooltip}</TooltipContent>
						</Tooltip>
					) : (
						trigger
					)}
					{input.labelAccessory ? (
						<span className="ml-auto flex shrink-0 items-center">
							{input.labelAccessory}
						</span>
					) : null}
				</SidebarGroupLabel>
				<Collapsible.Panel>
					<SidebarGroupContent
						aria-label={input.contentAriaLabel}
						role={input.contentRole}
					>
						{input.children}
					</SidebarGroupContent>
				</Collapsible.Panel>
			</SidebarGroup>
		</Collapsible.Root>
	);
}
