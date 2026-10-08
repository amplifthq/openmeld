import { DropdownMenuSub } from "@openmeld/ui/components/dropdown-menu";
import {
	FluidDropdownMenuCheckboxItem as DropdownMenuCheckboxItem,
	FluidDropdownMenuSubContent as DropdownMenuSubContent,
	FluidDropdownMenuSubTrigger as DropdownMenuSubTrigger,
	FluidDropdownMenuGroup,
} from "@openmeld/ui/fluid/dropdown-menu";
import { FolderIcon, type Icon, ListIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { SidebarFilterBadge } from "./sidebar-filter-badge";

type SidebarFilterOption = { id: string; label: string; icon?: Icon };

export function useSidebarFilter(
	options: readonly SidebarFilterOption[],
	allLabel: string
) {
	const [selection, setSelection] = useState<string[]>([]);
	// Removed options no longer constrain the list.
	const selected = selection.filter((id) =>
		options.some((option) => option.id === id)
	);
	const toggle = (id: string) =>
		setSelection(
			selected.includes(id)
				? selected.filter((value) => value !== id)
				: [...selected, id]
		);
	return {
		selected,
		includes: (id: string) => selected.length === 0 || selected.includes(id),
		menu: (
			<FluidDropdownMenuGroup>
				<DropdownMenuCheckboxItem
					checked={selected.length === 0}
					closeOnClick={false}
					index={0}
					onCheckedChange={() => setSelection([])}
				>
					<ListIcon /> {allLabel}
				</DropdownMenuCheckboxItem>
				{options.map((option, index) => (
					<DropdownMenuCheckboxItem
						checked={selected.includes(option.id)}
						closeOnClick={false}
						index={index + 1}
						key={option.id}
						onCheckedChange={() => toggle(option.id)}
					>
						{option.icon ? <option.icon /> : <FolderIcon />}
						<span className="min-w-0 text-left [overflow-wrap:anywhere]">
							{option.label}
						</span>
					</DropdownMenuCheckboxItem>
				))}
			</FluidDropdownMenuGroup>
		),
		badges:
			selected.length > 0 ? (
				<div className="flex flex-wrap gap-1 px-1 pt-1">
					{options
						.filter((option) => selected.includes(option.id))
						.map((option) => (
							<SidebarFilterBadge
								key={option.id}
								label={option.label}
								onRemove={() => toggle(option.id)}
							/>
						))}
				</div>
			) : null,
	};
}

export function useSidebarGroupFilter(
	options: readonly SidebarFilterOption[],
	index?: number
) {
	const filter = useSidebarFilter(options, "All groups");
	const menu = (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger index={index ?? 0}>
				<FolderIcon />
				Groups
				{filter.selected.length > 0 ? ` (${filter.selected.length})` : ""}
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="max-h-80 w-60">
				{filter.menu}
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
	return {
		...filter,
		menu:
			index === undefined ? (
				<FluidDropdownMenuGroup>{menu}</FluidDropdownMenuGroup>
			) : (
				menu
			),
	};
}
