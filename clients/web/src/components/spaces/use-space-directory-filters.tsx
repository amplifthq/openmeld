import {
	DropdownMenuCheckboxItem,
	DropdownMenuItem,
} from "@openmeld/ui/components/dropdown-menu";
import { useState } from "react";
import { useSidebarGroupFilter } from "#/components/app/sidebar-filter";
import { SidebarFilterBadge } from "#/components/app/sidebar-filter-badge";
import type { SpaceSidebarActiveWakeSummary } from "./space-active-wake-presentation";

const STATUS_OPTIONS = [
	["unread", "Unread"],
	["needs_input", "Needs your input"],
	["working", "Working"],
] as const;
type Status = (typeof STATUS_OPTIONS)[number][0];

export function useSpaceDirectoryFilters(
	groups: readonly { id: string; label: string }[],
	onSearch: () => void
) {
	const groupFilter = useSidebarGroupFilter(groups);
	const [statuses, setStatuses] = useState<Status[]>([]);
	const toggle = (id: Status) =>
		setStatuses((current) =>
			current.includes(id)
				? current.filter((value) => value !== id)
				: [...current, id]
		);
	return {
		...groupFilter,
		statuses,
		active: groupFilter.selected.length > 0 || statuses.length > 0,
		matchesStatus: (unread: number, summary?: SpaceSidebarActiveWakeSummary) =>
			statuses.every((status) => {
				if (status === "unread") {
					return unread > 0;
				}
				if (status === "working") {
					return (summary?.activeWakeCount ?? 0) > 0;
				}
				return (
					summary?.statuses?.some(
						(entry) =>
							entry.kind === "needs_input" || entry.kind === "waiting_for_owner"
					) ?? false
				);
			}),
		menu: (
			<>
				<DropdownMenuItem onClick={() => requestAnimationFrame(onSearch)}>
					Search Spaces
				</DropdownMenuItem>
				{groupFilter.menu}
				{STATUS_OPTIONS.map(([id, label]) => (
					<DropdownMenuCheckboxItem
						checked={statuses.includes(id)}
						closeOnClick={false}
						key={id}
						onCheckedChange={() => toggle(id)}
					>
						{label}
					</DropdownMenuCheckboxItem>
				))}
			</>
		),
		badges: (
			<>
				{groupFilter.badges}
				{STATUS_OPTIONS.filter(([id]) => statuses.includes(id)).map(
					([id, label]) => (
						<SidebarFilterBadge
							key={id}
							label={label}
							onRemove={() => toggle(id)}
						/>
					)
				)}
			</>
		),
	};
}
