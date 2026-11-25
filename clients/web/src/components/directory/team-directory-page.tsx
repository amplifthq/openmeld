import type { OrganizationProfileDirectoryResponse } from "@openmeld/schemas/types";
import { buttonVariants } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { SkeletonRegion } from "@openmeld/ui/components/skeleton-content";
import { FluidNavMenu, FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowLeftIcon,
	GearSixIcon,
	MagnifyingGlassIcon,
	RobotIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationPeoplePath,
	buildOrganizationPersonAgentPath,
} from "#/lib/organizations/organization-routes";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import {
	TeamAgentActivity,
	TeamPersonActivity,
	TeamReadError,
	TeamTopics,
} from "./team-activity";
import { TeamHeader, type TeamView } from "./team-header";

type DirectoryPerson = OrganizationProfileDirectoryResponse["members"][number];
type DirectoryAgent =
	OrganizationProfileDirectoryResponse["agentProfiles"][number];
type TeamEntry =
	| { kind: "person"; id: string; name: string; person: DirectoryPerson }
	| { kind: "agent"; id: string; name: string; agent: DirectoryAgent };
type TeamSelection = Pick<TeamEntry, "kind" | "id">;
const TEAM_SEARCH_WHITESPACE = /\s+/u;

export function TeamDirectoryPage(input: {
	initialSidebarStates?: AppSidebarPersistedStates;
	selection?: TeamSelection;
	view: TeamView;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const organizationId = currentOrganization.id;
	const teamPath = buildOrganizationPeoplePath(currentOrganization.slug);
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			initialOuterSidebarState={input.initialSidebarStates?.outer}
			mainHeader={<TeamHeader active={input.view} />}
			scroll={false}
			showMainHeader
		>
			<div
				aria-labelledby={
					input.view === "members"
						? "team-directory-tab-0"
						: "team-directory-tab-1"
				}
				className="min-h-0 flex-1"
				id={
					input.view === "members"
						? "team-directory-panel-0"
						: "team-directory-panel-1"
				}
				role="tabpanel"
			>
				{input.view === "topics" ? (
					<ScrollArea className="h-full">
						<TeamTopics key={organizationId} organizationId={organizationId} />
					</ScrollArea>
				) : (
					<TeamMembers
						currentUserId={currentUserId}
						key={organizationId}
						organizationId={organizationId}
						orgSlug={currentOrganization.slug}
						selection={input.selection}
						teamPath={teamPath}
					/>
				)}
			</div>
		</AppFullWidthLayout>
	);
}

function TeamMembers(input: {
	currentUserId: string;
	organizationId: string;
	orgSlug: string;
	selection?: TeamSelection;
	teamPath: string;
}) {
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const data =
		directory.data?.organizationId === input.organizationId
			? directory.data
			: undefined;
	const people: TeamEntry[] = (data?.members ?? [])
		.map(
			(person): TeamEntry => ({
				id: person.humanProfile?.profileId ?? `member:${person.memberId}`,
				kind: "person",
				name: person.humanProfile?.profileName ?? person.user.name,
				person,
			})
		)
		.sort(
			(left, right) =>
				Number(
					right.kind === "person" && right.person.userId === input.currentUserId
				) -
					Number(
						left.kind === "person" && left.person.userId === input.currentUserId
					) || left.name.localeCompare(right.name)
		);
	const agents: TeamEntry[] = (data?.agentProfiles ?? [])
		.filter(
			(agent) =>
				agent.organizationId === input.organizationId &&
				agent.status === "active" &&
				agent.managedRole !== "openmeld_assistant"
		)
		.map(
			(agent): TeamEntry => ({
				id: agent.profileId,
				kind: "agent",
				name: agent.profileName,
				agent,
			})
		)
		.sort((left, right) => left.name.localeCompare(right.name));
	const target = input.selection;
	const selected = target
		? (target.kind === "agent" ? agents : people).find(
				(entry) => entry.id === target.id
			)
		: (people[0] ?? agents[0]);
	const showError = directory.isError || !(data || directory.isPending);
	return (
		<div className="grid h-full min-h-0 min-w-0 md:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)]">
			<aside
				aria-label="Team members"
				className={cn(
					"min-h-0 min-w-0 flex-col gap-4 p-4 md:flex md:border-border/70 md:border-r",
					target ? "hidden" : "flex"
				)}
			>
				{data && (
					<TeamMemberList
						agents={agents}
						people={people}
						selected={selected}
						teamPath={input.teamPath}
					/>
				)}
				{showError && (
					<TeamReadError
						label="Couldn’t load team members."
						onRetry={() => directory.refetch()}
					/>
				)}
				{directory.isPending ? (
					<SkeletonRegion className="space-y-3" label="Loading team members">
						<Skeleton className="h-9 w-full" />
						<Skeleton className="h-9 w-full" />
						<Skeleton className="h-9 w-full" />
					</SkeletonRegion>
				) : null}
			</aside>
			<ScrollArea
				className={cn("min-h-0 min-w-0 md:flex", !target && "hidden")}
			>
				<div className="w-full max-w-5xl space-y-6 px-5 py-6 sm:px-8">
					<Link
						className="inline-flex items-center gap-2 text-muted-foreground text-sm md:hidden"
						search={{}}
						to={input.teamPath}
					>
						<ArrowLeftIcon aria-hidden="true" className="size-4" />
						Members
					</Link>
					{selected?.kind === "person" ? (
						<TeamPersonProfile
							agents={agents}
							entry={selected}
							key={selected.id}
							organizationId={input.organizationId}
							teamPath={input.teamPath}
						/>
					) : null}
					{selected?.kind === "agent" ? (
						<TeamAgentProfile
							agents={agents}
							currentUserId={input.currentUserId}
							entry={selected}
							key={selected.id}
							organizationId={input.organizationId}
							orgSlug={input.orgSlug}
							people={people}
							teamPath={input.teamPath}
						/>
					) : null}
					{target &&
						!selected &&
						!directory.isPending &&
						(data ? (
							<p className="text-muted-foreground text-sm">
								This member isn’t in the team directory.
							</p>
						) : (
							<TeamReadError
								label="Couldn’t load this member."
								onRetry={() => directory.refetch()}
							/>
						))}
				</div>
			</ScrollArea>
		</div>
	);
}

