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
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useProjectDiscovery } from "#/components/projects/use-project-discovery";
import { updateAgentProfileDefaultProject } from "#/lib/profiles/update-default-project";
import { updateAgentProfileWorkspace } from "#/lib/profiles/update-profile-workspace";
import { projectsQueryOptions } from "#/query/organizations/projects";
import { AgentProfileProjectSelector } from "./agent-profile-project-selector";
import {
	FUTURE_WAKES_PROJECT_SETTINGS_NOTICE,
	shouldShowAgentProfileProjectSettings,
} from "./agent-profile-project-settings";

type ProjectSelectionMode = "folder" | "project" | "workspace" | null;

export function AgentProfileProjectSettingsDialog(input: {
	actorProfileId: string | null;
	agentControllerRef: string | null;
	executionTargetChangeEligibilityStatus: "allowed" | "blocked" | "unavailable";
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
	return <LocalAgentProfileProjectSettingsDialog {...input} />;
}

function LocalAgentProfileProjectSettingsDialog(input: {
	actorProfileId: string | null;
	agentControllerRef: string | null;
	executionTargetChangeEligibilityStatus: "allowed" | "blocked" | "unavailable";
	onOpenChange: (open: boolean) => void;
	onProfileUpdated: (profile: AuthProfileView) => void;
	open: boolean;
	organizationId: string;
	profile: AuthProfileView;
}) {
	const projectsQuery = useQuery(
		projectsQueryOptions({ organizationId: input.organizationId })
	);
	const [selectionMode, setSelectionMode] =
		useState<ProjectSelectionMode>(null);
	const [selectedProjectId, setSelectedProjectId] = useState("");
	const [selectedBindingGeneration, setSelectedBindingGeneration] = useState<
		string | null
	>(null);
	const [workspacePath, setWorkspacePath] = useState("");
	const [pendingAction, setPendingAction] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const projects = projectsQuery.data?.projects ?? [];
	const defaultProjectId = input.profile.defaultProjectId ?? null;
	const defaultProject = projects.find(
		(project) => project.id === defaultProjectId
	);
	const closeDialog = () => {
		setSelectionMode(null);
		setSelectedProjectId("");
		setSelectedBindingGeneration(null);
		setWorkspacePath("");
		setErrorMessage(null);
		input.onOpenChange(false);
	};
	const applyConnection = async (connection: LocalProjectControlConnection) => {
		setPendingAction("connection");
		setErrorMessage(null);
		try {
			await updateAgentProfileWorkspace({
				actorProfileId: input.actorProfileId,
				profileId: input.profile.openMeldProfileId,
				workspaceMode: "custom",
				workspacePath: connection.path,
			});
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
				profileId: input.profile.openMeldProfileId,
				workspaceMode: "openmeld_managed",
			});
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
				profileId: input.profile.openMeldProfileId,
				workspaceMode: "custom",
				workspacePath,
			});
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
	const clearDefaultProject = async () => {
		setPendingAction("clear");
		setErrorMessage(null);
		try {
			const updatedProfile = await updateAgentProfileDefaultProject({
				actorProfileId: input.actorProfileId,
				defaultProjectId: null,
				organizationId: input.organizationId,
				profileId: input.profile.openMeldProfileId,
			});
			input.onProfileUpdated(updatedProfile);
			toast.success("Default Project cleared.");
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
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!(open || isPending)) {
					closeDialog();
				}
			}}
			open={input.open}
		>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Default Project and working folder</DialogTitle>
					<DialogDescription>
						Choose where {input.profile.profileName} starts work on this
						computer.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4">
					<div className="grid gap-1 border border-border/70 p-3 text-sm">
						<p>
							<span className="text-muted-foreground">Default Project: </span>
							{defaultProject?.name ??
								(defaultProjectId ? "Unavailable" : "None")}
						</p>
						<p className="text-muted-foreground text-xs leading-5">
							{FUTURE_WAKES_PROJECT_SETTINGS_NOTICE}
						</p>
						{defaultProjectId ? (
							<DefaultProjectWorkingFolder
								organizationId={input.organizationId}
								projectId={defaultProjectId}
								projects={projects}
							/>
						) : null}
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							disabled={workspaceChangeDisabled || projectsQuery.isPending}
							onClick={() => {
								setSelectedProjectId("");
								setSelectedBindingGeneration(null);
								setSelectionMode("project");
							}}
							type="button"
							variant="outline"
						>
							Change Default Project
						</Button>
						<Button
							disabled={workspaceChangeDisabled || !defaultProjectId}
							onClick={() => {
								setSelectedProjectId(defaultProjectId ?? "");
								setSelectedBindingGeneration(null);
								setSelectionMode("folder");
							}}
							type="button"
							variant="outline"
						>
							Change local folder
						</Button>
						<Button
							disabled={workspaceChangeDisabled}
							onClick={() => {
								setWorkspacePath("");
								setSelectionMode("workspace");
							}}
							type="button"
							variant="outline"
						>
							Choose custom working folder
						</Button>
					</div>
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
							applyConnection(connection).catch((error) => {
								console.error(
									"Failed to update Agent Profile Project settings.",
									error
								);
							});
						}}
						onManualPathChange={(path) => {
							setWorkspacePath(path);
							setErrorMessage(null);
						}}
						onProjectChange={(projectId) => {
							setSelectedProjectId(projectId);
							setSelectedBindingGeneration(null);
						}}
						onSaveCustomWorkspace={() => {
							saveCustomWorkspace().catch((error) => {
								console.error("Failed to update working folder.", error);
							});
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
				<DialogFooter className="flex-wrap">
					<Button
						disabled={workspaceChangeDisabled}
						onClick={() => {
							selectManagedWorkspace().catch((error) => {
								console.error("Failed to use managed workspace.", error);
							});
						}}
						type="button"
						variant="outline"
					>
						Let OpenMeld choose
					</Button>
					<Button
						disabled={isPending || !defaultProjectId}
						onClick={() => {
							clearDefaultProject().catch((error) => {
								console.error("Failed to clear Default Project.", error);
							});
						}}
						type="button"
						variant="outline"
					>
						Clear Default Project
					</Button>
					<DialogClose
						render={
							<Button disabled={isPending} type="button" variant="outline" />
						}
					>
						Done
					</DialogClose>
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
	onSaveCustomWorkspace: () => void;
	organizationId: string;
	projectId: string;
	projects: readonly Project[];
	selectedBindingGeneration: string | null;
	workspacePath: string;
}) {
	if (input.mode === "workspace") {
		return (
			<div className="grid gap-3">
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
				<Button
					className="justify-self-start"
					disabled={input.disabled || input.workspacePath.trim().length === 0}
					onClick={input.onSaveCustomWorkspace}
					type="button"
				>
					Save changes
				</Button>
			</div>
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

function DefaultProjectWorkingFolder(input: {
	organizationId: string;
	projectId: string;
	projects: readonly { id: string; updatedAtMs: number }[];
}) {
	const discovery = useProjectDiscovery({
		organizationId: input.organizationId,
		projects: input.projects,
	});
	const view = discovery.projectView(input.projectId);
	const defaultConnection = view.connections.find(
		(connection) => connection.isDefault
	);
	let folderDescription = "Not connected on this computer.";
	if (view.status === "checking") {
		folderDescription = "Checking this computer…";
	} else if (defaultConnection?.status === "available") {
		folderDescription = defaultConnection.path;
	} else if (defaultConnection?.status === "missing") {
		folderDescription = `${defaultConnection.path} (unavailable)`;
	}
	return (
		<p className="break-all text-xs">
			<span className="text-muted-foreground">Default working folder: </span>
			{folderDescription}
		</p>
	);
}

function formatProjectSettingsError(error: unknown): string {
	return error instanceof Error
		? error.message
		: "OpenMeld couldn’t update the Default Project on this computer.";
}
