"use client";

import { createFileRootApi } from "@openmeld/api-client";
import type {
	FileRootEntry,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@openmeld/ui/components/popover";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowRightIcon,
	FileTextIcon,
	GitDiffIcon,
	NotebookIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AgentProfileControllerAvatar } from "#/components/agents/agent-profile-controller-avatar";
import {
	AgentTaskActivityTime,
	agentTaskActivityNavigation,
} from "#/components/agents/agent-task-activity";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationAgentsPath,
	buildOrganizationFilesPath,
} from "#/lib/organizations/organization-routes";
import type { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";
import { useNowMs } from "#/lib/spaces/use-now-ms";
import {
	organizationAgentRuntimeOverviewQueryOptions,
	organizationProfileIdentityDirectoryQueryOptions,
} from "#/query/organizations/organization-directory";
import { organizationDocumentsQueryOptions } from "#/query/organizations/organization-documents";
import { DirectorySearch } from "./directory-search";
import {
	compactDeskProgress,
	DESK_LABELS,
	type DeskActivity,
	type DeskState,
	deskState,
	latestTeamFileByAgent,
} from "./team-desks-model";
import { TeamHeader } from "./team-header";

type Agent = Pick<
	OrganizationProfileDirectoryResponse["agentProfiles"][number],
	| "profileId"
	| "profileName"
	| "agentControllerRef"
	| "avatarUrl"
	| "avatarStyle"
	| "avatarModelId"
>;
type SharedFile = Extract<FileRootEntry, { kind: "file" }>;
const DIFF_FILE_PATTERN = /\.(diff|patch)$/iu;

const STATUS_COLORS: Record<DeskState, string> = {
	working: "bg-emerald-500",
	paused: "bg-amber-500",
	idle: "bg-muted-foreground/40",
	unknown: "bg-transparent ring-1 ring-muted-foreground/50",
};

export function TeamDesksPage(input: {
	initialSidebarStates?: Awaited<
		ReturnType<typeof getAppSidebarStatesForRoute>
	>;
}) {
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			defaultModuleSidebarOpen={false}
			initialOuterSidebarState={input.initialSidebarStates?.outer}
			mainHeader={<TeamHeader active="desks" />}
			showMainHeader
		>
			<TeamDesks />
		</AppFullWidthLayout>
	);
}

