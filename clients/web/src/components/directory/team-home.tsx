import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { FluidCardGroup } from "@openmeld/ui/fluid/card";
import { FluidDropdownMenuContent } from "@openmeld/ui/fluid/dropdown-menu";
import {
	DesktopTowerIcon,
	DevicesIcon,
	FolderIcon,
	MinusCircleIcon,
	QuestionIcon,
	SlidersHorizontalIcon,
	StarIcon,
	UserIcon,
	WifiSlashIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { SidebarFilterBadge } from "../app/sidebar-filter-badge";
import { useSidebarPreferences } from "../app/use-sidebar-preferences";
import type { OrganizationComputerGroup } from "../computers/organization-computers";
import type { DirectoryHumanProfileRow } from "./directory-human-profile-model";
import { DirectorySearch } from "./directory-search";
import { HumanProfileItem } from "./human-profile-item";
import {
	EMPTY_PEOPLE_SIDEBAR,
	PEOPLE_COMPUTER_FILTER_LABELS,
	peopleConnectionFilter,
	resolvePeopleSections,
	toggleSidebarPersonStar,
} from "./people-sidebar-order";

export function TeamHome(input: {
	members: readonly DirectoryHumanProfileRow[];
	computerGroups: readonly OrganizationComputerGroup[];
	activityNowMs: number;
	onSelect: (id: string) => void;
	onChat?: (id: string) => Promise<void>;
	chatPending?: boolean;
}) {
	const { currentOrganization } = useAppOrganization();
	const sidebar = useSidebarPreferences(currentOrganization.id);
	const [search, setSearch] = useState("");
	const [groupIds, setGroupIds] = useState<string[]>([]);
	const [computerFilters, setComputerFilters] = useState<string[]>([]);
	const [sectionFilters, setSectionFilters] = useState<
		Record<string, string[]>
	>({});
	const allSections = resolvePeopleSections(
		input.members,
		sidebar.preferences?.people ?? EMPTY_PEOPLE_SIDEBAR,
		{ includeCenterAgent: false }
	);
	const query = search.trim().toLocaleLowerCase();
	const filtering =
		Boolean(query) ||
		groupIds.length > 0 ||
		computerFilters.length > 0 ||
		Object.values(sectionFilters).some((values) => values.length > 0);
	const sections = allSections
		.filter((section) => groupIds.length === 0 || groupIds.includes(section.id))
		.map((section) => ({
			...section,
			members: section.members.filter(
				(member) =>
					member.name.toLocaleLowerCase().includes(query) &&
					(!computerFilters.length ||
						computerFilters.includes(peopleConnectionFilter(member))) &&
					(!sectionFilters[section.id]?.length ||
						sectionFilters[section.id].includes(peopleConnectionFilter(member)))
			),
		}))
		.filter(
			(section) =>
				!filtering ||
				section.members.length > 0 ||
				Boolean(sectionFilters[section.id]?.length)
		);
	const visibleCount = sections.reduce(
		(total, section) => total + section.members.length,
		0
	);
	const computers = new Map(
		input.computerGroups.map((group) => [group.ownerUserId, group])
	);
	return (
		<div
			aria-labelledby="team-directory-tab-1"
			className="w-full"
			id="team-directory-panel-1"
			role="tabpanel"
		>
			<div className="flex h-16 items-center justify-between gap-3 px-[var(--app-page-inline-padding)]">
				<p className="text-muted-foreground text-xs">
					{filtering
						? `${visibleCount} of ${input.members.length}`
						: input.members.length}{" "}
					{input.members.length === 1 ? "member" : "members"}
				</p>
				<div className="flex items-center gap-1">
					<DirectorySearch
						label="Search members"
						onChange={setSearch}
						value={search}
					/>
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									aria-label="Filter team"
									size="icon-sm"
									variant="ghost"
								/>
							}
						>
							<SlidersHorizontalIcon />
						</DropdownMenuTrigger>
						<FluidDropdownMenuContent
							align="end"
							className="w-max min-w-64 max-w-[calc(100vw-2rem)]"
						>
							{allSections.map((section) => (
								<DropdownMenuCheckboxItem
									checked={groupIds.includes(section.id)}
									className="whitespace-nowrap"
									closeOnClick={false}
									key={section.id}
									onCheckedChange={(checked) =>
										setGroupIds((current) =>
											checked
												? [...current, section.id]
												: current.filter((id) => id !== section.id)
										)
									}
								>
									<TeamGroupIcon id={section.id} />
									<span className="truncate">{section.label}</span>
								</DropdownMenuCheckboxItem>
							))}
							<DropdownMenuSeparator />
							<TeamComputerFilterItems
								onChange={setComputerFilters}
								values={computerFilters}
							/>
						</FluidDropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			{groupIds.length > 0 || computerFilters.length > 0 ? (
				<div className="flex flex-wrap items-center gap-2 px-[var(--app-page-inline-padding)] pb-3">
					{computerFilters.map((value) => (
						<SidebarFilterBadge
							key={value}
							label={
								PEOPLE_COMPUTER_FILTER_LABELS[
									value as keyof typeof PEOPLE_COMPUTER_FILTER_LABELS
								]
							}
							onRemove={() =>
								setComputerFilters((current) =>
									current.filter((item) => item !== value)
								)
							}
						/>
					))}
					<Button
						onClick={() => {
							setGroupIds([]);
							setComputerFilters([]);
						}}
						size="sm"
						variant="ghost"
					>
						Clear filters
						<XIcon />
					</Button>
				</div>
			) : null}
			<div className="space-y-7 px-[var(--app-page-inline-padding)] pb-8">
				{filtering && visibleCount === 0 ? (
					<p className="text-muted-foreground text-sm">
						No members match your search or filters.
					</p>
				) : null}
				{sections.map((section) => (
					<section
						aria-label={section.label}
						className="group/people-section space-y-2"
						key={section.id}
					>
						<div className="flex min-h-7 items-center justify-between gap-2">
							<h2 className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
								<TeamGroupIcon id={section.id} />
								{section.id === "online" || section.id === "offline" ? (
									<Tooltip>
										<TooltipTrigger
											render={
												<button
													aria-label={section.label}
													className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
													type="button"
												/>
											}
										>
											{section.label}
										</TooltipTrigger>
										<TooltipContent>
											{section.id === "online"
												? "People using OpenMeld"
												: "People not currently active in OpenMeld"}
										</TooltipContent>
									</Tooltip>
								) : (
									section.label
								)}
								<span className="font-normal text-xs">
									{section.members.length}
								</span>
							</h2>
							<TeamSectionFilter
								label={section.label}
								onChange={(values) =>
									setSectionFilters((current) => ({
										...current,
										[section.id]: values,
									}))
								}
								values={sectionFilters[section.id] ?? []}
							/>
						</div>
						<div className="flex flex-wrap gap-2 empty:hidden">
							{(sectionFilters[section.id] ?? []).map((value) => (
								<SidebarFilterBadge
									key={value}
									label={
										PEOPLE_COMPUTER_FILTER_LABELS[
											value as keyof typeof PEOPLE_COMPUTER_FILTER_LABELS
										]
									}
									onRemove={() =>
										setSectionFilters((current) => ({
											...current,
											[section.id]: current[section.id].filter(
												(item) => item !== value
											),
										}))
									}
								/>
							))}
						</div>
						<FluidCardGroup
							aria-label={section.label}
							className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
							role="list"
						>
							{section.members.map((member, index) => (
								<HumanProfileItem
									actionsDisabled={sidebar.disabled || input.chatPending}
									activityNowMs={input.activityNowMs}
									computerGroup={computers.get(member.userId) ?? null}
									index={index}
									isActive={false}
									key={member.id}
									member={member}
									onChat={
										input.onChat &&
										!member.isCurrentUser &&
										member.profileStatus === "active"
											? () => {
													input
														.onChat?.(member.id)
														.catch((error) =>
															toast.error(
																error instanceof Error
																	? error.message
																	: "Couldn't open this conversation. Try again."
															)
														);
												}
											: undefined
									}
									onSelect={input.onSelect}
									onToggleStar={() => {
										if (sidebar.preferences) {
											sidebar.save({
												...sidebar.preferences,
												people: toggleSidebarPersonStar(
													sidebar.preferences.people ?? EMPTY_PEOPLE_SIDEBAR,
													member.id
												),
											});
										}
									}}
									presentation="card"
									starred={sidebar.preferences?.people?.starred.itemIds.includes(
										member.id
									)}
								/>
							))}
						</FluidCardGroup>
						{section.members.length === 0 ? (
							<p className="text-muted-foreground text-xs">
								No members in this group.
							</p>
						) : null}
					</section>
				))}
			</div>
		</div>
	);
}

