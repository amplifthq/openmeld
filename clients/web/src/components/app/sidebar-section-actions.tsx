import type { AccountSidebarPreferences } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { Input } from "@openmeld/ui/components/input";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import {
	SidebarGroupAction,
	SidebarGroupActions,
} from "@openmeld/ui/fluid/sidebar-group";
import {
	CheckIcon,
	PlusIcon,
	SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import { useId, useState } from "react";
import { useSidebarGroupRename } from "./app-sidebar-group";

type Sort = AccountSidebarPreferences["spaces"]["sort"];
export function SidebarSectionActions(input: {
	alwaysVisible?: boolean;
	label: string;
	sort: Sort;
	disabled: boolean;
	onSort: (sort: Sort) => void;
	onNewGroup?: (name: string) => void;
	groupNoun?: "folder" | "group";
	onDelete?: () => void;
	sortOptions?: readonly (readonly [Sort, string])[];
	filter?: {
		label: string;
		checked: boolean;
		onCheckedChange: (checked: boolean) => void;
	};
}) {
	const rename = useSidebarGroupRename();
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [creatingGroup, setCreatingGroup] = useState(false);
	const [name, setName] = useState("");
	const nameId = useId();
	const groupNoun = input.groupNoun ?? "group";
	const addLabel = `New ${groupNoun}`;
	const selectedSort =
		!input.sortOptions && input.sort === "name" ? "recent" : input.sort;
	const sorts: readonly (readonly [Sort, string])[] = input.sortOptions ?? [
		["priority", "Priority"],
		["recent", "Recent activity"],
		["manual", "Manual order"],
	];
	return (
		<>
			<SidebarGroupActions
				className="static hidden h-6 group-focus-within/sidebar-group-root:flex group-hover/sidebar-group-root:flex data-open:flex [@media(hover:none)]:flex"
				data-open={
					input.alwaysVisible || creatingGroup || settingsOpen || undefined
				}
			>
				{input.onNewGroup && (
					<Tooltip>
						<TooltipTrigger
							render={
								<SidebarGroupAction
									aria-label={addLabel}
									onClick={() => setCreatingGroup(true)}
									render={<button disabled={input.disabled} type="button" />}
								/>
							}
						>
							<PlusIcon aria-hidden="true" />
						</TooltipTrigger>
						<TooltipContent>{addLabel}</TooltipContent>
					</Tooltip>
				)}
				<DropdownMenu onOpenChange={setSettingsOpen} open={settingsOpen}>
					<Tooltip>
						<TooltipTrigger
							render={
								<DropdownMenuTrigger
									render={
										<SidebarGroupAction
											aria-label={`${input.label} ${groupNoun} settings`}
										/>
									}
								/>
							}
						>
							<SlidersHorizontalIcon />
						</TooltipTrigger>
						<TooltipContent>
							{groupNoun === "folder" ? "Folder settings" : "Group settings"}
						</TooltipContent>
					</Tooltip>
					<FluidDropdownMenuContent
						align="end"
						aria-label={`Sort ${input.label}`}
						className="w-48"
					>
						<p className="px-2 py-1 text-muted-foreground text-xs">Sort by</p>
						{sorts.map(([sort, label], index) => (
							<FluidDropdownMenuItem
								disabled={input.disabled}
								index={index}
								key={sort}
								onClick={() => input.onSort(sort)}
							>
								<CheckIcon
									aria-hidden="true"
									className={sort === selectedSort ? "" : "invisible"}
								/>
								{label}
								{sort === selectedSort && (
									<span className="sr-only">, selected</span>
								)}
							</FluidDropdownMenuItem>
						))}
						{rename && (
							<FluidDropdownMenuItem
								disabled={input.disabled}
								index={sorts.length}
								onClick={() => rename?.()}
							>
								Rename {groupNoun}
							</FluidDropdownMenuItem>
						)}
						{input.onDelete && (
							<FluidDropdownMenuItem
								disabled={input.disabled}
								index={sorts.length + 1}
								onClick={input.onDelete}
							>
								Delete {groupNoun}
							</FluidDropdownMenuItem>
						)}
						{input.filter && (
							<>
								<p className="mt-1 border-border border-t px-2 pt-2 pb-1 text-muted-foreground text-xs">
									Filter
								</p>
								<FluidDropdownMenuItem
									aria-checked={input.filter.checked}
									index={sorts.length + 2}
									onClick={() =>
										input.filter?.onCheckedChange(!input.filter.checked)
									}
									role="menuitemcheckbox"
								>
									<CheckIcon
										aria-hidden="true"
										className={input.filter.checked ? "" : "invisible"}
									/>
									{input.filter.label}
								</FluidDropdownMenuItem>
							</>
						)}
					</FluidDropdownMenuContent>
				</DropdownMenu>
			</SidebarGroupActions>
			<Dialog onOpenChange={setCreatingGroup} open={creatingGroup}>
				<DialogContent className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle>New {groupNoun}</DialogTitle>
					</DialogHeader>
					<form
						className="flex flex-col gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							if (!name.trim() || input.disabled) {
								return;
							}
							input.onNewGroup?.(name.trim());
							setCreatingGroup(false);
							setName("");
						}}
					>
						<label htmlFor={nameId}>
							{groupNoun === "folder" ? "Folder name" : "Group name"}
						</label>
						<Input
							id={nameId}
							maxLength={80}
							onChange={(event) => setName(event.target.value)}
							value={name}
						/>
						<Button disabled={input.disabled || !name.trim()} type="submit">
							Create {groupNoun}
						</Button>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
