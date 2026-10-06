import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuGroup,
	FluidDropdownMenuRadioItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import {
	CheckCircleIcon,
	ClockIcon,
	FunnelSimpleIcon,
	ListIcon,
	PauseCircleIcon,
	PlayCircleIcon,
	SortAscendingIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import type { RoutineFilter, RoutineSort } from "#/lib/routines/list-view";

const filters = [
	{ value: "all", label: "All routines", icon: ListIcon },
	{ value: "enabled", label: "Active", icon: PlayCircleIcon },
	{ value: "paused", label: "Paused", icon: PauseCircleIcon },
	{ value: "completed", label: "Finished", icon: CheckCircleIcon },
	{ value: "failed", label: "Last run failed", icon: WarningCircleIcon },
] as const;
const sorts = [
	{ value: "updated", label: "Recently updated", icon: ClockIcon },
	{ value: "next", label: "Next run", icon: PlayCircleIcon },
	{ value: "name", label: "Name A–Z", icon: SortAscendingIcon },
] as const;

export function RoutineListOptions(input: {
	filter: RoutineFilter;
	sort: RoutineSort;
	onFilter: (filter: RoutineFilter) => void;
	onSort: (sort: RoutineSort) => void;
}) {
	const active = input.filter !== "all" || input.sort !== "updated";
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label={
							active
								? "Filter and sort routines (active)"
								: "Filter and sort routines"
						}
						size="icon-sm"
						variant={active ? "secondary" : "ghost"}
					/>
				}
			>
				<FunnelSimpleIcon aria-hidden="true" />
			</DropdownMenuTrigger>
			<FluidDropdownMenuContent align="end" gapClick={false}>
				<DropdownMenuGroup>
					<DropdownMenuRadioGroup
						onValueChange={(value) => {
							const option = filters.find((item) => item.value === value);
							if (option) {
								input.onFilter(option.value);
							}
						}}
						value={input.filter}
					>
						<DropdownMenuLabel>Show</DropdownMenuLabel>
						{filters.map((option, index) => (
							<FluidDropdownMenuRadioItem
								closeOnClick
								index={index}
								key={option.value}
								value={option.value}
							>
								<option.icon aria-hidden="true" />
								{option.label}
							</FluidDropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<FluidDropdownMenuGroup>
					<DropdownMenuGroup>
						<DropdownMenuRadioGroup
							onValueChange={(value) => {
								const option = sorts.find((item) => item.value === value);
								if (option) {
									input.onSort(option.value);
								}
							}}
							value={input.sort}
						>
							<DropdownMenuLabel>Sort by</DropdownMenuLabel>
							{sorts.map((option, index) => (
								<FluidDropdownMenuRadioItem
									closeOnClick
									index={index}
									key={option.value}
									value={option.value}
								>
									<option.icon aria-hidden="true" />
									{option.label}
								</FluidDropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuGroup>
				</FluidDropdownMenuGroup>
			</FluidDropdownMenuContent>
		</DropdownMenu>
	);
}
