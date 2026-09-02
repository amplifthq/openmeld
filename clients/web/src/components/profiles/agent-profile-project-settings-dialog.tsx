"use client";

import type {
	AuthProfileView,
	LocalProjectControlConnection,
	Project,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { RadioGroup, RadioItem } from "@openmeld/ui/fluid/radio-group";
import { cn } from "@openmeld/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useReducer } from "react";
import { toast } from "sonner";
import { clearPendingAgentProfileCreationLocalSetupForProfile } from "#/lib/profiles/agent-profile-creation-local-setup";
import { updateAgentProfileDefaultProject } from "#/lib/profiles/update-default-project";
import { updateAgentProfileWorkspace } from "#/lib/profiles/update-profile-workspace";
import { projectsQueryOptions } from "#/query/organizations/projects";
import { AgentProfileProjectSelector } from "./agent-profile-project-selector";
import {
	FUTURE_WAKES_PROJECT_SETTINGS_NOTICE,
	shouldShowAgentProfileProjectSettings,
} from "./agent-profile-project-settings";

type ProjectSelectionMode = "managed" | "project" | "workspace" | null;

type ProjectSettingsDialogState = {
	errorMessage: string | null;
	pendingAction: string | null;
	selectedBindingGeneration: string | null;
	selectedConnection: LocalProjectControlConnection | null;
	selectedProjectId: string;
	selectionMode: ProjectSelectionMode;
	workspacePath: string;
};

function reduceProjectSettingsDialogState(
	state: ProjectSettingsDialogState,
	patch: Partial<ProjectSettingsDialogState>
): ProjectSettingsDialogState {
	return { ...state, ...patch };
}

export function AgentProfileProjectSettingsDialog(input: {
	actorProfileId: string | null;
	agentControllerRef: string | null;
	executionTargetChangeEligibilityStatus: "allowed" | "blocked" | "unavailable";
	currentWorkingFolder: string | null;
	onOpenChange: (open: boolean) => void;
	onProfileUpdated: (profile: AuthProfileView) => void;
	open: boolean;
	organizationId: string;
	profile: AuthProfileView;
}) {
	if (
		!shouldShowAgentProfileProjectSettings({
			agentControllerRef: input.agentControllerRef,
			managedRole: input.profile.managedRole,
		})
	) {
		return null;
	}
	return (
		<LocalAgentProfileProjectSettingsDialog
			{...input}
			key={`${input.profile.openMeldProfileId}:${input.open}:${input.profile.defaultProjectId ?? "managed"}:${input.currentWorkingFolder ?? "unknown"}`}
		/>
	);
}

function LocalAgentProfileProjectSettingsDialog(input: {
	actorProfileId: string | null;
	agentControllerRef: string | null;
	executionTargetChangeEligibilityStatus: "allowed" | "blocked" | "unavailable";
	currentWorkingFolder: string | null;
	onOpenChange: (open: boolean) => void;
	onProfileUpdated: (profile: AuthProfileView) => void;
	open: boolean;
	organizationId: string;
	profile: AuthProfileView;
}) {
	const projectsQuery = useQuery(
		projectsQueryOptions({ organizationId: input.organizationId })
	);
	const projects = projectsQuery.data?.projects ?? [];
	const defaultProjectId = input.profile.defaultProjectId ?? null;
	const defaultProject = projects.find(
		(project) => project.id === defaultProjectId
	);
	const currentMode = resolveCurrentMode({
		currentWorkingFolder: input.currentWorkingFolder,
		defaultProjectId,
	});
	const [state, updateState] = useReducer(reduceProjectSettingsDialogState, {
		errorMessage: null,
		pendingAction: null,
		selectedBindingGeneration: null,
		selectedConnection: null,
		selectedProjectId: defaultProjectId ?? "",
		selectionMode: null,
		workspacePath:
			currentMode === "workspace" ? (input.currentWorkingFolder ?? "") : "",
	});
	const {
		errorMessage,
		pendingAction,
		selectedBindingGeneration,
		selectedConnection,
		selectedProjectId,
		selectionMode,
		workspacePath,
	} = state;
	const setSelectionMode = (selectionMode: ProjectSelectionMode) =>
		updateState({ selectionMode });
	const setSelectedProjectId = (selectedProjectId: string) =>
		updateState({ selectedProjectId });
	const setSelectedBindingGeneration = (
		selectedBindingGeneration: string | null
	) => updateState({ selectedBindingGeneration });
	const setSelectedConnection = (
		selectedConnection: LocalProjectControlConnection | null
	) => updateState({ selectedConnection });
	const setWorkspacePath = (workspacePath: string) =>
		updateState({ workspacePath });
	const setPendingAction = (pendingAction: string | null) =>
		updateState({ pendingAction });
	const setErrorMessage = (errorMessage: string | null) =>
		updateState({ errorMessage });
	const closeDialog = () => {
		setSelectionMode(null);
		setSelectedProjectId(defaultProjectId ?? "");
		setSelectedBindingGeneration(null);
		setSelectedConnection(null);
		setWorkspacePath(
			currentMode === "workspace" ? (input.currentWorkingFolder ?? "") : ""
		);
		setErrorMessage(null);
		input.onOpenChange(false);
	};
	const applyConnection = async (connection: LocalProjectControlConnection) => {
		setPendingAction("connection");
		setErrorMessage(null);
		try {
			await updateAgentProfileWorkspace({
				actorProfileId: input.actorProfileId,
				organizationId: input.organizationId,
				profileId: input.profile.openMeldProfileId,
				workspaceMode: "custom",
				workspacePath: connection.path,
			});
			clearPendingAgentProfileCreationLocalSetupForProfile(
				input.profile.openMeldProfileId
			);
			const updatedProfile = await updateAgentProfileDefaultProject({
				actorProfileId: input.actorProfileId,
				defaultProjectId: selectedProjectId,
				organizationId: input.organizationId,
				profileId: input.profile.openMeldProfileId,
			});
			input.onProfileUpdated(updatedProfile);
			toast.success("Default Project and working folder updated.");
			closeDialog();
		} catch (error) {
			setErrorMessage(formatProjectSettingsError(error));
		} finally {
			setPendingAction(null);
		}
	};
	const selectManagedWorkspace = async () => {
		setPendingAction("managed");
		setErrorMessage(null);
		try {
			await updateAgentProfileWorkspace({
				actorProfileId: input.actorProfileId,
				organizationId: input.organizationId,
				profileId: input.profile.openMeldProfileId,
				workspaceMode: "openmeld_managed",
			});
			clearPendingAgentProfileCreationLocalSetupForProfile(
				input.profile.openMeldProfileId
			);
			const updatedProfile = await updateAgentProfileDefaultProject({
				actorProfileId: input.actorProfileId,
				defaultProjectId: null,
				organizationId: input.organizationId,
				profileId: input.profile.openMeldProfileId,
			});
			input.onProfileUpdated(updatedProfile);
			toast.success("OpenMeld will choose the working folder.");
			closeDialog();
		} catch (error) {
			setErrorMessage(formatProjectSettingsError(error));
		} finally {
			setPendingAction(null);
		}
	};
	const saveCustomWorkspace = async () => {
		if (workspacePath.trim().length === 0) {
			setErrorMessage("Enter the full working folder path on this computer.");
			return;
		}
		setPendingAction("custom-workspace");
		setErrorMessage(null);
		try {
			await updateAgentProfileWorkspace({
				actorProfileId: input.actorProfileId,
				organizationId: input.organizationId,
				profileId: input.profile.openMeldProfileId,
				workspaceMode: "custom",
				workspacePath,
			});
			clearPendingAgentProfileCreationLocalSetupForProfile(
				input.profile.openMeldProfileId
			);
			const updatedProfile = await updateAgentProfileDefaultProject({
				actorProfileId: input.actorProfileId,
				defaultProjectId: null,
				organizationId: input.organizationId,
				profileId: input.profile.openMeldProfileId,
			});
			input.onProfileUpdated(updatedProfile);
			toast.success("Working folder updated.");
			closeDialog();
		} catch (error) {
			setErrorMessage(formatProjectSettingsError(error));
		} finally {
			setPendingAction(null);
		}
	};
	const isPending = pendingAction !== null;
	const workspaceChangeDisabled =
		isPending || input.executionTargetChangeEligibilityStatus !== "allowed";
	const selectedMode = selectionMode ?? currentMode;
	const selectedIndex = ["workspace", "project", "managed"].indexOf(
		selectedMode
	);
	const saveDisabled =
		workspaceChangeDisabled ||
		selectionMode === null ||
		(selectionMode === "project" && selectedConnection === null) ||
		(selectionMode === "workspace" && workspacePath.trim().length === 0);
	const saveSelection = async () => {
		if (selectionMode === "managed") {
			await selectManagedWorkspace();
			return;
		}
		if (selectionMode === "workspace") {
			await saveCustomWorkspace();
			return;
		}
		if (selectionMode === "project" && selectedConnection) {
			await applyConnection(selectedConnection);
		}
	};
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!(open || isPending)) {
					closeDialog();
				}
			}}
			open={input.open}
		>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Working folder</DialogTitle>
					<DialogDescription>
						Choose where {input.profile.profileName} starts new work on this
						computer.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4">
					<RadioGroup
						aria-disabled={workspaceChangeDisabled || undefined}
						aria-label="Starting location"
						className={cn(
							"w-full gap-1",
							workspaceChangeDisabled && "pointer-events-none opacity-70"
						)}
						selectedIndex={selectedIndex}
					>
						<RadioItem
							className="px-3 py-2.5"
							description="Use one specific folder on this computer."
							index={0}
							label="A folder on this computer"
							onSelect={() => {
								setSelectionMode("workspace");
								setWorkspacePath(
									currentMode === "workspace"
										? (input.currentWorkingFolder ?? "")
										: ""
								);
								setSelectedConnection(null);
								setErrorMessage(null);
							}}
						/>
						<RadioItem
							className="px-3 py-2.5"
							description={
								defaultProject
									? `${defaultProject.name} is the current Project.`
									: "Use a Project’s connected folder across computers."
							}
							index={1}
							label="A Project folder"
							onSelect={() => {
								setSelectionMode("project");
								setSelectedProjectId(defaultProjectId ?? "");
								setSelectedBindingGeneration(null);
								setSelectedConnection(null);
								setErrorMessage(null);
							}}
						/>
						<RadioItem
							className="px-3 py-2.5"
							description="Let OpenMeld choose a folder for each new Session."
							index={2}
							label="OpenMeld managed"
							onSelect={() => {
								setSelectionMode("managed");
								setSelectedConnection(null);
								setErrorMessage(null);
							}}
						/>
					</RadioGroup>
					<p className="text-muted-foreground text-xs leading-5">
						{FUTURE_WAKES_PROJECT_SETTINGS_NOTICE}
					</p>
					{input.executionTargetChangeEligibilityStatus === "blocked" ? (
						<p className="text-muted-foreground text-xs leading-5">
							Working folder changes are unavailable while this Agent is working
							because changing folders would interrupt the current Wake.
						</p>
					) : null}
					{input.executionTargetChangeEligibilityStatus === "unavailable" ? (
						<p className="text-muted-foreground text-xs leading-5">
							OpenMeld couldn’t confirm whether this Agent is working, so
							working folder changes are temporarily unavailable. Try again.
						</p>
					) : null}
					<ProjectSettingsSelectionControls
						disabled={workspaceChangeDisabled}
						isProjectsPending={projectsQuery.isPending}
						mode={selectionMode}
						onConnectionReady={(connection) => {
							setSelectedBindingGeneration(connection.bindingGeneration);
							setSelectedConnection(connection);
						}}
						onManualPathChange={(path) => {
							setWorkspacePath(path);
							setErrorMessage(null);
						}}
						onProjectChange={(projectId) => {
							setSelectedProjectId(projectId);
							setSelectedBindingGeneration(null);
						}}
						organizationId={input.organizationId}
						projectId={selectedProjectId}
						projects={projects}
						selectedBindingGeneration={selectedBindingGeneration}
						workspacePath={workspacePath}
					/>
					{projectsQuery.isError ? (
						<p className="text-destructive text-sm">
							OpenMeld couldn’t load Projects for this organization.
						</p>
					) : null}
					{errorMessage ? (
						<p className="text-destructive text-sm">{errorMessage}</p>
					) : null}
				</div>
				<DialogFooter>
					<DialogClose
						render={
							<Button disabled={isPending} type="button" variant="ghost" />
						}
					>
						Cancel
					</DialogClose>
					<Button
						disabled={saveDisabled}
						onClick={() => {
							saveSelection().catch((error) => {
								console.error("Failed to update working folder.", error);
							});
						}}
						type="button"
					>
						{isPending ? "Saving…" : "Save changes"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ProjectSettingsSelectionControls(input: {
	disabled: boolean;
	isProjectsPending: boolean;
	mode: ProjectSelectionMode;
	onConnectionReady: (connection: LocalProjectControlConnection) => void;
	onManualPathChange: (path: string) => void;
	onProjectChange: (projectId: string) => void;
	organizationId: string;
	projectId: string;
	projects: readonly Project[];
	selectedBindingGeneration: string | null;
	workspacePath: string;
}) {
	if (input.mode === "workspace") {
		return (
			<AgentProfileProjectSelector
				disabled={input.disabled}
				manualPath={input.workspacePath}
				onConnectionReady={() => undefined}
				onManualPathChange={input.onManualPathChange}
				onProjectChange={() => undefined}
				organizationId={input.organizationId}
				projectId=""
				projects={input.projects}
				selectedBindingGeneration={null}
				showProjectSelector={false}
				workspaceFallbackMode="advanced"
			/>
		);
	}
	if (!(input.mode && !input.isProjectsPending)) {
		return null;
	}
	return (
		<AgentProfileProjectSelector
			autoSelectSingleConnection={false}
			disabled={input.disabled}
			manualPath=""
			onConnectionReady={input.onConnectionReady}
			onManualPathChange={() => undefined}
			onProjectChange={input.onProjectChange}
			organizationId={input.organizationId}
			projectId={input.projectId}
			projects={input.projects}
			selectedBindingGeneration={input.selectedBindingGeneration}
			showWorkspaceFallbacks={false}
		/>
	);
}

function resolveCurrentMode(input: {
	currentWorkingFolder: string | null;
	defaultProjectId: string | null;
}): Exclude<ProjectSelectionMode, null> {
	if (input.defaultProjectId) {
		return "project";
	}
	if (
		input.currentWorkingFolder &&
		input.currentWorkingFolder !== "OpenMeld managed"
	) {
		return "workspace";
	}
	return "managed";
}

function formatProjectSettingsError(error: unknown): string {
	return error instanceof Error
		? error.message
		: "OpenMeld couldn’t update the Default Project on this computer.";
}