export function TeamDesks() {
	const { currentOrganization } = useAppOrganization();
	const organizationId = currentOrganization.id;
	const [search, setSearch] = useState("");
	const now = useNowMs(30_000);
	const directory = useQuery(
		organizationProfileIdentityDirectoryQueryOptions({
			enabled: true,
			organizationId,
		})
	);
	const runtime = useQuery(
		organizationAgentRuntimeOverviewQueryOptions({
			enabled: true,
			organizationId,
		})
	);
	const fileApi = useMemo(
		() =>
			createFileRootApi(
				createOrganizationScopedWebOpenMeldApiFoundation({ organizationId })
			),
		[organizationId]
	);
	const files = useQuery({
		queryKey: ["file-root", organizationId, "team", null, "active"],
		queryFn: ({ signal }) =>
			fileApi.list({
				location: "team",
				parentId: null,
				view: "active",
				signal,
			}),
		staleTime: 30_000,
	});
	const sharedFiles = latestTeamFileByAgent(
		files.isError ? [] : (files.data?.entries ?? []),
		organizationId
	);
	const activityById = new Map(
		runtime.data?.agentProfiles.map((activity) => [
			activity.profileId,
			activity,
		])
	);
	const owners = new Map(
		directory.data?.members.map((member) => [member.userId, member.user.name])
	);
	const agents = (directory.data?.agentProfiles ?? []).filter(
		(agent) => agent.status === "active"
	);
	const desks = agents.map((agent) => ({
		agent,
		owner:
			agent.ownerName ?? owners.get(agent.ownerUserId ?? "") ?? "Team Agent",
		activity: activityById.get(agent.profileId),
		state: deskState({
			activity: activityById.get(agent.profileId),
			generatedAt: runtime.data?.generatedAt,
			failed: runtime.isError,
			now,
		}),
	}));
	const visible = desks
		.filter(({ agent, owner }) =>
			`${agent.profileName} ${owner}`
				.toLocaleLowerCase()
				.includes(search.trim().toLocaleLowerCase())
		)
		.sort(
			(a, b) =>
				a.owner.localeCompare(b.owner) ||
				a.agent.profileName.localeCompare(b.agent.profileName)
		);
	const working = desks.filter((desk) => desk.state === "working").length;
	const waiting = desks.filter((desk) => desk.state === "paused").length;
	const unknown = desks.filter((desk) => desk.state === "unknown").length;
	return (
		<section
			aria-labelledby="team-directory-tab-0"
			className="flex flex-1 flex-col gap-8 px-[var(--app-page-inline-padding)] py-[var(--app-page-block-padding)]"
			id="team-directory-panel-0"
			role="tabpanel"
		>
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="font-semibold text-2xl tracking-tight">
						At their desks
					</h1>
					<p className="mt-2 text-muted-foreground text-sm">
						{runtime.isPending
							? "Checking activity…"
							: `${working} working · ${waiting} waiting${unknown ? ` · ${unknown} unavailable` : ""} · ${desks.length} Agents`}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-muted-foreground text-xs">
						Hover or tap to catch up
					</span>
					<DirectorySearch
						label="Search desks"
						onChange={setSearch}
						value={search}
					/>
				</div>
			</div>
			{directory.isPending ? (
				<fieldset
					aria-label="Loading Agent desks"
					className="grid grid-cols-2 gap-5 lg:grid-cols-4"
				>
					{[0, 1, 2, 3].map((id) => (
						<Skeleton className="h-56 rounded-xl" key={id} />
					))}
				</fieldset>
			) : null}
			{directory.isError ? (
				<div role="alert">
					<p>Agent desks couldn’t load.</p>
					<Button
						className="mt-2"
						onClick={() => directory.refetch()}
						variant="secondary"
					>
						Try again
					</Button>
				</div>
			) : null}
			{runtime.isError && !directory.isError ? (
				<output className="text-muted-foreground text-sm">
					Activity couldn’t refresh. Open an Agent to check its status.{" "}
					<Button onClick={() => runtime.refetch()} size="sm" variant="ghost">
						Retry
					</Button>
				</output>
			) : null}
			{!(directory.isPending || directory.isError) && visible.length === 0 ? (
				<div className="py-16 text-center">
					<h2 className="font-medium">
						{search
							? "No matching desks"
							: "Your team’s Agents will appear here"}
					</h2>
					<p className="mt-2 text-muted-foreground text-sm">
						{search
							? "Try an Agent or teammate’s name."
							: "Connect an Agent to give it a place on the team."}
					</p>
					<Link
						className="mt-4 inline-flex items-center gap-2 text-sm underline underline-offset-4"
						to={buildOrganizationAgentsPath(currentOrganization.slug)}
					>
						Open Agents <ArrowRightIcon />
					</Link>
				</div>
			) : null}
			{directory.isError ? null : (
				<FluidCardGroup className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
					{visible.map((desk) => (
						<AgentDesk
							{...desk}
							file={sharedFiles.get(desk.agent.profileId)}
							key={desk.agent.profileId}
							organizationId={organizationId}
							organizationSlug={currentOrganization.slug}
						/>
					))}
				</FluidCardGroup>
			)}
			<SharedTeamKnowledge />
		</section>
	);
}

