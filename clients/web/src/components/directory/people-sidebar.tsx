import type { PeopleSidebarPreferences } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
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
import {
	SidebarDrag,
	SidebarDropSection,
	useSortableSidebarItem,
} from "../app/sidebar-drag";
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
	["offline", "Computer offline"],
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
	const [search, setSearch] = useState("");
	const [filter, setFilter] = useState<PeopleFilter>("all");
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
				(filter === "all" || peopleConnectionFilter(member) === filter)
		);
	}, [input.members, search, filter]);
	const assigned = new Set([
		...preferences.starred.itemIds,
		...preferences.groups.flatMap((g) => g.itemIds),
	]);
	const starred = new Set(preferences.starred.itemIds);
	const remaining = filtered.filter((m) => !assigned.has(m.id));
	const sections = [
		...(preferences.starred.itemIds.length
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
			.filter((s) => s.id !== "unknown" || s.members.length > 0)
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
	const groups = sections.map((section) => {
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
			labelTooltip: new Map([
				["connected", "Computer connected"],
				["not-connected", "Computer not connected"],
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
						section.id === "connected"
							? (name) =>
									save({
										...preferences,
										groups: [
											...preferences.groups,
											{
												id: crypto.randomUUID(),
												name,
												sort: "manual",
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
				<SidebarDropSection ids={members.map((m) => m.id)} section={section.id}>
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
		>
			<AppContextualSidebarNav
				activeItemId={input.selectedProfileId}
				ariaLabel="People"
				groups={input.loading || input.error ? [] : groups}
				leadingContent={
					<>
						<div className="flex items-center gap-1 px-1">
							<SidebarSearchInput
								label="Search people"
								onValueChange={setSearch}
								value={search}
							/>
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button
											aria-label="Filter people"
											className={
												filter !== "all"
													? "text-primary"
													: "text-muted-foreground"
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
								</FluidDropdownMenuContent>
							</DropdownMenu>
						</div>
						{filter !== "all" && (
							<Button
								onClick={() => setFilter("all")}
								size="sm"
								variant="ghost"
							>
								Clear filter
							</Button>
						)}
						{sidebar.isError && (
							<Button onClick={() => sidebar.retry()} size="sm" variant="ghost">
								Retry sidebar settings
							</Button>
						)}
						{input.loading && (
							<p className="px-2 py-3 text-muted-foreground text-xs">
								Loading people…
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
