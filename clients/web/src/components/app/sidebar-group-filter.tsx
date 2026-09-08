import {
	DropdownMenuCheckboxItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { useState } from "react";
import { SidebarFilterBadge } from "./sidebar-filter-badge";

export type SidebarFilterGroup = { id: string; label: string };

export function useSidebarGroupFilter(options: readonly SidebarFilterGroup[]) {
	const [selection, setSelection] = useState<string[]>([]);
	// Deleted groups no longer constrain the list.
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
			<DropdownMenuSub>
				<DropdownMenuSubTrigger>
					Groups{selected.length > 0 ? ` (${selected.length})` : ""}
				</DropdownMenuSubTrigger>
				<DropdownMenuSubContent className="max-h-80 w-60 overflow-y-auto">
					<DropdownMenuCheckboxItem
						checked={selected.length === 0}
						closeOnClick={false}
						onCheckedChange={() => setSelection([])}
					>
						All groups
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
				</DropdownMenuSubContent>
			</DropdownMenuSub>
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
