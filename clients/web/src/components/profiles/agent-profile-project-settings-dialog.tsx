"use client";

import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	AgentProfileBindingTarget,
	AuthProfileView,
	LocalProjectControlConnection,
	PeopleComputerTarget,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { clearPendingAgentProfileCreationLocalSetupForProfile } from "#/lib/profiles/agent-profile-creation-local-setup";
import { updateAgentProfileDefaultProject } from "#/lib/profiles/update-default-project";
import { updateAgentProfileWorkspace } from "#/lib/profiles/update-profile-workspace";
import { projectsQueryOptions } from "#/query/organizations/projects";
import { startProfilesQueryOptions } from "#/query/profiles/profiles";
import { AgentProfileProjectSelector } from "./agent-profile-project-selector";
import {
	FUTURE_WAKES_PROJECT_SETTINGS_NOTICE,
	shouldShowAgentProfileProjectSettings,
} from "./agent-profile-project-settings";

type SettingsInput = {
	expectedBindingTarget?: AgentProfileBindingTarget;
	saveBlockedReason?: string;
	target?: PeopleComputerTarget;
	actorProfileId: string | null;
	agentControllerRef: string | null;
	executionTargetChangeEligibilityStatus: "allowed" | "blocked" | "unavailable";
	currentWorkingFolder: string | null;
	onOpenChange: (open: boolean) => void;
	onProfileUpdated: (profile: AuthProfileView) => void;
	open: boolean;
	organizationId: string;
	profile: AuthProfileView;
	storageScope: string;
};

export function AgentProfileProjectSettingsDialog(input: SettingsInput) {
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
			key={`${input.storageScope}:${input.organizationId}:${input.profile.openMeldProfileId}:${input.target?.deviceId}:${input.target?.runtimeLane}:${input.open}`}
		/>
	);
}

