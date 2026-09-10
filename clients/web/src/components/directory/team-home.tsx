import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { Input } from "@openmeld/ui/components/input";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { FluidCardGroup } from "@openmeld/ui/fluid/card";
import { FluidDropdownMenuContent } from "@openmeld/ui/fluid/dropdown-menu";
import {
	MagnifyingGlassIcon,
	SlidersHorizontalIcon,
	StarIcon,
	UserIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useCallback, useState } from "react";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { useSidebarPreferences } from "../app/use-sidebar-preferences";
import type { OrganizationComputerGroup } from "../computers/organization-computers";
import { CenterAgentItem } from "./center-agent-item";
import type { DirectoryHumanProfileRow } from "./directory-human-profile-model";
import { HumanProfileItem } from "./human-profile-item";
import {
	EMPTY_PEOPLE_SIDEBAR,
	resolvePeopleSections,
} from "./people-sidebar-order";

export function TeamHome(input: {
	members: readonly DirectoryHumanProfileRow[];
	computerGroups: readonly OrganizationComputerGroup[];
	activityNowMs: number;
	onSelect: (id: string) => void;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const viewerId =
		input.members.find((member) => member.isCurrentUser)?.id ?? currentUserId;
	const sidebar = useSidebarPreferences(viewerId, currentOrganization.id);
	const [search, setSearch] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const focusSearch = useCallback(
		(node: HTMLInputElement | null) => node?.focus(),
		[]
	);
	const [groupIds, setGroupIds] = useState<string[]>([]);
	const allSections = resolvePeopleSections(
		input.members,
		sidebar.preferences?.people ?? EMPTY_PEOPLE_SIDEBAR,
		{ includeCenterAgent: true }
	);
	const query = search.trim().toLocaleLowerCase();
	const filtering = Boolean(query) || groupIds.length > 0;
	const showCenterAgent =
		!query && (groupIds.length === 0 || groupIds.includes("center-agent"));
	const sections = allSections
		.filter((section) => groupIds.length === 0 || groupIds.includes(section.id))
		.map((section) => ({
			...section,
			members: section.members.filter((member) =>
				member.name.toLocaleLowerCase().includes(query)
			),
		}))
		.filter(
			(section) =>
				!filtering ||
				section.members.length > 0 ||
				(section.id === "center-agent" && showCenterAgent)
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
			aria-labelledby="team-directory-tab-0"
			className="w-full"
			id="team-directory-panel-0"
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
					{searchOpen ? (
						<>
							<Input
								aria-label="Search members"
								className="h-8 w-52 max-w-full"
								onChange={(event) => setSearch(event.target.value)}
								placeholder="Search members…"
								ref={focusSearch}
								type="search"
								value={search}
							/>
							<Button
								aria-label="Close search"
								onClick={() => {
									setSearch("");
									setSearchOpen(false);
								}}
								size="icon-sm"
								variant="ghost"
							>
								<XIcon />
							</Button>
						</>
					) : (
						<Button
							aria-label="Search members"
							onClick={() => setSearchOpen(true)}
							size="icon-sm"
							variant="ghost"
						>
							<MagnifyingGlassIcon />
						</Button>
					)}
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									aria-label="Filter team groups"
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
						</FluidDropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			{groupIds.length > 0 ? (
				<div className="px-[var(--app-page-inline-padding)] pb-3">
					<Button onClick={() => setGroupIds([])} size="sm" variant="ghost">
						Clear group filters
						<XIcon />
					</Button>
				</div>
			) : null}
			<div className="space-y-7 px-[var(--app-page-inline-padding)] pb-8">
				{filtering && visibleCount === 0 && !showCenterAgent ? (
					<p className="text-muted-foreground text-sm">
						No members match your search or filters.
					</p>
				) : null}
				{sidebar.isPending ? (
					<p className="text-muted-foreground text-sm">Loading team…</p>
				) : (
					sections.map((section) => (
						<section
							aria-label={section.label}
							className="space-y-2"
							key={section.id}
						>
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
									{section.members.length +
										(section.id === "center-agent" && showCenterAgent ? 1 : 0)}
								</span>
							</h2>
							<FluidCardGroup
								aria-label={section.label}
								className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
								role="list"
							>
								{section.id === "center-agent" && showCenterAgent && (
									<CenterAgentItem presentation="card" />
								)}
								{section.members.map((member, index) => (
									<HumanProfileItem
										activityNowMs={input.activityNowMs}
										computerGroup={computers.get(member.userId) ?? null}
										index={index}
										isActive={false}
										key={member.id}
										member={member}
										onSelect={input.onSelect}
										presentation="card"
									/>
								))}
							</FluidCardGroup>
							{section.members.length === 0 &&
							!(section.id === "center-agent" && showCenterAgent) ? (
								<p className="text-muted-foreground text-xs">
									No members in this group.
								</p>
							) : null}
						</section>
					))
				)}
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
	if (id === "offline") {
		return (
			<UserIcon
				aria-hidden="true"
				className="size-4 shrink-0 text-muted-foreground"
			/>
		);
	}
	return null;
}
