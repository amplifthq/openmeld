import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { FluidCardGroup } from "@openmeld/ui/fluid/card";
import { FluidNavMenu } from "@openmeld/ui/fluid/nav-menu";
import { SlidersHorizontalIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { SidebarFilterBadge } from "#/components/app/sidebar-filter-badge";
import {
	AGENT_LIST_FACETS,
	type AgentListFacet,
	type AgentListFilters,
	type AgentListGrouping,
	type AgentListItem,
	type AgentListSort,
	EMPTY_AGENT_LIST_FILTERS,
	groupAgentListItems,
	matchesAgentListItem,
	sortAgentListItems,
} from "./agent-list-model";

const SORTS = {
	recent: "Recent activity",
	created: "Newest created",
	name: "Name A–Z",
} as const;
const GROUPINGS = {
	none: "None",
	type: "Agent type",
	controller: "Controller",
	model: "Model",
} as const;
const FACETS = {
	availability: "Availability",
	type: "Agent type",
	controller: "Controller",
	model: "Model",
} as const;
const AVAILABILITY = {
	available: "Available",
	checking: "Checking",
	offline: "Offline",
	unavailable: "Unavailable",
};
export type AgentListView = {
	filters: AgentListFilters;
	sort: AgentListSort;
	grouping: AgentListGrouping;
};
export const DEFAULT_AGENT_LIST_VIEW: AgentListView = {
	filters: EMPTY_AGENT_LIST_FILTERS,
	sort: "recent",
	grouping: "none",
};

export function AgentListControls(input: {
	items: readonly AgentListItem[];
	value: AgentListView;
	onChange: (view: AgentListView) => void;
	hoverOnly?: boolean;
	label?: string;
}) {
	const changeFacet = (facet: AgentListFacet, value: string) => {
		const selected = input.value.filters[facet];
		input.onChange({
			...input.value,
			filters: {
				...input.value.filters,
				[facet]: selected.includes(value)
					? selected.filter((item) => item !== value)
					: [...selected, value],
			},
		});
	};
	return (
		<div
			className={
				input.hoverOnly
					? "opacity-0 group-focus-within/agent-section:opacity-100 group-hover/agent-section:opacity-100 has-[[data-popup-open]]:opacity-100 [@media(hover:none)]:opacity-100"
					: undefined
			}
		>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							aria-label={input.label ?? "Agent view settings"}
							size="icon-sm"
							variant="ghost"
						/>
					}
				>
					<SlidersHorizontalIcon />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-64">
					<DropdownMenuGroup>
						<DropdownMenuLabel>Sort by</DropdownMenuLabel>
						<DropdownMenuRadioGroup
							onValueChange={(value) =>
								input.onChange({ ...input.value, sort: value as AgentListSort })
							}
							value={input.value.sort}
						>
							{Object.entries(SORTS).map(([value, label]) => (
								<DropdownMenuRadioItem key={value} value={value}>
									{label}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuGroup>
					<DropdownMenuGroup>
						<DropdownMenuLabel>Group by</DropdownMenuLabel>
						<DropdownMenuRadioGroup
							onValueChange={(value) =>
								input.onChange({
									...input.value,
									grouping: value as AgentListGrouping,
								})
							}
							value={input.value.grouping}
						>
							{Object.entries(GROUPINGS).map(([value, label]) => (
								<DropdownMenuRadioItem key={value} value={value}>
									{label}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuGroup>
					{AGENT_LIST_FACETS.map((facet) => (
						<DropdownMenuGroup key={facet}>
							<DropdownMenuLabel>{FACETS[facet]}</DropdownMenuLabel>
							{[
								...new Set([
									...input.items.map((item) => item[facet]),
									...input.value.filters[facet],
								]),
							]
								.sort()
								.map((value) => (
									<DropdownMenuCheckboxItem
										checked={input.value.filters[facet].includes(value)}
										closeOnClick={false}
										key={value}
										onCheckedChange={() => changeFacet(facet, value)}
									>
										<span className="min-w-0 flex-1 truncate">
											{facet === "availability"
												? AVAILABILITY[value as keyof typeof AVAILABILITY]
												: value}
										</span>
										<span className="text-muted-foreground">
											{
												input.items.filter(
													(item) =>
														item[facet] === value &&
														matchesAgentListItem(item, {
															...input.value.filters,
															[facet]: [],
														})
												).length
											}
										</span>
									</DropdownMenuCheckboxItem>
								))}
						</DropdownMenuGroup>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

export function AgentListFilterChips(input: {
	value: AgentListView;
	onChange: (view: AgentListView) => void;
}) {
	const selected = AGENT_LIST_FACETS.flatMap((facet) =>
		input.value.filters[facet].map((value) => ({ facet, value }))
	);
	if (!selected.length) {
		return null;
	}
	return (
		<div className="flex flex-wrap items-center gap-2">
			{selected.map(({ facet, value }) => (
				<SidebarFilterBadge
					key={`${facet}:${value}`}
					label={
						facet === "availability"
							? AVAILABILITY[value as keyof typeof AVAILABILITY]
							: value
					}
					onRemove={() =>
						input.onChange({
							...input.value,
							filters: {
								...input.value.filters,
								[facet]: input.value.filters[facet].filter(
									(item) => item !== value
								),
							},
						})
					}
				/>
			))}
			<Button
				onClick={() =>
					input.onChange({ ...input.value, filters: EMPTY_AGENT_LIST_FILTERS })
				}
				size="sm"
				variant="ghost"
			>
				Clear filters
			</Button>
		</div>
	);
}

export function AgentList(input: {
	items: readonly AgentListItem[];
	search?: string;
	defaults?: AgentListView;
	heading?: ReactNode;
	hideControls?: boolean;
	label: string;
	renderCard: (item: AgentListItem, index: number) => ReactNode;
	emptyAction?: ReactNode;
}) {
	const [override, setOverride] = useState<AgentListView | null>(null);
	const defaults = input.defaults ?? DEFAULT_AGENT_LIST_VIEW;
	const view = override ?? defaults;
	const globallyFiltered = input.items.filter((item) =>
		matchesAgentListItem(item, defaults.filters, input.search)
	);
	const visible = sortAgentListItems(
		globallyFiltered.filter((item) => matchesAgentListItem(item, view.filters)),
		view.sort
	);
	return (
		<section aria-label={input.label} className="group/agent-section space-y-3">
			{!input.hideControls && (
				<div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-2">
					{input.heading}
					<AgentListControls
						hoverOnly={Boolean(input.heading)}
						items={globallyFiltered}
						label={`${input.label} settings`}
						onChange={setOverride}
						value={view}
					/>
				</div>
			)}
			{override && <AgentListFilterChips onChange={setOverride} value={view} />}
			{override && input.defaults && (
				<Button onClick={() => setOverride(null)} size="sm" variant="ghost">
					Use page settings
				</Button>
			)}
			{visible.length ? (
				groupAgentListItems(visible, view.grouping).map(([label, items]) => (
					<div className="space-y-2" key={label}>
						{label && (
							<h3 className="text-muted-foreground text-xs">
								{label} · {items.length}
							</h3>
						)}
						<FluidCardGroup>
							<FluidNavMenu
								activeValue={null}
								aria-label={label || input.label}
								className="[&_[data-sidebar=menu]]:grid [&_[data-sidebar=menu]]:gap-3 [&_[data-sidebar=menu]]:md:grid-cols-2 [&_[data-sidebar=menu]]:xl:grid-cols-3"
							>
								{items.map(input.renderCard)}
							</FluidNavMenu>
						</FluidCardGroup>
					</div>
				))
			) : (
				<div className="space-y-2 py-4 text-muted-foreground text-sm">
					<p>
						{input.items.length
							? "No Agents match. Try another search or clear filters."
							: "No Agents yet."}
					</p>
					{input.items.length === 0 && input.emptyAction}
				</div>
			)}
		</section>
	);
}
