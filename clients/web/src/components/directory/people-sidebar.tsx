import type { PeopleSidebarPreferences } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { FluidNavMenu } from "@openmeld/ui/fluid/nav-menu";
import { CheckIcon, FunnelSimpleIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { AppContextualSidebarNav } from "../app/app-contextual-layout";
import { useAppNavigationPresentation } from "../app/app-navigation-presentation";
import { SidebarDestinationAction } from "../app/sidebar-destination-actions";
import {
	SidebarDrag,
	SidebarDropSection,
	useSortableSidebarItem,
} from "../app/sidebar-drag";
import { moveSidebarGroup } from "../app/sidebar-drop-target";
import { SidebarFilterBadge } from "../app/sidebar-filter-badge";
import { useSidebarGroupFilter } from "../app/sidebar-group-filter";
import { SidebarListSkeleton } from "../app/sidebar-list-skeleton";
import { SidebarSearchInput } from "../app/sidebar-search-input";
import { SidebarSectionActions } from "../app/sidebar-section-actions";
import { useSidebarPreferences } from "../app/use-sidebar-preferences";
import type { OrganizationComputerGroup } from "../computers/organization-computers";
import type { DirectoryHumanProfileRow } from "./directory-human-profile-model";
import { HumanProfileSidebarItem } from "./human-profile-sidebar-item";
import {
	EMPTY_PEOPLE_SIDEBAR,
	moveSidebarPerson,
	type PeopleFilter,
	peopleConnectionFilter,
	sortSidebarPeople,
} from "./people-sidebar-order";

const FILTERS = [
	["all", "All people"],
	["connected", "Computer connected"],
	["offline", "Computer disconnected"],
	["unconnected", "No computer connected"],
	["unknown", "Status needs checking"],
] as const;
const SORTS = [
	["priority", "Recently active"],
	["name", "Name"],
	["manual", "Manual order"],
] as const;

export function PeopleSidebar(input: {
	members: readonly DirectoryHumanProfileRow[];
	computerGroups: readonly OrganizationComputerGroup[];
	selectedProfileId: string | null;
	activityNowMs: number;
	loading: boolean;
	error: string | null;
	onSelect: (id: string) => void;
	onChat: (id: string) => Promise<void>;
	chatPending: boolean;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const viewerId =
		input.members.find((m) => m.isCurrentUser)?.id ?? currentUserId;
	const sidebar = useSidebarPreferences(viewerId, currentOrganization.id);
	const preferences = sidebar.preferences?.people ?? EMPTY_PEOPLE_SIDEBAR;
	const loading =
		input.loading ||
		sidebar.isPending ||
		input.members.some((member) => member.computer.state === "checking");
	const [search, setSearch] = useState("");
	const [filter, setFilter] = useState<PeopleFilter>("all");
	const [recentlyActive, setRecentlyActive] = useState(false);
	const groupFilter = useSidebarGroupFilter([
		{ id: "starred", label: "Starred" },
		...preferences.groups.map((g) => ({ id: g.id, label: g.name })),
		{ id: "connected", label: "Connected" },
		{ id: "not-connected", label: "Not connected" },
		{ id: "unknown", label: "Status needs checking" },
	]);
	const { presentation } = useAppNavigationPresentation();
	const computers = useMemo(
		() => new Map(input.computerGroups.map((g) => [g.ownerUserId, g])),
		[input.computerGroups]
	);
	const save = (people: PeopleSidebarPreferences) => {
		if (sidebar.preferences) {
			sidebar.save({ ...sidebar.preferences, people });
		}
	};
	const filtered = useMemo(() => {
		const query = search.trim().toLocaleLowerCase();
		return input.members.filter(
			(member) =>
				(!query ||
					`${member.name} ${member.email ?? ""}`
						.toLocaleLowerCase()
						.includes(query)) &&
				(filter === "all" || peopleConnectionFilter(member) === filter) &&
				(!recentlyActive ||
					(member.profileStatus === "active" &&
						member.lastActiveAt !== null &&
						Date.parse(member.lastActiveAt) <= input.activityNowMs &&
						input.activityNowMs - Date.parse(member.lastActiveAt) < 300_000))
		);
	}, [input.members, input.activityNowMs, search, filter, recentlyActive]);
	const assigned = new Set([
		...preferences.starred.itemIds,
		...preferences.groups.flatMap((g) => g.itemIds),
	]);
	const starred = new Set(preferences.starred.itemIds);
	const remaining = filtered.filter((m) => !assigned.has(m.id));
	const sections = [
		...(filtered.some((member) => starred.has(member.id))
			? [
					{
						id: "starred",
						label: "Starred",
						members: filtered.filter((m) => starred.has(m.id)),
						settings: preferences.starred,
					},
				]
			: []),
		...preferences.groups.map((g) => ({
			id: g.id,
			label: g.name,
			members: filtered.filter((m) => g.itemIds.includes(m.id)),
			settings: g,
		})),
		...[
			{
				id: "connected",
				label: "Connected",
				members: remaining.filter(
					(m) => peopleConnectionFilter(m) === "connected"
				),
			},
			{
				id: "not-connected",
				label: "Not connected",
				members: remaining.filter((m) =>
					["offline", "unconnected"].includes(peopleConnectionFilter(m))
				),
			},
			{
				id: "unknown",
				label: "Status needs checking",
				members: remaining.filter(
					(m) => peopleConnectionFilter(m) === "unknown"
				),
			},
		]
			.filter((s) => s.members.length > 0)
			.map((s) => ({ ...s, settings: preferences.people })),
	];
	const visible = new Map<string, readonly string[]>();
	const toggleStar = (id: string) => {
		if (starred.has(id)) {
			save({
				...preferences,
				starred: {
					...preferences.starred,
					itemIds: preferences.starred.itemIds.filter((i) => i !== id),
				},
			});
		} else {
			save(
				moveSidebarPerson(
					preferences,
					"starred",
					id,
					preferences.starred.itemIds
				)
			);
		}
	};
	const groups = sections
		.filter(
			(section) =>
				groupFilter.includes(section.id) &&
				(!(
					search.trim() ||
					filter !== "all" ||
					recentlyActive ||
					groupFilter.selected.length > 0
				) ||
					section.members.length > 0)
		)
		.map((section, sectionIndex) => {
			const members = sortSidebarPeople(section.members, section.settings);
			visible.set(
				section.id,
				members.map((m) => m.id)
			);
			const defaultSection = ["connected", "not-connected", "unknown"].includes(
				section.id
			);
			const setSort = (sort: PeopleSidebarPreferences["people"]["sort"]) => {
				if (section.id === "starred" || defaultSection) {
					save({
						...preferences,
						[defaultSection ? "people" : section.id]: {
							...section.settings,
							sort,
						},
					});
				} else {
					save({
						...preferences,
						groups: preferences.groups.map((g) =>
							g.id === section.id ? { ...g, sort } : g
						),
					});
				}
			};
			return {
				id: section.id,
				label: section.label,
				onRename: preferences.groups.some((group) => group.id === section.id)
					? (name: string) =>
							save({
								...preferences,
								groups: preferences.groups.map((group) =>
									group.id === section.id ? { ...group, name } : group
								),
							})
					: undefined,
				labelTooltip: new Map([
					["connected", "Computer connected"],
					["not-connected", "No computer connected"],
				]).get(section.id),
				ariaLabel: section.label,
				labelAccessory: (
					<SidebarSectionActions
						disabled={sidebar.disabled}
						label={section.label}
						onDelete={
							!defaultSection && section.id !== "starred"
								? () =>
										save({
											...preferences,
											groups: preferences.groups.filter(
												(g) => g.id !== section.id
											),
										})
								: undefined
						}
						onNewGroup={
							sectionIndex === 0
								? (name) =>
										save({
											...preferences,
											groups: [
												...preferences.groups,
												{
													id: crypto.randomUUID(),
													name,
													sort: "priority",
													itemIds: [],
												},
											],
										})
								: undefined
						}
						onSort={setSort}
						sort={section.settings.sort}
						sortOptions={SORTS}
					/>
				),
				content: (
					<SidebarDropSection
						ids={members.map((m) => m.id)}
						section={section.id}
					>
						<FluidNavMenu
							activeLayoutId={`secondary-sidebar-selection-${presentation}`}
							activeValue={input.selectedProfileId}
							aria-label={section.label}
							className="[&_[data-sidebar=menu]]:gap-0.5"
						>
							{members.map((member, index) => (
								<SortablePerson
									actionsDisabled={sidebar.disabled || input.chatPending}
									activityNowMs={input.activityNowMs}
									computerGroup={computers.get(member.userId) ?? null}
									disabled={sidebar.disabled}
									index={index}
									isActive={input.selectedProfileId === member.id}
									key={member.id}
									member={member}
									onChat={
										member.profileStatus === "active" && !member.isCurrentUser
											? () => {
													input
														.onChat(member.id)
														.catch((error) =>
															toast.error(
																error instanceof Error
																	? error.message
																	: "Unable to open this conversation. Try again."
															)
														);
												}
											: undefined
									}
									onSelect={input.onSelect}
									onToggleStar={() => toggleStar(member.id)}
									section={section.id}
									starred={starred.has(member.id)}
								/>
							))}
						</FluidNavMenu>
						{members.length === 0 && (
							<p className="px-2 py-2 text-muted-foreground text-xs">
								{defaultSection ? "No people match." : "Drag people here."}
							</p>
						)}
					</SidebarDropSection>
				),
			};
		});
	return (
		<SidebarDrag
			canDrop={(itemId, section) => {
				if (!["connected", "not-connected", "unknown"].includes(section)) {
					return true;
				}
				const member = input.members.find((m) => m.id === itemId);
				if (!member) {
					return false;
				}
				const connection = peopleConnectionFilter(member);
				return (
					section === connection ||
					(section === "not-connected" &&
						["offline", "unconnected"].includes(connection))
				);
			}}
			groupIds={
				sidebar.disabled ? [] : preferences.groups.map((group) => group.id)
			}
			onMove={(section, id, before) => {
				if (!sidebar.disabled) {
					save(
						moveSidebarPerson(
							preferences,
							["connected", "not-connected", "unknown"].includes(section)
								? "people"
								: section,
							id,
							visible.get(section) ?? [],
							before
						)
					);
				}
			}}
			onMoveGroup={(id, before) =>
				save({
					...preferences,
					groups: moveSidebarGroup(preferences.groups, id, before),
				})
			}
		>
			<AppContextualSidebarNav
				activeItemId={input.selectedProfileId}
				ariaLabel="People"
				groups={loading || input.error ? [] : groups}
				leadingContent={
					<>
						<div className="flex items-center gap-1 px-1">
							<SidebarSearchInput
								destination="people"
								label="Search people"
								onValueChange={setSearch}
								value={search}
							/>
							<SidebarDestinationAction destination="people">
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<Button
												aria-label="Filter people"
												className={
													filter !== "all" ||
													recentlyActive ||
													groupFilter.selected.length > 0
														? "size-6 text-primary [&_svg]:size-3.5"
														: "size-6 text-muted-foreground [&_svg]:size-3.5"
												}
												size="icon-sm"
												variant="ghost"
											/>
										}
									>
										<FunnelSimpleIcon />
									</DropdownMenuTrigger>
									<FluidDropdownMenuContent
										align="end"
										aria-label="Filter people"
										className="w-60 max-w-[calc(100vw-2rem)]"
									>
										{FILTERS.map(([value, label], index) => (
											<FluidDropdownMenuItem
												index={index}
												key={value}
												onClick={() => setFilter(value)}
											>
												<CheckIcon
													className={filter === value ? "" : "invisible"}
												/>
												{label}
												{filter === value && (
													<span className="sr-only">, selected</span>
												)}
											</FluidDropdownMenuItem>
										))}
										<DropdownMenuCheckboxItem
											checked={recentlyActive}
											onCheckedChange={setRecentlyActive}
										>
											Active in last 5 minutes
										</DropdownMenuCheckboxItem>
										{groupFilter.menu}
									</FluidDropdownMenuContent>
								</DropdownMenu>
							</SidebarDestinationAction>
						</div>
						{filter !== "all" && (
							<div className="flex flex-wrap gap-1 px-1 pt-1">
								<SidebarFilterBadge
									label={
										FILTERS.find(([value]) => value === filter)?.[1] ?? filter
									}
									onRemove={() => setFilter("all")}
								/>
							</div>
						)}
						{groupFilter.badges}
						{recentlyActive && (
							<div className="px-1 pt-1">
								<SidebarFilterBadge
									label="Active in last 5 minutes"
									onRemove={() => setRecentlyActive(false)}
								/>
							</div>
						)}
						{sidebar.isError && (
							<Button onClick={() => sidebar.retry()} size="sm" variant="ghost">
								Retry sidebar settings
							</Button>
						)}
						{loading && (
							<SidebarListSkeleton label="Loading people" showPreview />
						)}
						{!(
							loading ||
							input.error ||
							sections.some(
								(section) =>
									groupFilter.includes(section.id) && section.members.length > 0
							)
						) && (
							<p className="px-2 py-2 text-muted-foreground text-xs">
								{search.trim() ||
								filter !== "all" ||
								recentlyActive ||
								groupFilter.selected.length > 0
									? "No people match your search or filters."
									: "No people yet."}
							</p>
						)}
						{input.error && (
							<p className="px-2 py-3 text-destructive text-xs" role="alert">
								{input.error}
							</p>
						)}
					</>
				}
				onActivate={input.onSelect}
				placement="main"
				title="People"
			/>
		</SidebarDrag>
	);
}

function SortablePerson(
	input: React.ComponentProps<typeof HumanProfileSidebarItem> & {
		section: string;
		disabled: boolean;
	}
) {
	const { section, disabled, ...item } = input;
	const drag = useSortableSidebarItem({
		section,
		disabled,
		itemId: item.member.id,
		name: item.member.name,
	});
	return <HumanProfileSidebarItem {...item} drag={drag} />;
}