function TeamMemberList(input: {
	agents: readonly TeamEntry[];
	people: readonly TeamEntry[];
	selected?: TeamEntry;
	teamPath: string;
}) {
	const [search, setSearch] = useState("");
	const words = search
		.trim()
		.toLocaleLowerCase()
		.split(TEAM_SEARCH_WHITESPACE)
		.filter(Boolean);
	const matches = (entry: TeamEntry) =>
		words.every((word) => entry.name.toLocaleLowerCase().includes(word));
	const groups = [
		{ label: "People", entries: input.people.filter(matches) },
		{ label: "Agents", entries: input.agents.filter(matches) },
	].filter((group) => group.entries.length > 0);
	return (
		<>
			<p className="text-muted-foreground text-sm">
				{input.people.length} {input.people.length === 1 ? "person" : "people"}{" "}
				· {input.agents.length} {input.agents.length === 1 ? "agent" : "agents"}
			</p>
			<div className="relative">
				<MagnifyingGlassIcon
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					aria-label="Find a person or agent"
					className="pl-9"
					onChange={(event) => setSearch(event.target.value)}
					placeholder="Find a person or agent"
					type="search"
					value={search}
				/>
			</div>
			{groups.map((group) => (
				<TeamEntryGroup
					entries={group.entries}
					key={group.label}
					label={group.label}
					selected={input.selected}
					teamPath={input.teamPath}
				/>
			))}
			{groups.length === 0 && (
				<p className="text-muted-foreground text-sm">
					{words.length
						? "No people or Agents match your search."
						: "No team members yet."}
				</p>
			)}
		</>
	);
}

function TeamEntryGroup(input: {
	entries: readonly TeamEntry[];
	label: string;
	selected?: TeamEntry;
	teamPath: string;
}) {
	return (
		<section className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
			<h2 className="px-2 font-semibold text-sm">{input.label}</h2>
			<ScrollArea className="min-h-0 flex-1">
				<FluidNavMenu
					activeValue={input.selected?.id ?? null}
					aria-label={input.label}
					hoverMaxDistance={0}
				>
					{input.entries.map((entry, index) => (
						<FluidNavMenuItem index={index} key={entry.id} value={entry.id}>
							<TeamEntryLink
								current={input.selected?.id === entry.id}
								entry={entry}
								teamPath={input.teamPath}
							/>
						</FluidNavMenuItem>
					))}
				</FluidNavMenu>
			</ScrollArea>
		</section>
	);
}

function teamEntrySearch(entry: TeamEntry) {
	return entry.kind === "agent"
		? { agentId: entry.id }
		: { profileId: entry.id };
}

function TeamEntryLink(input: {
	current?: boolean;
	entry: TeamEntry;
	teamPath: string;
}) {
	return (
		<Link
			activeProps={{ "aria-current": input.current ? "page" : undefined }}
			aria-current={input.current ? "page" : undefined}
			aria-label={input.entry.name}
			className="flex min-h-11 min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
			search={teamEntrySearch(input.entry)}
			to={input.teamPath}
		>
			<TeamEntryAvatar entry={input.entry} size={28} />
			<span className="min-w-0 truncate">{input.entry.name}</span>
		</Link>
	);
}

