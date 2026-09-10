import {
	DropdownMenuCheckboxItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { useState } from "react";
import { SidebarFilterBadge } from "./sidebar-filter-badge";

type SidebarFilterOption = { id: string; label: string };

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
			<>
				<DropdownMenuCheckboxItem
					checked={selected.length === 0}
					closeOnClick={false}
					onCheckedChange={() => setSelection([])}
				>
					{allLabel}
				</DropdownMenuCheckboxItem>
				{options.map((option) => (
					<DropdownMenuCheckboxItem
						checked={selected.includes(option.id)}
						closeOnClick={false}
						key={option.id}
						onCheckedChange={() => toggle(option.id)}
					>
						<span className="min-w-0 text-left [overflow-wrap:anywhere]">
							{option.label}
						</span>
					</DropdownMenuCheckboxItem>
				))}
			</>
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

export function useSidebarGroupFilter(options: readonly SidebarFilterOption[]) {
	const filter = useSidebarFilter(options, "All groups");
	return {
		...filter,
		menu: (
			<DropdownMenuSub>
				<DropdownMenuSubTrigger>
					Groups
					{filter.selected.length > 0 ? ` (${filter.selected.length})` : ""}
				</DropdownMenuSubTrigger>
				<DropdownMenuSubContent className="max-h-80 w-60 overflow-y-auto">
					{filter.menu}
				</DropdownMenuSubContent>
			</DropdownMenuSub>
		),
	};
}
