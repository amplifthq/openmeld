"use client";

import type { AgentProfileOperationalContextInput } from "@openmeld/agent-profile";
import type {
	AuthProfileView,
	GetAgentExecutionReadinessResponse,
	ModelCatalog,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { FluidNavMenu } from "@openmeld/ui/fluid/nav-menu";
import { ArrowLeftIcon, PlusIcon, RobotIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";
import { AgentProfileSidebarItem } from "./agent-profile-sidebar-item";

const AGENT_REQUESTS_DESCRIPTION =
	"Approve requests for Agents you’re being asked to own, and track requests you sent.";

export type AgentProfilesWorkspaceProps = {
	canCreateAgent?: boolean;
	person?: { id: string; name: string; path: string; agentsPath: string };
	activeView: "agents" | "requests";
	agentControllerRefByProfileId?: ReadonlyMap<string, string | null>;
	currentUserId: string;
	isOrganizationContext?: boolean;
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
			initialOuterSidebarState={workspaceInput.initialSidebarStates?.outer}
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
		<div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
			{profilesController}
			<div className="flex items-center gap-2">
				<div className="max-w-sm flex-1">{input.input.searchControl}</div>
				{input.input.filterControl}
			</div>
			{input.input.filterBadges}
			{input.input.profiles.length > 0 ? (
				<FluidNavMenu
					activeValue={null}
					aria-label="Agents"
					className="[&_[data-sidebar=menu]]:grid [&_[data-sidebar=menu]]:gap-3 [&_[data-sidebar=menu]]:sm:grid-cols-2"
				>
					{input.input.profiles.map((profile, index) => (
						<AgentProfileSidebarItem
							agentControllerRef={
								input.input.agentControllerRefByProfileId?.get(
									profile.openMeldProfileId
								) ?? null
							}
							currentUserId={input.input.currentUserId}
							index={index}
							isActive={false}
							key={profile.openMeldProfileId}
							modelCatalog={input.input.modelCatalog ?? null}
							onSelectProfile={input.input.onSelectProfile}
							operationalContext={
								input.input.operationalContextByProfileId?.get(
									profile.openMeldProfileId
								) ?? null
							}
							profile={profile}
							readiness={
								input.input.readinessByProfileId.get(
									profile.openMeldProfileId
								) ?? null
							}
							readinessErrorMessage={
								input.input.readinessErrorByProfileId?.get(
									profile.openMeldProfileId
								) ?? null
							}
							readinessIsPending={
								input.input.readinessPendingProfileIds?.has(
									profile.openMeldProfileId
								) ?? false
							}
							variant="card"
						/>
					))}
				</FluidNavMenu>
			) : (
				<AgentProfilesWorkspaceEmptyState input={input.input} />
			)}
		</div>
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
						Back to Team
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
		if (input.input.canCreateAgent === false) {
			return (
				<div className="py-12 text-center text-muted-foreground text-sm">
					No Agents yet.
				</div>
			);
		}
		return (
			<div className="grid min-h-full flex-1 place-items-center px-6 py-12 sm:px-10">
				<div className="flex w-full max-w-md flex-col items-center text-center">
					<RobotIcon
						aria-hidden="true"
						className="mb-5 size-8 text-muted-foreground"
					/>
					<h1 className="font-medium text-xl">
						{input.input.isOrganizationContext
							? "Bring your AI to your team"
							: "Bring your AI to your workspace"}
					</h1>
					<p className="mt-3 text-muted-foreground text-sm leading-6">
						Create an Agent profile for Codex, Claude Code, or another AI
						running on a computer.{" "}
						{input.input.isOrganizationContext
							? "Work with it alongside your teammates in Spaces, or chat with it directly."
							: "Chat with it directly or give it work in Spaces."}
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
		description = "Try another name, Controller, or model.";
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

function AgentWorkspaceHeader(input: AgentProfilesWorkspaceProps) {
	return (
		<>
			{input.person ? (
				<div className="mx-auto w-full max-w-5xl px-4 pt-5 sm:px-6 lg:px-8">
					<Link
						className="inline-flex items-center gap-2 text-muted-foreground text-sm hover:text-foreground"
						to={
							input.selectedProfileId
								? input.person.agentsPath
								: input.person.path
						}
					>
						<ArrowLeftIcon aria-hidden="true" />
						{input.selectedProfileId
							? `${input.person.name}’s Agents`
							: input.person.name}
					</Link>
					{!input.selectedProfileId && input.activeView === "agents" ? (
						<header className="mt-5 flex flex-wrap items-center justify-between gap-3">
							<h1 className="font-medium text-xl">
								{input.person.name}’s Agents
							</h1>
							<div className="flex items-center gap-2">
								{input.isOrganizationContext ? (
									<Button
										onClick={() => input.onViewChange("requests")}
										variant="ghost"
									>
										Agent requests
										{input.pendingRequestCount > 0
											? ` (${input.pendingRequestCount})`
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
			) : null}
		</>
	);
}
