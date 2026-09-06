"use client";

import type { AgentProfileOperationalContextInput } from "@openmeld/agent-profile";
import type {
	AuthProfileView,
	GetAgentExecutionReadinessResponse,
	ModelCatalog,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { ArrowLeftIcon, PlusIcon, RobotIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import {
	type AgentProfileSidebarGroup,
	resolveAgentProfileSidebarGroups,
} from "#/components/agents/agent-profile-sidebar-groups";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";
import { ManagedAgentSidebar } from "./managed-agent-sidebar";

const AGENT_REQUESTS_DESCRIPTION =
	"Approve requests for Agents you’re being asked to own, and track requests you sent.";

export type AgentProfilesWorkspaceProps = {
	activeView: "agents" | "requests";
	agentControllerRefByProfileId?: ReadonlyMap<string, string | null>;
	currentUserId: string;
	filterControl?: ReactNode;
	filterBadges?: ReactNode;
	hasAnyProfiles?: boolean;
	isSearchActive?: boolean;
	initialSidebarStates?: AppSidebarPersistedStates;
	onCreateAgent: () => void;
	onSelectProfile: (profileId: string) => void;
	onViewChange: (view: "agents" | "requests") => void;
	pendingRequestCount: number;
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
	searchControl?: ReactNode;
	selectedProfileId: string | null;
	showAgentRequests?: boolean;
};

export function AgentProfilesWorkspace(input: AgentProfilesWorkspaceProps) {
	const groups = resolveAgentProfileSidebarGroups({
		currentUserId: input.currentUserId,
		operationalContextByProfileId: input.operationalContextByProfileId,
		profiles: input.profiles,
	});
	if (input.profilesStatus === "ready") {
		return (
			<ReadyAgentProfilesWorkspace
				groups={groups}
				input={input}
				key={input.profiles.length > 0 ? "has-profiles" : "no-profiles"}
			/>
		);
	}
	return (
		<AgentProfilesWorkspaceFrame
			groups={groups}
			implicitSelectedProfileId={null}
			input={input}
		/>
	);
}

function ReadyAgentProfilesWorkspace(input: {
	groups: readonly AgentProfileSidebarGroup[];
	input: AgentProfilesWorkspaceProps;
}) {
	const [implicitSelectedProfileId] = useState(
		() =>
			input.groups.flatMap((group) => group.profiles)[0]?.openMeldProfileId ??
			null
	);
	return (
		<AgentProfilesWorkspaceFrame
			groups={input.groups}
			implicitSelectedProfileId={implicitSelectedProfileId}
			input={input.input}
		/>
	);
}

function AgentProfilesWorkspaceFrame(input: {
	groups: readonly AgentProfileSidebarGroup[];
	implicitSelectedProfileId: string | null;
	input: AgentProfilesWorkspaceProps;
}) {
	const workspaceInput = input.input;
	const orderedProfiles = input.groups.flatMap((group) => group.profiles);
	const retainedImplicitProfileId = orderedProfiles.some(
		(profile) => profile.openMeldProfileId === input.implicitSelectedProfileId
	)
		? input.implicitSelectedProfileId
		: (orderedProfiles[0]?.openMeldProfileId ?? null);
	const requestedProfileId =
		workspaceInput.selectedProfileId ?? retainedImplicitProfileId;
	const selectedProfile = requestedProfileId
		? (orderedProfiles.find(
				(profile) => profile.openMeldProfileId === requestedProfileId
			) ?? null)
		: (orderedProfiles[0] ?? null);
	const selectionMissing =
		workspaceInput.selectedProfileId !== null && selectedProfile === null;
	const activeProfileId =
		workspaceInput.activeView === "agents"
			? (selectedProfile?.openMeldProfileId ?? null)
			: null;
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			initialOuterSidebarState={workspaceInput.initialSidebarStates?.outer}
			mainSidebarContent={
				<ManagedAgentSidebar
					activeProfileId={activeProfileId}
					groups={input.groups}
					input={workspaceInput}
				/>
			}
			showMainHeader={
				orderedProfiles.length > 0 || workspaceInput.activeView === "requests"
			}
		>
			<AgentProfilesWorkspaceContent
				input={workspaceInput}
				selectedProfile={selectedProfile}
				selectionMissing={selectionMissing}
			/>
		</AppFullWidthLayout>
	);
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
		return (
			<output className="grid min-h-full place-items-center px-6 py-12 text-center text-muted-foreground text-sm">
				Loading Agents…
			</output>
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
	if (input.selectedProfile) {
		return input.input.renderProfileDetail(input.selectedProfile);
	}
	return (
		<>
			{profilesController}
			<AgentProfilesWorkspaceEmptyState input={input.input} />
		</>
	);
}

function AgentRequestsWorkspace(input: { input: AgentProfilesWorkspaceProps }) {
	return (
		<div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
			<header className="space-y-1">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="min-w-0">
						<h1 className="font-semibold text-xl">Agent requests</h1>
						<p className="mt-1 max-w-2xl text-muted-foreground text-sm leading-6">
							{AGENT_REQUESTS_DESCRIPTION}
						</p>
					</div>
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
			</header>
			{input.input.requestPanel}
		</div>
	);
}

function AgentProfilesWorkspaceEmptyState(input: {
	input: AgentProfilesWorkspaceProps;
}) {
	const isFiltered = input.input.hasAnyProfiles === true;
	const isSearchActive = input.input.isSearchActive === true;
	if (!(isSearchActive || isFiltered)) {
		return (
			<div className="grid min-h-full flex-1 place-items-center px-6 py-12 sm:px-10">
				<div className="flex w-full max-w-md flex-col items-center text-center">
					<RobotIcon
						aria-hidden="true"
						className="mb-5 size-8 text-muted-foreground"
					/>
					<h1 className="font-medium text-xl">Bring your AI into Spaces</h1>
					<p className="mt-3 text-muted-foreground text-sm leading-6">
						Create an Agent profile for Codex, Claude Code, or another AI
						running on a computer. Give it work in Spaces and see its replies
						alongside your team’s.
					</p>
					<p className="mt-3 text-muted-foreground text-sm leading-6">
						Use your own computer or a teammate’s, with their permission.
					</p>
					<Button
						className="mt-6"
						data-testid="create-agent-empty-state"
						onClick={input.input.onCreateAgent}
						type="button"
					>
						<PlusIcon aria-hidden="true" data-icon="inline-start" />
						Create Agent
					</Button>
				</div>
			</div>
		);
	}

	let title = "No Agents match this filter";
	let description =
		"Choose another Wake availability filter to see more Agents.";
	if (isSearchActive) {
		title = "No Agents found";
		description = "Try another name, owner, Controller, or model.";
	}
	return (
		<div className="grid min-h-full place-items-center px-6 py-12 text-center">
			<div className="max-w-sm space-y-2">
				<h1 className="font-medium text-base">{title}</h1>
				<p className="text-muted-foreground text-sm">{description}</p>
			</div>
		</div>
	);
}
