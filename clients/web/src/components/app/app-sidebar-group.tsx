"use client";

import { Collapsible } from "@base-ui/react/collapsible";
import { Input } from "@openmeld/ui/components/input";
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
	useRef,
	useState,
} from "react";
import { useSortableSidebarGroup } from "./sidebar-drag";

const SidebarGroupRenameContext = createContext<(() => void) | null>(null);
export function useSidebarGroupRename() {
	return useContext(SidebarGroupRenameContext);
}

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

export function ControlledSidebarGroupStateProvider(input: {
	children: ReactNode;
	value: AppSidebarGroupState;
}) {
	return (
		<AppSidebarGroupStateContext.Provider value={input.value}>
			{input.children}
		</AppSidebarGroupStateContext.Provider>
	);
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
	reorderId?: string;
	onRename?: (name: string) => void;
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
	const [editing, setEditing] = useState(false);
	const drag = useSortableSidebarGroup(input.reorderId, input.labelText);
	const [draft, setDraft] = useState(input.labelText);
	const editingRef = useRef(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const focusEditor = useCallback((node: HTMLInputElement | null) => {
		if (node) {
			requestAnimationFrame(() => {
				if (node.isConnected) {
					node.focus({ preventScroll: true });
					node.select();
				}
			});
		}
	}, []);
	const finish = (save: boolean) => {
		if (!editingRef.current) {
			return;
		}
		editingRef.current = false;
		setEditing(false);
		const name = draft.trim();
		if (save && name && name !== input.labelText) {
			input.onRename?.(name);
		}
	};
	const rename = input.onRename
		? () => {
				setDraft(input.labelText);
				editingRef.current = true;
				setEditing(true);
			}
		: null;
	const state = useContext(AppSidebarGroupStateContext);
	const rootStateProps = state
		? {
				onOpenChange: (open: boolean) => state.setOpen(input.groupId, open),
				open: state.isOpen(input.groupId),
			}
		: { defaultOpen: true };

	const trigger = (
		<Collapsible.Trigger
			{...drag.rowProps}
			aria-label={input.labelText}
			className="group/sidebar-group-trigger inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
			ref={triggerRef}
		>
			<span className="min-w-0">{input.label}</span>
			<CaretRightIcon
				aria-hidden="true"
				className="size-3 shrink-0 transition-transform duration-150 ease-[cubic-bezier(0.645,0.045,0.355,1)] group-data-[panel-open]/sidebar-group-trigger:rotate-90 motion-reduce:transition-none"
				data-slot="sidebar-group-caret"
			/>
		</Collapsible.Trigger>
	);
	let heading = input.labelTooltip ? (
		<Tooltip>
			<TooltipTrigger render={trigger} />
			<TooltipContent side="top">{input.labelTooltip}</TooltipContent>
		</Tooltip>
	) : (
		trigger
	);
	if (editing) {
		heading = (
			<Input
				aria-label="Group name"
				className="h-6 min-w-0 flex-1 px-1 text-xs"
				maxLength={80}
				onBlur={() => finish(true)}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						finish(event.key === "Enter");
						requestAnimationFrame(() =>
							triggerRef.current?.focus({ preventScroll: true })
						);
					}
				}}
				ref={focusEditor}
				value={draft}
			/>
		);
	}

	return (
		<SidebarGroupRenameContext.Provider value={rename}>
			<Collapsible.Root
				className="group/sidebar-group-root"
				data-sidebar-group-id={input.groupId}
				ref={drag.ref}
				style={drag.style}
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
						{heading}
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
		</SidebarGroupRenameContext.Provider>
	);
}
