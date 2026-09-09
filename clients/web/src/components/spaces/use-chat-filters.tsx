import {
	DropdownMenuCheckboxItem,
	DropdownMenuItem,
} from "@openmeld/ui/components/dropdown-menu";
import { useState } from "react";
import { useSidebarFilter } from "#/components/app/sidebar-filter";
import { SidebarFilterBadge } from "#/components/app/sidebar-filter-badge";

export function useChatFilters(onSearch: () => void) {
	const category = useSidebarFilter(
		[
			{ id: "human", label: "People" },
			{ id: "agent", label: "Agents" },
		],
		"All chats"
	);
	const [archived, setArchived] = useState(false);
	return {
		...category,
		archived,
		setArchived,
		sectionFilter: {
			label: "Archived chats",
			checked: archived,
			onCheckedChange: setArchived,
		},
		menu: (
			<>
				<DropdownMenuItem onClick={() => requestAnimationFrame(onSearch)}>
					Search chats
				</DropdownMenuItem>
				{category.menu}
				<DropdownMenuCheckboxItem
					checked={archived}
					onCheckedChange={setArchived}
				>
					Archived chats
				</DropdownMenuCheckboxItem>
			</>
		),
		badges: (
			<>
				{category.badges}
				{archived && (
					<div className="px-1 pt-1">
						<SidebarFilterBadge
							label="Archived"
							onRemove={() => setArchived(false)}
						/>
					</div>
				)}
			</>
		),
	};
}