export function AgentDesk(input: {
	agent: Agent;
	owner: string;
	activity?: DeskActivity;
	state: DeskState;
	file?: SharedFile;
	organizationId: string;
	organizationSlug: string;
}) {
	const [open, setOpen] = useState(false);
	const { agent, state } = input;
	const detail = useQuery(
		organizationAgentRuntimeOverviewQueryOptions({
			enabled: open,
			organizationId: input.organizationId,
			workloadProfileId: agent.profileId,
		})
	);
	const activity = detail.data?.agentProfiles.find(
		(item) => item.profileId === agent.profileId
	);
	const workload = detail.isError ? undefined : activity?.workload;
	const current =
		workload?.status === "ready"
			? workload.items.find(
					(item) => item.kind === "active" || item.kind === "waiting"
				)
			: undefined;
	const navigation =
		state === "unknown"
			? null
			: agentTaskActivityNavigation(input.activity, input.organizationSlug)
					?.current;
	let progress = "No active work reported.";
	if (state === "unknown") {
		progress = "Current activity is unavailable.";
	} else if (detail.isError || workload?.status === "unavailable") {
		progress = "Progress is unavailable right now.";
	} else if (state !== "idle" && current?.text) {
		progress = compactDeskProgress(current.text);
	} else if (state !== "idle") {
		progress = detail.isPending
			? "Checking shared progress…"
			: "No shared progress available.";
	}
	const diff = input.file && DIFF_FILE_PATTERN.test(input.file.name);
	return (
		<FluidCardItem
			className="rounded-xl border border-border/70 bg-card"
			itemId={agent.profileId}
		>
			<Popover onOpenChange={setOpen} open={open}>
				<PopoverTrigger
					aria-label={`${agent.profileName}, ${input.owner}: ${DESK_LABELS[state]}`}
					className="group flex w-full flex-col items-center px-5 pt-6 pb-5 text-center outline-none"
					delay={250}
					openOnHover
				>
					<span className="mb-6 flex items-center gap-1.5 self-start text-muted-foreground text-xs">
						<span
							aria-hidden="true"
							className={cn("size-1.5 rounded-full", STATUS_COLORS[state])}
						/>
						{DESK_LABELS[state]}
					</span>
					<AgentProfileControllerAvatar
						agentControllerRef={agent.agentControllerRef}
						avatarImageUrl={agent.avatarUrl}
						avatarStyle={agent.avatarStyle}
						clickable={false}
						modelId={agent.avatarModelId}
						profileId={agent.profileId}
						profileName={agent.profileName}
						size={68}
						variant="plain"
						working={state === "working"}
					/>
					<span
						aria-hidden="true"
						className="mt-3 h-1 w-28 rounded-full bg-border/60"
					/>
					<span className="mt-5 max-w-full truncate font-medium text-sm">
						{agent.profileName}
					</span>
					<span className="mt-1 max-w-full truncate text-muted-foreground text-xs">
						{input.owner}
					</span>
					<span className="mt-5 w-full truncate border-border/50 border-t pt-3 text-muted-foreground text-xs">
						{navigation?.title ?? (input.file ? input.file.name : "Open desk")}
					</span>
				</PopoverTrigger>
				<PopoverContent
					className="w-80 max-w-[calc(100vw-2rem)] gap-3 rounded-xl p-4"
					side="top"
					sideOffset={8}
				>
					<PopoverTitle>{agent.profileName}</PopoverTitle>
					<p className="line-clamp-2 text-sm leading-relaxed">{progress}</p>
					{navigation ? (
						<Link
							className="truncate text-muted-foreground text-xs hover:text-foreground"
							to={navigation.href}
						>
							{navigation.title} →
						</Link>
					) : null}
					{input.file ? (
						<Link
							className="flex items-center gap-2 rounded-md bg-muted/50 p-2 text-xs"
							search={{ view: "team", file: input.file.id }}
							to={buildOrganizationFilesPath(input.organizationSlug)}
						>
							{diff ? (
								<GitDiffIcon className="shrink-0" />
							) : (
								<FileTextIcon className="shrink-0" />
							)}
							<span className="truncate">
								{diff ? "Shared diff" : "Shared file"}: {input.file.name}
							</span>
						</Link>
					) : null}
					<AgentTaskActivityTime
						timestamp={input.activity?.lastTaskActivityAt}
					/>
					<Link
						className="flex items-center justify-between border-border/60 border-t pt-3 font-medium text-xs"
						search={{ profileId: agent.profileId }}
						to={buildOrganizationAgentsPath(input.organizationSlug)}
					>
						Open Agent <ArrowRightIcon />
					</Link>
				</PopoverContent>
			</Popover>
		</FluidCardItem>
	);
}

function SharedTeamKnowledge() {
	const { currentOrganization } = useAppOrganization();
	const organizationId = currentOrganization.id;
	const knowledge = useQuery(
		organizationDocumentsQueryOptions({ organizationId })
	);
	// Knowledge titles are Team publications; they do not identify an Agent's private memory.
	const publishedKnowledge = (
		knowledge.isError ? [] : (knowledge.data?.documents ?? [])
	)
		.filter((document) => document.kind === "knowledge")
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
		.slice(0, 3);
	return (
		<div className="mt-auto border-border/60 border-t pt-6">
			<div className="flex items-center justify-between gap-4">
				<h2 className="flex items-center gap-2 font-medium text-sm">
					<NotebookIcon /> Shared team knowledge
				</h2>
				<Link
					className="text-muted-foreground text-xs hover:text-foreground"
					search={{ view: "knowledge" }}
					to={buildOrganizationFilesPath(currentOrganization.slug)}
				>
					Open knowledge →
				</Link>
			</div>
			{publishedKnowledge.length ? (
				<div className="mt-4 grid gap-3 md:grid-cols-3">
					{publishedKnowledge.map((document) => (
						<Link
							className="truncate rounded-md border border-border/60 px-4 py-3 text-sm hover:bg-muted/50"
							key={document.id}
							search={{ view: "knowledge", document: document.id }}
							to={buildOrganizationFilesPath(currentOrganization.slug)}
						>
							{document.title}
						</Link>
					))}
				</div>
			) : (
				<p className="mt-3 text-muted-foreground text-xs">
					{knowledge.isError
						? "Team knowledge couldn’t load."
						: "Knowledge shared with the team appears here. Private Agent memories stay private."}
				</p>
			)}
		</div>
	);
}