function TeamGroupIcon({ id }: { id: string }) {
	if (id === "starred") {
		return (
			<StarIcon
				aria-hidden="true"
				className="size-4 shrink-0 text-muted-foreground"
			/>
		);
	}
	if (id === "online") {
		return (
			<UserIcon
				aria-hidden="true"
				className="size-4 shrink-0 text-emerald-500"
			/>
		);
	}
	if (id === "offline" || id === "presence-unknown") {
		return (
			<UserIcon
				aria-hidden="true"
				className="size-4 shrink-0 text-muted-foreground"
			/>
		);
	}
	return (
		<FolderIcon
			aria-hidden="true"
			className="size-4 shrink-0 text-muted-foreground"
		/>
	);
}

const COMPUTER_FILTER_ICONS = {
	connected: DesktopTowerIcon,
	offline: WifiSlashIcon,
	unconnected: MinusCircleIcon,
	unknown: QuestionIcon,
};

function TeamComputerFilterIcon({
	value,
}: {
	value: keyof typeof PEOPLE_COMPUTER_FILTER_LABELS;
}) {
	const Icon = COMPUTER_FILTER_ICONS[value];
	return (
		<Icon
			aria-hidden="true"
			className="size-4 shrink-0 text-muted-foreground"
		/>
	);
}

