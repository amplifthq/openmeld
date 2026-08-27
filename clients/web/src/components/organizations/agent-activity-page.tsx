"use client";

import type {
	AgentActivitySnapshotResponse,
	AgentActivityStatsResponse,
	ListProjectsResponse,
	OrganizationDirectoryResponse,
	Project,
} from "@openmeld/schemas/types";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import {
	resolveStatusToneIconClassName,
	resolveStatusToneOpaqueWarningSurfaceClassName,
	resolveStatusToneStrongTextClassName,
	resolveStatusToneSurfaceClassName,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowClockwiseIcon,
	ChartBarIcon,
	ClockCounterClockwiseIcon,
	FolderOpenIcon,
	ListBulletsIcon,
	ShieldCheckIcon,
} from "@phosphor-icons/react";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useQueryState } from "nuqs";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	AppContextualContentFrame,
	type AppContextualNavGroup,
	AppContextualSidebarNav,
} from "#/components/app/app-contextual-layout";
import { APP_CONTEXTUAL_MAIN_TEXT_BASE_START_CLASS_NAME } from "#/components/app/app-contextual-layout-style";
import { AppGlobalControls } from "#/components/app/app-global-controls";
import { AppInnerSidebar } from "#/components/app/app-inner-sidebar";
import { AppOuterRail } from "#/components/app/app-outer-rail";
import { useAppShellAccount } from "#/components/app/app-shell-account";
import { AppSurfaceLayout } from "#/components/app/app-surface-layout";
import { agentActivityProjectScopeParser } from "#/lib/organizations/agent-activity-search";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationProjectsPath } from "#/lib/organizations/organization-routes";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";
import {
	agentActivitySnapshotQueryOptions,
	agentActivityStatsQueryOptions,
} from "#/query/organizations/agent-activity";
import { organizationDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { projectsQueryOptions } from "#/query/organizations/projects";
import {
	type ActivityMember,
	type ActivityView,
	type ActivityViewFilters,
	deriveActivityView,
} from "./agent-activity-derive";

const DEFAULT_WINDOW_MS = 4 * 60 * 60_000;
const ALL_PROJECTS_VALUE = "all";

export type AgentActivitySectionId = "changes" | "overview" | "sessions";

export type AgentActivityRoutes = Record<AgentActivitySectionId, string>;

type AgentActivityDataContextValue = {
	currentTimeMs: number;
	directoryQuery: UseQueryResult<OrganizationDirectoryResponse, unknown>;
	membersByUserId: ReadonlyMap<string, ActivityMember>;
	organizationId: string;
	projectScopeId: string | null;
	projects: Project[];
	projectsQuery: UseQueryResult<ListProjectsResponse, unknown>;
	snapshotQuery: UseQueryResult<AgentActivitySnapshotResponse, unknown>;
	statsQuery: UseQueryResult<AgentActivityStatsResponse, unknown>;
	updateProjectScope: (projectId: string | null) => void;
};

const AgentActivityDataContext =
	createContext<AgentActivityDataContextValue | null>(null);

export function AgentActivityPage(input: {
	activeSectionId: AgentActivitySectionId;
	children: ReactNode;
	initialSidebarStates?: AppSidebarPersistedStates;
	routes: AgentActivityRoutes;
}) {
	const account = useAppShellAccount();
	return (
		<AppSurfaceLayout
			globalControls={<AppGlobalControls />}
			mobileSidebarTitle="Agent Activity"
			outerRail={
				<AppOuterRail
					account={account}
					initialState={input.initialSidebarStates?.outer}
				/>
			}
			sidebar={
				<AppInnerSidebar
					initialState={input.initialSidebarStates?.inner}
					preferenceKey="agent-activity"
					separatorLabel="Resize the Agent Activity sidebar"
				>
					<AgentActivitySidebar
						activeSectionId={input.activeSectionId}
						routes={input.routes}
					/>
				</AppInnerSidebar>
			}
		>
			<AppContextualContentFrame
				bodySlotName="agent-activity-content-scroll"
				contentClassName={APP_CONTEXTUAL_MAIN_TEXT_BASE_START_CLASS_NAME}
				headerSlotName="agent-activity-content-header"
			>
				<AgentActivityContent
					showSnapshotState={input.activeSectionId !== "sessions"}
				>
					{input.children}
				</AgentActivityContent>
			</AppContextualContentFrame>
		</AppSurfaceLayout>
	);
}

export function AgentActivityContent(input: {
	children: ReactNode;
	showSnapshotState?: boolean;
}) {
	const { currentOrganization } = useAppOrganization();
	return (
		<AgentActivityOrganizationContent
			isPersonal={currentOrganization.isPersonal === true}
			key={currentOrganization.id}
			organizationId={currentOrganization.id}
			organizationSlug={currentOrganization.slug}
			showSnapshotState={input.showSnapshotState ?? true}
		>
			{input.children}
		</AgentActivityOrganizationContent>
	);
}

function AgentActivityOrganizationContent(input: {
	children: ReactNode;
	isPersonal: boolean;
	organizationId: string;
	organizationSlug: string;
	showSnapshotState: boolean;
}) {
	return (
		<AgentActivityDataProvider organizationId={input.organizationId}>
			<div className="grid gap-5">
				<AgentActivityHeader
					isPersonal={input.isPersonal}
					organizationSlug={input.organizationSlug}
				/>
				{input.showSnapshotState ? <AgentActivitySnapshotState /> : null}
				{input.children}
			</div>
		</AgentActivityDataProvider>
	);
}

export function AgentActivityDataProvider(input: {
	children: ReactNode;
	organizationId: string;
	projectFilterMode?: "organization" | "url";
	statsEnabled?: boolean;
}) {
	const [urlProjectScopeId, setUrlProjectScopeId] = useQueryState(
		"project",
		agentActivityProjectScopeParser
	);
	const readsProjectFilterFromUrl = input.projectFilterMode !== "organization";
	const projectScopeId = readsProjectFilterFromUrl ? urlProjectScopeId : null;
	const projectsQuery = useQuery(
		projectsQueryOptions({ organizationId: input.organizationId })
	);
	const directoryQuery = useQuery(
		organizationDirectoryQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const snapshotQuery = useQuery(
		agentActivitySnapshotQueryOptions({
			includeProviderMetadata: true,
			organizationId: input.organizationId,
			...(projectScopeId ? { projectId: projectScopeId } : {}),
		})
	);
	const statsQuery = useQuery(
		agentActivityStatsQueryOptions({
			enabled: input.statsEnabled ?? true,
			organizationId: input.organizationId,
			...(projectScopeId ? { projectId: projectScopeId } : {}),
		})
	);
	useEffect(() => {
		if (
			readsProjectFilterFromUrl &&
			projectScopeId &&
			projectsQuery.isSuccess &&
			!projectsQuery.data.projects.some(
				(project) => project.id === projectScopeId
			)
		) {
			setUrlProjectScopeId(null).catch((error: unknown) => {
				console.error("Failed to clear Agent Activity Project scope.", error);
			});
		}
	}, [
		projectScopeId,
		projectsQuery.data?.projects,
		projectsQuery.isSuccess,
		readsProjectFilterFromUrl,
		setUrlProjectScopeId,
	]);
	const currentTimeMs = useCurrentTimeMs(snapshotQuery.data?.asOfMs);
	const projects = useMemo(
		() =>
			mergeActivityProjects(
				projectsQuery.data?.projects ?? [],
				snapshotQuery.data?.projects ?? []
			),
		[projectsQuery.data?.projects, snapshotQuery.data?.projects]
	);
	const membersByUserId = useMemo(
		() =>
			new Map(
				(directoryQuery.data?.members ?? []).map((member) => [
					member.user.id,
					{ image: member.user.image, name: member.user.name },
				])
			),
		[directoryQuery.data?.members]
	);
	const value = useMemo<AgentActivityDataContextValue>(
		() => ({
			currentTimeMs,
			directoryQuery,
			membersByUserId,
			organizationId: input.organizationId,
			projectScopeId,
			projects,
			projectsQuery,
			snapshotQuery,
			statsQuery,
			updateProjectScope: (nextProjectId) => {
				if (!readsProjectFilterFromUrl) {
					return;
				}
				setUrlProjectScopeId(nextProjectId).catch((error: unknown) => {
					console.error(
						"Failed to update Agent Activity Project scope.",
						error
					);
				});
			},
		}),
		[
			currentTimeMs,
			directoryQuery,
			input.organizationId,
			membersByUserId,
			projectScopeId,
			projects,
			projectsQuery,
			readsProjectFilterFromUrl,
			setUrlProjectScopeId,
			snapshotQuery,
			statsQuery,
		]
	);
	return (
		<AgentActivityDataContext.Provider value={value}>
			{input.children}
		</AgentActivityDataContext.Provider>
	);
}

export function useAgentActivityData() {
	const context = useContext(AgentActivityDataContext);
	if (!context) {
		throw new Error(
			"Agent Activity pages must be rendered inside AgentActivityDataProvider."
		);
	}
	return context;
}

export function useAgentActivityView(
	filters: Omit<ActivityViewFilters, "projectId">,
	windowMs: number
): ActivityView | null {
	const data = useAgentActivityData();
	return useMemo(
		() =>
			buildActivityView({
				currentTimeMs: data.currentTimeMs,
				filters: { ...filters, projectId: data.projectScopeId },
				membersByUserId: data.membersByUserId,
				projects: data.projects,
				snapshot: data.snapshotQuery.data,
				windowMs,
			}),
		[
			data.currentTimeMs,
			data.membersByUserId,
			data.projects,
			data.projectScopeId,
			data.snapshotQuery.data,
			filters,
			windowMs,
		]
	);
}

export function AgentActivitySidebar(input: {
	activeSectionId: AgentActivitySectionId;
	routes: AgentActivityRoutes;
}) {
	const groups = [
		{
			ariaLabel: "Monitor Agent Activity sections",
			id: "monitor",
			items: [
				{
					icon: ChartBarIcon,
					id: "overview",
					label: "Overview",
					preserveSearch: true,
					to: input.routes.overview,
				},
				{
					icon: ListBulletsIcon,
					id: "sessions",
					label: "Sessions",
					preserveSearch: true,
					to: input.routes.sessions,
				},
				{
					icon: ClockCounterClockwiseIcon,
					id: "changes",
					label: "Changes",
					preserveSearch: true,
					to: input.routes.changes,
				},
			],
			label: "Monitor",
		},
	] as const satisfies readonly AppContextualNavGroup<AgentActivitySectionId>[];

	return (
		<AppContextualSidebarNav
			activeItemId={input.activeSectionId}
			ariaLabel="Agent Activity"
			groups={groups}
			title="Agent Activity"
		/>
	);
}

function AgentActivityHeader(input: {
	isPersonal: boolean;
	organizationSlug: string;
}) {
	return (
		<header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
			<div className="min-w-0 flex-1">
				<p className="font-medium text-muted-foreground text-xs">
					{input.isPersonal ? "Personal workspace" : "Organization"}
				</p>
				<h1 className="font-medium text-2xl text-foreground">Agent Activity</h1>
				<p className="mt-1 flex max-w-3xl items-start gap-1.5 text-muted-foreground text-xs leading-5">
					<ShieldCheckIcon
						aria-hidden="true"
						className={cn(
							"mt-0.5 size-3.5 shrink-0",
							resolveStatusToneIconClassName("ready", "quiet")
						)}
					/>
					<span>
						What OpenMeld shares: session titles and reviewed metadata—not
						prompts, replies, transcripts, files, or local paths.
					</span>
				</p>
			</div>
			<div className="flex w-full shrink-0 flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-end">
				<Link
					className={buttonVariants({ variant: "outline" })}
					to={buildOrganizationProjectsPath(input.organizationSlug)}
				>
					<FolderOpenIcon aria-hidden="true" /> Manage Projects
				</Link>
				<AgentActivityProjectScope />
			</div>
		</header>
	);
}

function AgentActivityProjectScope() {
	const data = useAgentActivityData();
	const activeProjects = data.projectsQuery.data?.projects ?? [];
	const selectedProject = data.projectScopeId
		? activeProjects.find((project) => project.id === data.projectScopeId)
		: null;
	return (
		<div className="grid w-full min-w-0 gap-1 text-muted-foreground text-xs sm:w-auto sm:min-w-44">
			<span>Project scope</span>
			<Select
				disabled={data.projectsQuery.isPending}
				onValueChange={(value) =>
					data.updateProjectScope(value === ALL_PROJECTS_VALUE ? null : value)
				}
				value={data.projectScopeId ?? ALL_PROJECTS_VALUE}
			>
				<SelectTrigger
					aria-label="Project scope"
					className="h-8 rounded-md"
					displayValue={
						selectedProject?.name ??
						(data.projectScopeId ? "Selected Project" : "All Projects")
					}
				/>
				<SelectContent align="end">
					<SelectItem index={0} value={ALL_PROJECTS_VALUE}>
						All Projects
					</SelectItem>
					{activeProjects.map((project, index) => (
						<SelectItem index={index + 1} key={project.id} value={project.id}>
							{project.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function AgentActivitySnapshotState() {
	const data = useAgentActivityData();
	const view = useAgentActivityView(
		{ provider: null, status: null },
		DEFAULT_WINDOW_MS
	);
	return (
		<>
			{data.projectsQuery.isError ? (
				<div
					className={cn(
						"flex flex-wrap items-center justify-between gap-3 rounded-md border p-3",
						resolveStatusToneSurfaceClassName("warning", "subtle")
					)}
					role="alert"
				>
					<p className={resolveStatusToneStrongTextClassName("warning")}>
						OpenMeld could not load current Project names. Activity may show
						unknown Projects.
					</p>
					<Button
						onClick={() => data.projectsQuery.refetch()}
						size="sm"
						variant="outline"
					>
						<ArrowClockwiseIcon aria-hidden="true" /> Retry Projects
					</Button>
				</div>
			) : null}
			{data.snapshotQuery.isPending && data.projects.length > 0 ? (
				<p aria-live="polite" className="text-muted-foreground text-sm">
					Loading agent activity…
				</p>
			) : null}
			{data.snapshotQuery.isError ? (
				<div
					className={cn(
						"flex flex-wrap items-center justify-between gap-3 rounded-md border p-3",
						resolveStatusToneSurfaceClassName("danger", "subtle")
					)}
					role="alert"
				>
					<p className={resolveStatusToneStrongTextClassName("danger")}>
						OpenMeld could not refresh current agent activity. You can still
						manage Projects.
					</p>
					<Button
						onClick={() => data.snapshotQuery.refetch()}
						size="sm"
						variant="outline"
					>
						<ArrowClockwiseIcon aria-hidden="true" /> Retry activity
					</Button>
				</div>
			) : null}
			{view?.freshness.isStale ? (
				<output
					className={cn(
						"rounded-md border px-3 py-2 text-xs",
						resolveStatusToneOpaqueWarningSurfaceClassName()
					)}
				>
					Activity data may be stale. OpenMeld will keep trying to refresh it.
				</output>
			) : null}
		</>
	);
}

function useCurrentTimeMs(fallbackMs: number | undefined) {
	const [currentTimeMs, setCurrentTimeMs] = useState(() => fallbackMs ?? 0);
	useEffect(() => {
		const updateCurrentTime = () => setCurrentTimeMs(Date.now());
		updateCurrentTime();
		const interval = setInterval(updateCurrentTime, 15_000);
		return () => clearInterval(interval);
	}, []);
	return currentTimeMs;
}

function mergeActivityProjects(
	activeProjects: Project[],
	snapshotProjects: Project[]
) {
	const projects = new Map(
		activeProjects.map((project) => [project.id, project] as const)
	);
	for (const project of snapshotProjects) {
		projects.set(project.id, project);
	}
	return [...projects.values()];
}

function buildActivityView(input: {
	currentTimeMs: number;
	filters: ActivityViewFilters;
	membersByUserId: ReadonlyMap<string, ActivityMember>;
	projects: Project[];
	snapshot: AgentActivitySnapshotResponse | undefined;
	windowMs: number;
}): ActivityView | null {
	if (!input.snapshot) {
		return null;
	}
	return deriveActivityView({
		filters: input.filters,
		membersByUserId: input.membersByUserId,
		nowMs: input.currentTimeMs,
		snapshot: {
			...input.snapshot,
			projects: input.projects,
		},
		windowMs: input.windowMs,
	});
}
