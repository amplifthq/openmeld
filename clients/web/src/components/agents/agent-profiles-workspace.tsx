"use client";

import type { AgentProfileOperationalContextInput } from "@openmeld/agent-profile";
import type {
	AgentProfileCreationRequest,
	AuthProfileView,
	GetAgentExecutionReadinessResponse,
	ModelCatalog,
	OrganizationAgentRuntimeOverviewResponse,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { ArrowLeftIcon, PlusIcon, RobotIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppContextualSidebarNav } from "#/components/app/app-contextual-layout";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { SidebarListSkeleton } from "#/components/app/sidebar-list-skeleton";
import { TeamHeader } from "#/components/directory/team-header";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationAgentsPath } from "#/lib/organizations/organization-routes";
import type { OptimisticAgentProfileCreation } from "#/lib/profiles/agent-profile-creation-requests";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";
import { AgentDirectoryLists } from "./agent-directory-lists";
import {
	AgentDetailSkeleton,
	AgentListSkeleton,
} from "./agent-profile-skeleton";

const AGENT_REQUESTS_DESCRIPTION =
	"Review Agents you created and finish any setup that needs attention.";

export type AgentProfilesWorkspaceProps = {
	agentListReturn?: { to: string; label: string };
	onDeleteProfiles?: import("./agent-list-selection").DeleteAgents;
	directoryProfiles?: OrganizationProfileDirectoryResponse["agentProfiles"];
	taskActivityAvailable?: boolean;
	members?: OrganizationProfileDirectoryResponse["members"];
	lastTaskActivityByProfileId?: ReadonlyMap<string, string | null>;
	canCreateAgent?: boolean;
	creationRequests?: readonly (
		| AgentProfileCreationRequest
		| OptimisticAgentProfileCreation
	)[];
	person?: { id: string; name: string; path: string; agentsPath: string };
	activeView: "agents" | "requests";
	agentControllerRefByProfileId?: ReadonlyMap<string, string | null>;
	currentUserId: string;
	isOrganizationContext?: boolean;
	hasAnyProfiles?: boolean;
	initialSidebarStates?: AppSidebarPersistedStates;
	onCreateAgent: () => void;
	onOpenCreationRequest?: (requestId: string) => void;
	onDismissCreation?: (requestId: string) => void;
	onSelectProfile: (profileId: string) => void;
	onViewChange: (view: "agents" | "requests") => void;
	creationAttentionCount: number;
	profiles: readonly AuthProfileView[];
	profilesErrorMessage?: string;
	profilesStatus?: "error" | "loading" | "ready";
	modelCatalog?: ModelCatalog | null;
	operationalContextByProfileId?: ReadonlyMap<
		string,
		AgentProfileOperationalContextInput
	>;
	readinessByProfileId: ReadonlyMap<string, GetAgentExecutionReadinessResponse>;
	readinessErrorByProfileId?: ReadonlyMap<string, string>;
	readinessPendingProfileIds?: ReadonlySet<string>;
	renderProfilesController: () => ReactNode;
	renderProfileDetail: (profile: AuthProfileView) => ReactNode;
	requestPanel: ReactNode;
	selectedProfileId: string | null;
	showAgentRequests?: boolean;
	/** Per-Profile runtime reads that MemberAgent presence aggregates. */
	runtimeOverviewByProfileId?: ReadonlyMap<
		string,
		OrganizationAgentRuntimeOverviewResponse["agentProfiles"][number]
	>;
	/** Opens a MemberAgent's page; present only with MEMBER_AGENTS_ENABLED. */
	onOpenMemberAgent?: (memberAgentId: string) => void;
	selectedMemberAgentId?: string | null;
	/** A MemberAgent's page is one of its Profiles' pages. */
	renderMemberAgentDetail?: (
		memberAgentId: string,
		renderProfile: (profile: AuthProfileView) => ReactNode
	) => ReactNode;
	/** The open Agent's Profiles and chats, on its Profile pages too. */
	memberAgentSidebar?: ReactNode;
};

export function AgentProfilesWorkspace(input: AgentProfilesWorkspaceProps) {
	const workspaceInput = input;
	const selectedProfile =
		input.profiles.find(
			(profile) => profile.openMeldProfileId === input.selectedProfileId
		) ?? null;
	const selectionMissing =
		workspaceInput.selectedProfileId !== null && selectedProfile === null;
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			defaultModuleSidebarOpen={
				!!input.selectedProfileId || !!input.selectedMemberAgentId
			}
			initialOuterSidebarState={workspaceInput.initialSidebarStates?.outer}
			mainHeader={
				!input.person &&
				input.activeView === "agents" &&
				!input.selectedMemberAgentId ? (
					<TeamHeader
						actions={
							<Button onClick={input.onCreateAgent} size="sm">
								<PlusIcon />
								Create Agent
							</Button>
						}
						active="agents"
					/>
				) : undefined
			}
			mainSidebar={resolveAgentsMainSidebar(input)}
			showMainHeader={
				!(input.person || input.selectedMemberAgentId) &&
				input.activeView === "agents"
			}
		>
			<AgentWorkspaceHeader {...input} />
			<AgentProfilesWorkspaceContent
				input={workspaceInput}
				selectedProfile={selectedProfile}
				selectionMissing={selectionMissing}
			/>
		</AppFullWidthLayout>
	);
}

