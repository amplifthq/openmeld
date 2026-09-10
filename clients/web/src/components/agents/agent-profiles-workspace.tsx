"use client";

import type { AgentProfileOperationalContextInput } from "@openmeld/agent-profile";
import type {
	AuthProfileView,
	GetAgentExecutionReadinessResponse,
	ModelCatalog,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { ArrowLeftIcon, PlusIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { TeamHeader } from "#/components/directory/team-header";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";
import { AgentDirectoryLists } from "./agent-directory-lists";

const AGENT_REQUESTS_DESCRIPTION =
	"Track Agent creation and finish any remaining setup.";

export type AgentProfilesWorkspaceProps = {
	directoryProfiles?: OrganizationProfileDirectoryResponse["agentProfiles"];
	taskActivityAvailable?: boolean;
	members?: OrganizationProfileDirectoryResponse["members"];
	lastTaskActivityByProfileId?: ReadonlyMap<string, string | null>;
	canCreateAgent?: boolean;
	person?: { id: string; name: string; path: string; agentsPath: string };
	activeView: "agents" | "requests";
	agentControllerRefByProfileId?: ReadonlyMap<string, string | null>;
	currentUserId: string;
	isOrganizationContext?: boolean;
	hasAnyProfiles?: boolean;
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
			mainHeader={
				!input.person && input.activeView === "agents" ? (
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
			showMainHeader={!input.person && input.activeView === "agents"}
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
		<div className="w-full space-y-4 px-[var(--app-page-inline-padding)] pb-8">
			{profilesController}
			<AgentDirectoryLists input={input.input} />
			{input.input.person &&
				input.input.canCreateAgent !== false &&
				input.input.isOrganizationContext && (
					<Button
						onClick={() => input.input.onViewChange("requests")}
						size="sm"
						variant="ghost"
					>
						Setup history
					</Button>
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
						<h1 className="font-semibold text-xl">Agent setup</h1>
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

function AgentWorkspaceHeader(input: AgentProfilesWorkspaceProps) {
	return (
		<>
			{input.person ? (
				<div className="w-full px-[var(--app-page-inline-padding)] pt-5">
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
								{input.isOrganizationContext &&
								input.canCreateAgent !== false &&
								input.pendingRequestCount > 0 ? (
									<Button
										onClick={() => input.onViewChange("requests")}
										variant="ghost"
									>
										Finish setup
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
