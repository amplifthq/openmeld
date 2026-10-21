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
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import {
	ArrowCounterClockwiseIcon,
	CalendarBlankIcon,
	CaretDownIcon,
	CaretRightIcon,
	CheckCircleIcon,
	CircleNotchIcon,
	ClockCounterClockwiseIcon,
	CloudIcon,
	CpuIcon,
	DesktopIcon,
	GearSixIcon,
	ListIcon,
	RobotIcon,
	SlidersHorizontalIcon,
	SortAscendingIcon,
	SquaresFourIcon,
	WarningCircleIcon,
	WifiSlashIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useId, useState } from "react";
import { AppEmptyState } from "#/components/app/app-empty-state";
import { SidebarFilterBadge } from "#/components/app/sidebar-filter-badge";
import { DirectorySearch } from "#/components/directory/directory-search";
import { ModelBrandIcon } from "#/components/models/model-brand-icon";
import { useBrowserPreference } from "#/lib/use-browser-preference";
import { AgentCardNavMenu } from "./agent-card-nav-menu";
import { AgentGroupCards } from "./agent-group-cards";
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
import { useAgentListState } from "./use-agent-list-state";

const SORTS = {
	recent: "Recent activity",
	created: "Newest created",
	name: "Name A–Z",
} as const;
const SORT_ICONS = {
	recent: ClockCounterClockwiseIcon,
	created: CalendarBlankIcon,
	name: SortAscendingIcon,
};
const GROUPINGS = {
	none: "None",
	"controller-provider": "Controller / provider",
	controller: "Controller",
	provider: "Provider",
	model: "Model",
} as const;
const GROUPING_ICONS = {
	none: ListIcon,
	"controller-provider": SquaresFourIcon,
	controller: SquaresFourIcon,
	provider: CloudIcon,
	model: CpuIcon,
};
const FACETS = {
	type: "Agent type",
	availability: "Availability",
	controller: "Controller",
	provider: "Provider",
	model: "Model",
} as const;
const AVAILABILITY = {
	available: "Available",
	checking: "Checking",
	offline: "Offline",
	unavailable: "Unavailable",
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
	if (facet === "availability") {
		const Icon =
			{
				available: CheckCircleIcon,
				checking: CircleNotchIcon,
				offline: WifiSlashIcon,
				unavailable: WarningCircleIcon,
			}[value as keyof typeof AVAILABILITY] ?? WarningCircleIcon;
		return <Icon className="size-4" />;
	}
	if (facet === "model" || facet === "provider") {
		return <ModelBrandIcon brand={item?.modelBrand ?? null} />;
	}
	return (
		<AgentProfileControllerAvatar
			agentControllerRef={item?.agentControllerRef ?? null}
			avatarStyle={item?.profile.avatarStyle}
			modelId={item?.modelId}
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
						variant="ghost"
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
									...(facet === "availability"
										? Object.keys(AVAILABILITY)
										: []),
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
												<span className="block truncate">
													{facet === "availability"
														? (AVAILABILITY[
																value as keyof typeof AVAILABILITY
															] ?? value)
														: value}
												</span>
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
					if (facet === "type" || facet === "availability") {
						return choices;
					}
					return (
						<DropdownMenuSub key={facet}>
							<DropdownMenuSubTrigger>
								{facet === "controller" ? <GearSixIcon /> : <CpuIcon />}
								{FACETS[facet]}
								{input.value.filters[facet].length > 0 && (
									<span className="mr-3 ml-auto text-muted-foreground">
										{input.value.filters[facet].length}
									</span>
								)}
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent className="max-h-[min(24rem,var(--available-height))] w-72">
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
						{Object.entries(SORTS).map(([value, label]) => {
							const Icon = SORT_ICONS[value as AgentListSort];
							return (
								<DropdownMenuRadioItem key={value} value={value}>
									<Icon />
									{label}
								</DropdownMenuRadioItem>
							);
						})}
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
						{Object.entries(GROUPINGS).map(([value, label]) => {
							const Icon = GROUPING_ICONS[value as AgentListGrouping];
							return (
								<DropdownMenuRadioItem key={value} value={value}>
									<Icon />
									{label}
								</DropdownMenuRadioItem>
							);
						})}
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
						label={
							facet === "availability"
								? (AVAILABILITY[value as keyof typeof AVAILABILITY] ?? value)
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

function ExpandAllControl({
	expanded,
	label,
	onClick,
	grouping,
}: {
	expanded: boolean;
	label: string;
	onClick: () => void;
	grouping: AgentListGrouping;
}) {
	if (grouping === "none") {
		return null;
	}
	return (
		<TooltipHint content={expanded ? "Show groups" : "Expand all"}>
			<Button
				aria-label={`${expanded ? "Show groups for" : "Expand all"} ${label}`}
				aria-pressed={expanded}
				onClick={onClick}
				size="icon-sm"
				variant="ghost"
			>
				{expanded ? <SquaresFourIcon /> : <ListIcon />}
			</Button>
		</TooltipHint>
	);
}

export function AgentList(input: {
	viewPreferenceKey: string;
	items: readonly AgentListItem[];
	search?: string;
	defaults?: AgentListView;
	heading?: ReactNode;
	collapsible?: boolean;
	hideControls?: boolean;
	label: string;
	renderCard: (
		item: AgentListItem,
		index: number,
		selection?: AgentCardSelection
	) => ReactNode;
	emptyAction?: ReactNode;
	onDelete?: DeleteAgents;
	/**
	 * Replaces the Profile cards outside multi-select, e.g. one card per
	 * MemberAgent. Gets the visible items in display order, and whether a
	 * search or filter hides any of them. Also renders an empty list, so it
	 * owns its own empty state.
	 */
	renderResults?: (
		items: readonly AgentListItem[],
		filtered: boolean
	) => ReactNode;
}) {
	const [collapsed, setCollapsed] = useState(false);
	const [presentation, setPresentation] = useBrowserPreference(
		input.viewPreferenceKey
	);
	// List is the default for every owner; "grouped" is an explicit choice.
	const expandAll = presentation !== "grouped";
	const contentId = useId();
	const {
		view: override,
		setView: setOverride,
		search,
		setSearch,
	} = useAgentListState(input.viewPreferenceKey);
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
	const displayed = visible.filter(
		(item) => !selection.pendingIds.has(item.profile.openMeldProfileId)
	);
	const changeView = (next: AgentListView) => {
		selection.reset();
		setOverride(next);
	};
	const results = selectAgentListBody({
		// The grouped view uses the same tiles for every owner.
		custom: selection.active || !expandAll ? undefined : input.renderResults,
		displayed,
		total: input.items.length,
		cards: () => (
			<AgentListResults
				flat={selection.active || expandAll}
				grouping={view.grouping}
				items={displayed}
				label={input.label}
				onToggle={selection.reset}
				renderCard={(item, index) =>
					input.renderCard(item, index, selection.card(item))
				}
			/>
		),
		empty: () => (
			<AgentListEmptyState
				action={input.emptyAction}
				canClear={Boolean(search || override)}
				hasAgents={input.items.length > 0}
				onClear={() => {
					setSearch("");
					setOverride(null);
					selection.reset();
				}}
			/>
		),
	});
	return (
		<section aria-label={input.label} className="group/agent-section space-y-3">
			<div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
				{input.heading}
				<div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
					{!(collapsed || input.hideControls) && (
						<AgentListFilterChips
							defaults={defaults}
							onChange={changeView}
							value={view}
						/>
					)}
					{!collapsed && selection.trigger && (
						<div className="opacity-0 group-focus-within/agent-section:opacity-100 group-hover/agent-section:opacity-100 [@media(hover:none)]:opacity-100">
							{selection.trigger}
						</div>
					)}
					{!collapsed && (
						<div
							className={`flex items-center gap-1 ${search || override ? "" : "opacity-0 group-focus-within/agent-section:opacity-100 group-hover/agent-section:opacity-100 has-[[data-popup-open]]:opacity-100 has-[input]:opacity-100 [@media(hover:none)]:opacity-100"}`}
							hidden={collapsed}
						>
							<ExpandAllControl
								expanded={expandAll}
								grouping={view.grouping}
								label={input.label}
								onClick={() => {
									selection.reset();
									setPresentation(expandAll ? "grouped" : "expanded");
								}}
							/>
							{!input.hideControls && (
								<>
									<DirectorySearch
										label={`Search ${input.label}`}
										onChange={(value) => {
											selection.reset();
											setSearch(value);
										}}
										value={search}
									/>
									<AgentListControls
										items={globallyFiltered}
										label={`${input.label} settings`}
										onChange={changeView}
										onReset={() => {
											selection.reset();
											setOverride(null);
										}}
										resetValue={{
											...defaults,
											filters: EMPTY_AGENT_LIST_FILTERS,
										}}
										value={view}
									/>
								</>
							)}
						</div>
					)}
					{input.collapsible && (
						<Button
							aria-controls={contentId}
							aria-expanded={!collapsed}
							aria-label={`${collapsed ? "Expand" : "Collapse"} ${input.label}`}
							className={
								collapsed
									? "aria-expanded:bg-transparent"
									: "opacity-0 group-focus-within/agent-section:opacity-100 group-hover/agent-section:opacity-100 aria-expanded:bg-transparent aria-expanded:hover:bg-muted [@media(hover:none)]:opacity-100"
							}
							onClick={() => {
								selection.cancel();
								setCollapsed(!collapsed);
							}}
							size="icon-sm"
							variant="ghost"
						>
							{collapsed ? <CaretRightIcon /> : <CaretDownIcon />}
						</Button>
					)}
				</div>
			</div>
			{selection.dialog}
			<div className="space-y-3" hidden={collapsed} id={contentId}>
				{selection.toolbar}
				{results}
			</div>
		</section>
	);
}

function selectAgentListBody(input: {
	custom?: (items: readonly AgentListItem[], filtered: boolean) => ReactNode;
	displayed: readonly AgentListItem[];
	total: number;
	cards: () => ReactNode;
	empty: () => ReactNode;
}): ReactNode {
	if (input.custom && (input.displayed.length > 0 || input.total === 0)) {
		return input.custom(input.displayed, input.displayed.length < input.total);
	}
	return input.displayed.length > 0 ? input.cards() : input.empty();
}

function AgentListEmptyState(input: {
	action?: ReactNode;
	canClear: boolean;
	hasAgents: boolean;
	onClear: () => void;
}) {
	if (!input.hasAgents && input.action) {
		return (
			<AppEmptyState
				actions={input.action}
				className="min-h-56 w-full"
				description="Create your first Agent to start working together."
				icon={<RobotIcon aria-hidden="true" className="size-5" />}
				title="No Agents yet."
			/>
		);
	}
	return (
		<div className="space-y-2 py-4 text-muted-foreground text-sm">
			<p>
				{input.hasAgents
					? "No Agents match. Try another search or clear filters."
					: "No Agents yet."}
			</p>
			{input.hasAgents && input.canClear && (
				<Button onClick={input.onClear} size="sm" variant="secondary">
					Clear search and filters
				</Button>
			)}
		</div>
	);
}

function AgentListResults({
	flat,
	items,
	grouping,
	label,
	renderCard,
	onToggle,
}: {
	flat: boolean;
	items: AgentListItem[];
	grouping: AgentListGrouping;
	label: string;
	renderCard: (item: AgentListItem, index: number) => ReactNode;
	onToggle: () => void;
}) {
	if (!flat && grouping !== "none") {
		return (
			<AgentGroupCards
				groups={groupAgentListItems(items, grouping)}
				key={grouping}
				onToggle={onToggle}
				renderCard={renderCard}
			/>
		);
	}
	return (
		<AgentCardNavMenu activeValue={null} aria-label={label}>
			{items.map(renderCard)}
		</AgentCardNavMenu>
	);
}