function resolveAgentsMainSidebar(input: AgentProfilesWorkspaceProps) {
	if (input.memberAgentSidebar) {
		return {
			key: "member-agent",
			label: "Chats",
			content: input.memberAgentSidebar,
		};
	}
	return input.selectedProfileId
		? {
				key: "agents",
				label: "Agents",
				content: (
					<AppContextualSidebarNav
						activeItemId={input.selectedProfileId}
						ariaLabel="Agents"
						groups={[
							{
								id: "agents",
								label: input.person
									? `${input.person.name}’s Agents`
									: "Agents",
								ariaLabel: "Agent list",
								items: input.profiles.map((profile) => ({
									id: profile.openMeldProfileId,
									label: profile.profileName,
									icon: RobotIcon,
								})),
							},
						]}
						leadingContent={
							input.profilesStatus === "loading" &&
							input.profiles.length === 0 ? (
								<SidebarListSkeleton label="Loading Agent list" />
							) : null
						}
						onActivate={input.onSelectProfile}
						placement="module"
						title="Agents"
					/>
				),
			}
		: undefined;
}

function AgentProfilesWorkspaceContent(input: {
	input: AgentProfilesWorkspaceProps;
	selectionMissing: boolean;
	selectedProfile: AuthProfileView | null;
}) {
	if (input.input.activeView === "requests") {
		return <AgentRequestsWorkspace input={input.input} />;
	}
	if (input.input.profilesStatus === "loading") {
		return input.input.selectedProfileId ? (
			<AgentDetailSkeleton />
		) : (
			<AgentListSkeleton />
		);
	}
	if (input.input.profilesStatus === "error") {
		return (
			<div className="grid min-h-full place-items-center px-6 py-12 text-center">
				<div className="max-w-md space-y-2" role="alert">
					<h1 className="font-medium text-base">Couldn’t load Agents</h1>
					<p className="text-destructive text-sm">
						{input.input.profilesErrorMessage ??
							"OpenMeld couldn’t load this Agent list. Try again."}
					</p>
				</div>
			</div>
		);
	}
	const profilesController =
		(input.input.hasAnyProfiles ?? input.input.profiles.length > 0)
			? input.input.renderProfilesController()
			: null;
	if (input.selectionMissing) {
		return (
			<>
				{profilesController}
				<div className="grid min-h-full place-items-center px-6 py-12 text-center">
					<div className="max-w-md space-y-2">
						<h1 className="font-medium text-base">Agent not found</h1>
						<p className="text-muted-foreground text-sm">
							This Agent no longer exists, or it isn’t available in this
							Organization.
						</p>
					</div>
				</div>
			</>
		);
	}
	if (
		input.input.selectedMemberAgentId &&
		input.input.renderMemberAgentDetail
	) {
		return input.input.renderMemberAgentDetail(
			input.input.selectedMemberAgentId,
			input.input.renderProfileDetail
		);
	}
	if (input.selectedProfile) {
		return input.input.renderProfileDetail(input.selectedProfile);
	}
	return (
		<div className="w-full space-y-4 px-[var(--app-page-inline-padding)] pb-8">
			{profilesController}
			<AgentDirectoryLists input={input.input} />
		</div>
	);
}

function AgentRequestsWorkspace(input: { input: AgentProfilesWorkspaceProps }) {
	return (
		<div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
			<header className="space-y-4">
				<div>
					<Button
						onClick={() => input.input.onViewChange("agents")}
						size="sm"
						type="button"
						variant="outline"
					>
						<ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
						Back to Agents
					</Button>
				</div>
				<div className="min-w-0">
					<h1 className="font-semibold text-xl">Agent creation history</h1>
					<p className="mt-1 max-w-2xl text-muted-foreground text-sm leading-6">
						{AGENT_REQUESTS_DESCRIPTION}
					</p>
				</div>
			</header>
			{input.input.requestPanel}
		</div>
	);
}

function AgentsListBackLink() {
	const { currentOrganization } = useAppOrganization();
	return (
		<div className="w-full px-[var(--app-page-inline-padding)] pt-5">
			<Link
				className="inline-flex items-center gap-2 text-muted-foreground text-sm hover:text-foreground"
				to={buildOrganizationAgentsPath(currentOrganization.slug)}
			>
				<ArrowLeftIcon aria-hidden="true" />
				Back to Agents
			</Link>
		</div>
	);
}

function AgentWorkspaceHeader(input: AgentProfilesWorkspaceProps) {
	if (!input.person) {
		return input.selectedMemberAgentId ? <AgentsListBackLink /> : null;
	}
	const returnLink =
		input.agentListReturn ??
		(input.selectedProfileId
			? { to: input.person.agentsPath, label: `${input.person.name}’s Agents` }
			: { to: input.person.path, label: input.person.name });
	return (
		<div className="w-full px-[var(--app-page-inline-padding)] pt-5">
			<Link
				className="inline-flex items-center gap-2 text-muted-foreground text-sm hover:text-foreground"
				to={returnLink.to}
			>
				<ArrowLeftIcon aria-hidden="true" />
				{returnLink.label}
			</Link>
			{!input.selectedProfileId && input.activeView === "agents" ? (
				<header className="mt-5 flex flex-wrap items-center justify-between gap-3">
					<h1 className="font-medium text-xl">{input.person.name}’s Agents</h1>
					<div className="flex items-center gap-2">
						{input.isOrganizationContext && input.canCreateAgent !== false ? (
							<Button
								onClick={() => input.onViewChange("requests")}
								size="sm"
								variant="secondary"
							>
								Creation history
								{input.creationAttentionCount > 0
									? ` · Needs attention: ${input.creationAttentionCount}`
									: ""}
							</Button>
						) : null}
						{input.canCreateAgent !== false && input.hasAnyProfiles ? (
							<Button onClick={input.onCreateAgent} size="sm">
								<PlusIcon aria-hidden="true" />
								Create Agent
							</Button>
						) : null}
					</div>
				</header>
			) : null}
		</div>
	);
}
