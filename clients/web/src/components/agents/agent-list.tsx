import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { FluidCardGroup } from "@openmeld/ui/fluid/card";
import { FluidNavMenu } from "@openmeld/ui/fluid/nav-menu";
import {
	ArrowCounterClockwiseIcon,
	CloudIcon,
	DesktopIcon,
	SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { SidebarFilterBadge } from "#/components/app/sidebar-filter-badge";
import { DirectorySearch } from "#/components/directory/directory-search";
import { ModelBrandIcon } from "#/components/models/model-brand-icon";
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
import {
	type AgentCardSelection,
	type DeleteAgents,
	useAgentListSelection,
} from "./agent-list-selection";
import { AgentProfileControllerAvatar } from "./agent-profile-controller-avatar";

const SORTS = {
	recent: "Recent activity",
	created: "Newest created",
	name: "Name A–Z",
} as const;
const GROUPINGS = {
	none: "None",
	controller: "Controller",
	model: "Model",
} as const;
const FACETS = {
	type: "Agent type",
	controller: "Controller",
	model: "Model",
} as const;
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

function FacetIcon({
	facet,
	item,
	value,
}: {
	facet: AgentListFacet;
	item?: AgentListItem;
	value: string;
}) {
	if (facet === "type") {
		return value === "Remote Agent" ? (
			<CloudIcon className="size-4" />
		) : (
			<DesktopIcon className="size-4" />
		);
	}
	if (facet === "model") {
		return <ModelBrandIcon brand={item?.modelBrand ?? null} />;
	}
	return (
		<AgentProfileControllerAvatar
			agentControllerRef={item?.agentControllerRef ?? null}
			profileId={value}
			profileName={value}
			size={18}
		/>
	);
}

export function AgentListControls(input: {
	items: readonly AgentListItem[];
	value: AgentListView;
	onChange: (view: AgentListView) => void;
	onReset?: () => void;
	resetValue?: AgentListView;
	label?: string;
}) {
	const resetValue = input.resetValue ?? DEFAULT_AGENT_LIST_VIEW;
	const changed = JSON.stringify(input.value) !== JSON.stringify(resetValue);
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
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label={input.label ?? "Agent view settings"}
						size="icon-sm"
						variant="secondary"
					/>
				}
			>
				<SlidersHorizontalIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="max-h-[min(30rem,var(--available-height))] w-72"
			>
				<div className="flex items-center justify-between gap-2 px-2 py-1.5">
					<span className="font-medium text-sm">Filters and sorting</span>
					<DropdownMenuItem
						className="py-1"
						disabled={!changed}
						onClick={() =>
							input.onReset ? input.onReset() : input.onChange(resetValue)
						}
						render={<Button size="sm" variant="secondary" />}
					>
						<ArrowCounterClockwiseIcon />
						Reset
					</DropdownMenuItem>
				</div>
				<DropdownMenuSeparator />
				{AGENT_LIST_FACETS.map((facet) => {
					const choices = (
						<DropdownMenuGroup key={facet}>
							<DropdownMenuLabel>{FACETS[facet]}</DropdownMenuLabel>
							{[
								...new Set([
									...(facet === "type" ? ["Local Agent", "Remote Agent"] : []),
									...input.items.map((item) => item[facet]),
									...input.value.filters[facet],
								]),
							]
								.sort()
								.map((value) => {
									const item = input.items.find(
										(candidate) => candidate[facet] === value
									);
									const count = input.items.filter(
										(candidate) =>
											candidate[facet] === value &&
											matchesAgentListItem(candidate, {
												...input.value.filters,
												[facet]: [],
											})
									).length;
									return (
										<DropdownMenuCheckboxItem
											checked={input.value.filters[facet].includes(value)}
											closeOnClick={false}
											key={value}
											onCheckedChange={() => changeFacet(facet, value)}
										>
											<FacetIcon facet={facet} item={item} value={value} />
											<span className="min-w-0 flex-1">
												<span className="block truncate">{value}</span>
												{facet === "model" && item?.modelBrand && (
													<span className="block text-muted-foreground text-xs">
														{item.modelBrand}
													</span>
												)}
											</span>
											<span className="text-muted-foreground text-xs tabular-nums">
												{count}
											</span>
										</DropdownMenuCheckboxItem>
									);
								})}
						</DropdownMenuGroup>
					);
					if (facet === "type") {
						return choices;
					}
					return (
						<DropdownMenuSub key={facet}>
							<DropdownMenuSubTrigger>
								{FACETS[facet]}
								{input.value.filters[facet].length > 0 && (
									<span className="mr-3 ml-auto text-muted-foreground">
										{input.value.filters[facet].length}
									</span>
								)}
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent className="max-h-[min(24rem,var(--available-height))] w-72 overflow-y-auto">
								{choices}
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					);
				})}
				<DropdownMenuSeparator />
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
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function AgentListFilterChips(input: {
	value: AgentListView;
	defaults?: AgentListView;
	onChange: (view: AgentListView) => void;
}) {
	const defaults = input.defaults ?? DEFAULT_AGENT_LIST_VIEW;
	return (
		<>
			{AGENT_LIST_FACETS.flatMap((facet) =>
				input.value.filters[facet].map((value) => (
					<SidebarFilterBadge
						key={`${facet}:${value}`}
						label={value}
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
				))
			)}
			{input.value.sort !== defaults.sort && (
				<SidebarFilterBadge
					label={SORTS[input.value.sort]}
					onRemove={() =>
						input.onChange({ ...input.value, sort: defaults.sort })
					}
				/>
			)}
			{input.value.grouping !== defaults.grouping && (
				<SidebarFilterBadge
					label={`Group: ${GROUPINGS[input.value.grouping]}`}
					onRemove={() =>
						input.onChange({ ...input.value, grouping: defaults.grouping })
					}
				/>
			)}
		</>
	);
}

export function AgentList(input: {
	items: readonly AgentListItem[];
	search?: string;
	defaults?: AgentListView;
	heading?: ReactNode;
	hideControls?: boolean;
	label: string;
	renderCard: (
		item: AgentListItem,
		index: number,
		selection?: AgentCardSelection
	) => ReactNode;
	emptyAction?: ReactNode;
	onDelete?: DeleteAgents;
}) {
	const [override, setOverride] = useState<AgentListView | null>(null);
	const [search, setSearch] = useState("");
	const defaults = input.defaults ?? DEFAULT_AGENT_LIST_VIEW;
	// Section filters only own their additions; page filters stay authoritative.
	const view = override ?? { ...defaults, filters: EMPTY_AGENT_LIST_FILTERS };
	const globallyFiltered = input.items.filter((item) =>
		matchesAgentListItem(item, defaults.filters, input.search)
	);
	const visible = sortAgentListItems(
		globallyFiltered.filter((item) =>
			matchesAgentListItem(item, view.filters, search)
		),
		view.sort
	);
	const selection = useAgentListSelection(
		visible,
		input.onDelete,
		JSON.stringify([input.search, defaults.filters, view.filters, search])
	);
	const changeView = (next: AgentListView) => {
		selection.reset();
		setOverride(next);
	};
	return (
		<section aria-label={input.label} className="group/agent-section space-y-3">
			<div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
				{input.heading}
				<div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
					{!input.hideControls && (
						<AgentListFilterChips
							defaults={defaults}
							onChange={changeView}
							value={view}
						/>
					)}
					{selection.trigger}
					{!input.hideControls && (
						<div
							className={`flex items-center gap-1 ${search || override ? "" : "opacity-0 group-focus-within/agent-section:opacity-100 group-hover/agent-section:opacity-100 has-[[data-popup-open]]:opacity-100 has-[input]:opacity-100 [@media(hover:none)]:opacity-100"}`}
						>
							<DirectorySearch
								label={`Search ${input.label}`}
								onChange={(value) => {
									selection.reset();
									setSearch(value);
								}}
								value={search}
								variant="secondary"
							/>
							<AgentListControls
								items={globallyFiltered}
								label={`${input.label} settings`}
								onChange={changeView}
								onReset={() => {
									selection.reset();
									setOverride(null);
								}}
								resetValue={{ ...defaults, filters: EMPTY_AGENT_LIST_FILTERS }}
								value={view}
							/>
						</div>
					)}
				</div>
			</div>
			{selection.toolbar}
			{selection.dialog}
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
								{items.map((item, index) =>
									input.renderCard(item, index, selection.card(item))
								)}
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
					{input.items.length > 0 && (search || override) && (
						<Button
							onClick={() => {
								setSearch("");
								setOverride(null);
								selection.reset();
							}}
							size="sm"
							variant="secondary"
						>
							Clear search and filters
						</Button>
					)}
					{input.items.length === 0 && input.emptyAction}
				</div>
			)}
		</section>
	);
}