function TeamSectionFilter(input: {
	label: string;
	values: string[];
	onChange: (values: string[]) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label={`${input.label} group filters`}
						className="opacity-0 group-focus-within/people-section:opacity-100 group-hover/people-section:opacity-100 data-popup-open:opacity-100 [@media(hover:none)]:opacity-100"
						size="icon-sm"
						variant="ghost"
					/>
				}
			>
				<SlidersHorizontalIcon />
			</DropdownMenuTrigger>
			<FluidDropdownMenuContent align="end" className="w-56">
				<TeamComputerFilterItems
					onChange={input.onChange}
					values={input.values}
				/>
			</FluidDropdownMenuContent>
		</DropdownMenu>
	);
}

function TeamComputerFilterItems(input: {
	values: string[];
	onChange: (values: string[]) => void;
}) {
	return (
		<>
			{Object.entries(PEOPLE_COMPUTER_FILTER_LABELS).map(([value, label]) => (
				<DropdownMenuCheckboxItem
					checked={input.values.includes(value)}
					closeOnClick={false}
					key={value}
					onCheckedChange={(checked) =>
						input.onChange(
							checked
								? [...input.values, value]
								: input.values.filter((item) => item !== value)
						)
					}
				>
					<TeamComputerFilterIcon
						value={value as keyof typeof PEOPLE_COMPUTER_FILTER_LABELS}
					/>
					{label}
				</DropdownMenuCheckboxItem>
			))}
			<DropdownMenuCheckboxItem
				checked={input.values.length === 0}
				onCheckedChange={() => input.onChange([])}
			>
				<DevicesIcon
					aria-hidden="true"
					className="size-4 shrink-0 text-muted-foreground"
				/>
				All computer states
			</DropdownMenuCheckboxItem>
		</>
	);
}
