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
	label: string;
	sort: Sort;
	disabled: boolean;
	onSort: (sort: Sort) => void;
	onNewItem?: () => void;
	newItemLabel?: string;
	addLabel?: string;
	onNewGroup?: (name: string) => void;
	onDelete?: () => void;
	sortOptions?: readonly (readonly [Sort, string])[];
}) {
	const rename = useSidebarGroupRename();
	const [addOpen, setAddOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [creatingGroup, setCreatingGroup] = useState(false);
	const [name, setName] = useState("");
	const nameId = useId();
	const addLabel =
		input.addLabel ?? (input.onNewItem ? "Add Space or group" : "New group");
	const selectedSort =
		!input.sortOptions && input.sort === "name" ? "recent" : input.sort;
	const sorts: readonly (readonly [Sort, string])[] = input.sortOptions ?? [
		["priority", "Priority"],
		["recent", "Recently added"],
		["manual", "Manual order"],
	];
	return (
		<>
			<SidebarGroupActions
				className="static h-6 opacity-0 group-focus-within/sidebar-group-root:opacity-100 group-hover/sidebar-group-root:opacity-100 data-open:opacity-100 [@media(hover:none)]:opacity-100"
				data-open={addOpen || settingsOpen || undefined}
			>
				{(input.onNewItem || input.onNewGroup) && (
					<DropdownMenu onOpenChange={setAddOpen} open={addOpen}>
						<Tooltip>
							<TooltipTrigger
								render={
									<DropdownMenuTrigger
										render={<SidebarGroupAction aria-label={addLabel} />}
									/>
								}
							>
								<PlusIcon />
							</TooltipTrigger>
							<TooltipContent>{addLabel}</TooltipContent>
						</Tooltip>
						<FluidDropdownMenuContent align="end" className="w-48">
							{input.onNewItem && (
								<FluidDropdownMenuItem index={0} onClick={input.onNewItem}>
									{input.newItemLabel ?? "New Space"}
								</FluidDropdownMenuItem>
							)}
							<FluidDropdownMenuItem
								disabled={input.disabled}
								index={input.onNewItem ? 1 : 0}
								onClick={() => setCreatingGroup(true)}
							>
								New group
							</FluidDropdownMenuItem>
						</FluidDropdownMenuContent>
					</DropdownMenu>
				)}
				<DropdownMenu onOpenChange={setSettingsOpen} open={settingsOpen}>
					<Tooltip>
						<TooltipTrigger
							render={
								<DropdownMenuTrigger
									render={
										<SidebarGroupAction
											aria-label={`${input.label} section settings`}
										/>
									}
								/>
							}
						>
							<SlidersHorizontalIcon />
						</TooltipTrigger>
						<TooltipContent>Section settings</TooltipContent>
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
								Rename group
							</FluidDropdownMenuItem>
						)}
						{input.onDelete && (
							<FluidDropdownMenuItem
								disabled={input.disabled}
								index={sorts.length + 1}
								onClick={input.onDelete}
							>
								Delete group
							</FluidDropdownMenuItem>
						)}
					</FluidDropdownMenuContent>
				</DropdownMenu>
			</SidebarGroupActions>
			<Dialog onOpenChange={setCreatingGroup} open={creatingGroup}>
				<DialogContent className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle>New group</DialogTitle>
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
						<label htmlFor={nameId}>Group name</label>
						<Input
							id={nameId}
							maxLength={80}
							onChange={(event) => setName(event.target.value)}
							value={name}
						/>
						<Button disabled={input.disabled || !name.trim()} type="submit">
							Create group
						</Button>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