function TeamEntryAvatar(input: { entry: TeamEntry; size: number }) {
	if (input.entry.kind === "agent") {
		return (
			<span
				aria-hidden="true"
				className="grid shrink-0 place-items-center rounded-lg bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200"
				style={{ height: input.size, width: input.size }}
			>
				<RobotIcon className="size-3/5" />
			</span>
		);
	}
	return (
		<DitherProfileAvatar
			avatarImageUrl={input.entry.person.user.image}
			className="shrink-0"
			profileId={input.entry.id}
			profileKind="human"
			profileName={input.entry.name}
			size={input.size}
		/>
	);
}

function TeamProfileHeader(input: {
	entry: TeamEntry;
	byline?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<header className="flex flex-wrap items-center justify-between gap-3 border-border/60 border-b pb-5">
			<div className="flex min-w-0 items-center gap-4">
				<TeamEntryAvatar entry={input.entry} size={56} />
				<div className="min-w-0">
					<h2 className="break-words font-semibold text-2xl tracking-tight">
						{input.entry.name}
					</h2>
					{input.byline}
				</div>
			</div>
			{input.actions}
		</header>
	);
}

function TeamPersonProfile(input: {
	entry: Extract<TeamEntry, { kind: "person" }>;
	agents: readonly TeamEntry[];
	organizationId: string;
	teamPath: string;
}) {
	const userId = input.entry.person.userId;
	const agents = input.agents.filter(
		(entry) => entry.kind === "agent" && entry.agent.ownerUserId === userId
	);
	return (
		<>
			<TeamProfileHeader entry={input.entry} />
			<section
				aria-labelledby="team-person-agents"
				className="space-y-2 border-border/60 border-b pb-5"
			>
				<h3
					className="flex items-center gap-2 font-semibold text-base"
					id="team-person-agents"
				>
					Agents{" "}
					<span className="font-normal text-muted-foreground text-sm">
						{agents.length}
					</span>
				</h3>
				{agents.length > 0 ? (
					<ul className="divide-y divide-border/60">
						{agents.map((agent) => (
							<li key={agent.id}>
								<TeamEntryLink entry={agent} teamPath={input.teamPath} />
							</li>
						))}
					</ul>
				) : (
					<p className="text-muted-foreground text-sm">
						No Agents in this team.
					</p>
				)}
			</section>
			<TeamPersonActivity
				lastActiveAt={input.entry.person.lastActiveAt}
				organizationId={input.organizationId}
				userId={userId}
			/>
		</>
	);
}

function TeamAgentProfile(input: {
	entry: Extract<TeamEntry, { kind: "agent" }>;
	agents: readonly TeamEntry[];
	people: readonly TeamEntry[];
	currentUserId: string;
	organizationId: string;
	orgSlug: string;
	teamPath: string;
}) {
	const agent = input.entry.agent;
	const creator =
		input.people.find((person) => person.id === agent.creatorProfileId) ??
		input.agents.find((entry) => entry.id === agent.creatorProfileId) ??
		input.people.find(
			(person) =>
				person.kind === "person" &&
				person.person.userId === agent.createdByUserId
		);
	const owner = input.people.find(
		(person) =>
			person.kind === "person" && person.person.userId === agent.ownerUserId
	);
	return (
		<>
			<TeamProfileHeader
				actions={
					owner && agent.ownerUserId === input.currentUserId ? (
						<Link
							className={buttonVariants({ size: "sm", variant: "ghost" })}
							hash="agent-runtime-settings"
							to={buildOrganizationPersonAgentPath({
								agentId: agent.profileId,
								orgSlug: input.orgSlug,
								personId: owner.id,
							})}
						>
							<GearSixIcon aria-hidden="true" />
							Runtime settings
						</Link>
					) : null
				}
				byline={
					<p className="mt-1 text-muted-foreground text-sm">
						{creator ? (
							<>
								Created by{" "}
								<Link
									className="underline underline-offset-2"
									search={teamEntrySearch(creator)}
									to={input.teamPath}
								>
									{creator.name}
								</Link>
							</>
						) : (
							"Creator unavailable"
						)}
					</p>
				}
				entry={input.entry}
			/>
			<TeamAgentActivity
				lastTaskActivityAt={agent.lastTaskActivityAt}
				organizationId={input.organizationId}
				profileId={agent.profileId}
			/>
		</>
	);
}
