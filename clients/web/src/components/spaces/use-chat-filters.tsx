import {
	DropdownMenuCheckboxItem,
	DropdownMenuItem,
} from "@openmeld/ui/components/dropdown-menu";
import {
	ArchiveIcon,
	MagnifyingGlassIcon,
	RobotIcon,
	UsersIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useSidebarFilter } from "#/components/app/sidebar-filter";
import { SidebarFilterBadge } from "#/components/app/sidebar-filter-badge";

export function useChatFilters(onSearch: () => void) {
	const category = useSidebarFilter(
		[
			{ id: "human", label: "People", icon: UsersIcon },
			{ id: "agent", label: "Agents", icon: RobotIcon },
		],
		"All direct messages"
	);
	const [archived, setArchived] = useState(false);
	return {
		...category,
		archived,
		setArchived,
		sectionFilter: {
			label: "Archived direct messages",
			checked: archived,
			onCheckedChange: setArchived,
		},
		menu: (
			<>
				<DropdownMenuItem onClick={() => requestAnimationFrame(onSearch)}>
					<MagnifyingGlassIcon />
					Search direct messages
				</DropdownMenuItem>
				{category.menu}
				<DropdownMenuCheckboxItem
					checked={archived}
					onCheckedChange={setArchived}
				>
					<ArchiveIcon /> Archived direct messages
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