function LocalAgentProfileProjectSettingsDialog(input: SettingsInput) {
	const profilesQuery = useQuery({
		...startProfilesQueryOptions({
			enabled: input.open,
			storageScope: input.storageScope,
		}),
		staleTime: 0,
		refetchOnMount: "always",
	});
	const savedProfile = profilesQuery.data?.find(
		(profile) => profile.openMeldProfileId === input.profile.openMeldProfileId
	);
	const projectsQuery = useQuery(
		projectsQueryOptions({
			organizationId: input.organizationId,
			enabled: input.open,
		})
	);
	// null means the saved preference has not been acquired; an empty string
	// is the owner's explicit non-Project draft.
	const [projectId, setProjectId] = useState<string | null>(null);
	const selectedProjectId = projectId ?? "";
	const initialPath = resolveInitialCustomPath(
		selectedProjectId,
		input.currentWorkingFolder
	);
	const [fallback, setFallback] = useState<
		"advanced" | "managed" | "project" | null
	>(null);
	const [path, setPath] = useState("");
	const [connection, setConnection] =
		useState<LocalProjectControlConnection | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const acquired = projectId !== null;
	useEffect(() => {
		if (
			acquired ||
			!input.open ||
			!profilesQuery.isFetchedAfterMount ||
			profilesQuery.isFetching ||
			profilesQuery.isError ||
			!savedProfile ||
			savedProfile.defaultProjectId === undefined
		) {
			return;
		}
		// Auth owns the saved preference. Acquire it once for this draft, then
		// retain edits and pending writes through later Query refreshes.
		const savedProjectId = savedProfile.defaultProjectId ?? "";
		const savedPath = resolveInitialCustomPath(
			savedProjectId,
			input.currentWorkingFolder
		);
		setProjectId(savedProjectId);
		setPath(savedPath);
		setConnection(null);
		setFallback(
			savedProjectId
				? null
				: resolveInitialFallback(savedPath, input.currentWorkingFolder)
		);
	}, [
		acquired,
		input.open,
		input.currentWorkingFolder,
		profilesQuery.isFetchedAfterMount,
		profilesQuery.isFetching,
		profilesQuery.isError,
		savedProfile,
	]);
	const savedProfileUnavailable =
		!acquired &&
		profilesQuery.isFetchedAfterMount &&
		!profilesQuery.isFetching &&
		(profilesQuery.isError ||
			!savedProfile ||
			savedProfile.defaultProjectId === undefined);
	const disabled = pending || !acquired;
	const localFolderChangesBlocked =
		input.executionTargetChangeEligibilityStatus !== "allowed";
	const valid =
		isWorkingFolderDraftValid({
			projectId: selectedProjectId,
			connection,
			fallback,
			path,
		}) &&
		!(localFolderChangesBlocked && !projectId) &&
		!input.saveBlockedReason;
	const save = async () => {
		// The displayed choice does not prove that the Service has a usable
		// workspace. Explicit Save may reapply it to initialize or repair it.
		if (disabled || !valid) {
			return;
		}
		setPending(true);
		setError(null);
		const context = {
			...(input.expectedBindingTarget
				? { expectedBindingTarget: input.expectedBindingTarget }
				: {}),
			actorProfileId: input.actorProfileId,
			organizationId: input.organizationId,
			profileId: input.profile.openMeldProfileId,
		};
		let workspaceSaved = false;
		try {
			// Project intent is resolved by the Service's canonical connection. Do not
			// copy its path into a second custom-folder preference.
			if (!projectId) {
				await updateAgentProfileWorkspace({
					...context,
					target: input.target,
					workspaceMode:
						fallback === "advanced" ? "custom" : "openmeld_managed",
					...(fallback === "advanced" ? { workspacePath: path } : {}),
				});
				workspaceSaved = true;
			}
			const updated = await updateAgentProfileDefaultProject({
				...context,
				defaultProjectId: projectId || null,
			});
			clearPendingAgentProfileCreationLocalSetupForProfile(
				input.profile.openMeldProfileId
			);
			input.onProfileUpdated(updated);
			toast.success("Working folder updated.");
			input.onOpenChange(false);
		} catch (failure) {
			setError(
				folderSaveError(
					failure,
					workspaceSaved && Boolean(input.expectedBindingTarget)
				)
			);
		} finally {
			setPending(false);
		}
	};
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!pending) {
					input.onOpenChange(open);
				}
			}}
			open={input.open}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Working folder</DialogTitle>
					<DialogDescription>
						Choose where {input.profile.profileName} starts new work.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4">
					{acquired || savedProfileUnavailable ? null : (
						<output className="text-muted-foreground text-sm">
							Loading the saved working folder…
						</output>
					)}
					{savedProfileUnavailable ? (
						<p className="text-destructive text-sm" role="alert">
							{profilesQuery.error?.message ??
								"The saved working folder is unavailable."}{" "}
							<button
								className="underline"
								onClick={() => profilesQuery.refetch()}
								type="button"
							>
								Try again
							</button>
						</p>
					) : null}
					<AgentProfileProjectSelector
						disabled={disabled}
						localFolderChangesBlocked={localFolderChangesBlocked}
						manualPath={path}
						onConnectionReady={setConnection}
						onManualPathChange={(value) => {
							setPath(value);
							setError(null);
						}}
						onProjectChange={(value) => {
							setProjectId(value);
							setConnection(null);
							setFallback(null);
							setError(null);
						}}
						onUseAdvancedWorkspace={() => {
							setFallback("advanced");
							setPath(initialPath);
						}}
						onUseManagedWorkspace={() => {
							setFallback("managed");
							setPath("");
						}}
						onUseProjectWorkspace={() => setFallback("project")}
						organizationId={input.organizationId}
						projectId={selectedProjectId}
						projects={projectsQuery.data?.projects ?? []}
						selectedBindingGeneration={connection?.bindingGeneration ?? null}
						target={input.target}
						workspaceFallbackMode={fallback}
					/>
					{projectsQuery.isPending ? (
						<output className="text-muted-foreground text-sm">
							Loading projects…
						</output>
					) : null}
					{projectsQuery.isError ? (
						<p className="text-destructive text-sm" role="alert">
							Couldn’t load projects.{" "}
							<button
								className="underline"
								onClick={() => projectsQuery.refetch()}
								type="button"
							>
								Try again
							</button>
						</p>
					) : null}
					<p className="text-muted-foreground text-xs">
						{FUTURE_WAKES_PROJECT_SETTINGS_NOTICE}
					</p>
					{input.executionTargetChangeEligibilityStatus === "blocked" ? (
						<p className="text-muted-foreground text-sm">
							This Agent is working. You can choose a project for new work now.
							Wait until this task finishes to change a folder on this computer.
						</p>
					) : null}
					{input.executionTargetChangeEligibilityStatus === "unavailable" ? (
						<p className="text-muted-foreground text-sm">
							OpenMeld can’t check whether this Agent is working. Try again
							before changing a folder on this computer.
						</p>
					) : null}
					{error ? (
						<p className="text-destructive text-sm" role="alert">
							{error}
						</p>
					) : null}
					{input.saveBlockedReason ? (
						<output className="text-muted-foreground text-sm">
							{input.saveBlockedReason}
						</output>
					) : null}
				</div>
				<DialogFooter>
					<Button
						disabled={pending}
						onClick={() => input.onOpenChange(false)}
						variant="ghost"
					>
						Cancel
					</Button>
					<Button disabled={disabled || !valid} onClick={save}>
						{pending ? "Saving…" : "Save changes"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function folderSaveError(failure: unknown, localFolderSaved: boolean): string {
	const structured = toStructuredApiClientFailure(failure);
	const targetChanged =
		structured.upstreamCode === "agent_profile_binding.target_changed";
	if (localFolderSaved) {
		return targetChanged
			? "The folder was saved on the original Computer. This Agent’s Default Project is unchanged. Close and reopen Working folder to review its current settings."
			: "The folder was saved on the original Computer, but the Default Project update could not be confirmed. Close and reopen Working folder to check its current settings.";
	}
	if (targetChanged) {
		return "This Agent’s Computer or local agent changed. Close and reopen Working folder to review its current settings.";
	}
	return failure instanceof Error
		? failure.message
		: "Couldn’t save the working folder. Try again.";
}

function resolveInitialCustomPath(
	projectId: string,
	path: string | null
): string {
	if (projectId || path === "OpenMeld managed") {
		return "";
	}
	return path ?? "";
}

function resolveInitialFallback(
	initialPath: string,
	currentWorkingFolder: string | null
): "advanced" | "managed" | null {
	if (initialPath) {
		return "advanced";
	}
	if (currentWorkingFolder === "OpenMeld managed") {
		return "managed";
	}
	return null;
}

function isWorkingFolderDraftValid(input: {
	projectId: string;
	connection: LocalProjectControlConnection | null;
	fallback: "project" | "advanced" | "managed" | null;
	path: string;
}): boolean {
	if (input.projectId) {
		return input.connection !== null;
	}
	if (input.fallback === "managed") {
		return true;
	}
	return input.fallback === "advanced" && input.path.trim().length > 0;
}
