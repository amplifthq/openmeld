"use client";

import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	AgentProfileBindingTarget,
	AuthProfileView,
	GetCurrentAgentProfileWorkspaceResponse,
	LocalProjectControlConnection,
	PeopleComputerTarget,
	ProfileWorkspaceReadResult,
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
import {
	isCancelledError,
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { clearPendingAgentProfileCreationLocalSetupForProfile } from "#/lib/profiles/agent-profile-creation-local-setup";
import { updateAgentProfileDefaultProject } from "#/lib/profiles/update-default-project";
import {
	readAgentProfileWorkspace,
	updateAgentProfileWorkspace,
} from "#/lib/profiles/update-profile-workspace";
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
	onOpenChange: (open: boolean) => void;
	onProfileUpdated: (profile: AuthProfileView) => void;
	open: boolean;
	organizationId: string;
	profile: AuthProfileView;
	storageScope: string;
};

export function AgentProfileProjectSettingsDialog(input: SettingsInput) {
	const [readRetry, setReadRetry] = useState(0);
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
			key={`${input.storageScope}:${input.organizationId}:${input.profile.openMeldProfileId}:${input.open}:${readRetry}`}
			onRetryRead={() => setReadRetry((retry) => retry + 1)}
		/>
	);
}

function LocalAgentProfileProjectSettingsDialog(
	input: SettingsInput & { onRetryRead: () => void }
) {
	const queryClient = useQueryClient();
	const [opening] = useState(() => ({
		target: input.target,
		bindingTarget: input.expectedBindingTarget,
	}));
	const [projectId, setProjectId] = useState("");
	const [savedSettings, setSavedSettings] =
		useState<GetCurrentAgentProfileWorkspaceResponse | null>(null);
	const [acquisitionError, setAcquisitionError] = useState<string | null>(null);
	const acquired = savedSettings !== null;
	const profilesQuery = useQuery({
		...startProfilesQueryOptions({
			enabled: acquired,
			storageScope: input.storageScope,
		}),
		refetchOnMount: false,
	});
	const refetchProfiles = profilesQuery.refetch;
	const projectsQuery = useQuery(
		projectsQueryOptions({
			organizationId: input.organizationId,
			enabled: input.open,
		})
	);
	const selectedProjectId = projectId;
	const initialPath = savedCustomPath(savedSettings?.workspace);
	const target = savedSettings?.target ?? input.target;
	const savedConfigurationError = invalidSavedConfigurationMessage(
		savedSettings?.workspace
	);
	const saveBlockedReason =
		input.saveBlockedReason ??
		changedFolderTargetMessage(
			opening,
			{
				target: input.target,
				bindingTarget: input.expectedBindingTarget,
			},
			savedSettings?.target
		);
	const [fallback, setFallback] = useState<
		"advanced" | "managed" | "project" | null
	>(null);
	const [path, setPath] = useState("");
	const [connection, setConnection] =
		useState<LocalProjectControlConnection | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (acquired || !input.open) {
			return;
		}
		let disposed = false;
		const acquire = async () => {
			await cancelPreviousProfileRead(queryClient, input.storageScope);
			if (disposed) {
				return;
			}
			const [result, local] = await Promise.all([
				refetchProfiles({ throwOnError: true }),
				readAgentProfileWorkspace({
					actorProfileId: input.actorProfileId,
					organizationId: input.organizationId,
					profileId: input.profile.openMeldProfileId,
					target: opening.target,
					expectedBindingTarget: opening.bindingTarget,
				}),
			]);
			const profile = result.data?.find(
				(candidate) =>
					candidate.openMeldProfileId === input.profile.openMeldProfileId
			);
			if (disposed) {
				return;
			}
			if (!profile || profile.defaultProjectId === undefined) {
				throw new Error("The saved Default Project is unavailable. Try again.");
			}
			// Auth owns Project intent; Service owns saved local configuration.
			// Their acquired values initialize this opening's draft only once.
			const savedProjectId = profile.defaultProjectId ?? "";
			setSavedSettings(local);
			setProjectId(savedProjectId);
			setPath(savedCustomPath(local.workspace));
			setConnection(null);
			setFallback(savedFolderSource(savedProjectId, local.workspace));
		};
		acquire().catch((failure) => {
			if (!(disposed || isCancelledError(failure))) {
				setAcquisitionError(toStructuredApiClientFailure(failure).message);
			}
		});
		return () => {
			disposed = true;
		};
	}, [
		acquired,
		input.open,
		input.actorProfileId,
		input.organizationId,
		opening,
		input.profile.openMeldProfileId,
		input.storageScope,
		queryClient,
		refetchProfiles,
	]);
	const savedProfileUnavailable = !acquired && acquisitionError !== null;
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
		!saveBlockedReason;
	const save = async () => {
		// The displayed choice does not prove that the Service has a usable
		// workspace. Explicit Save may reapply it to initialize or repair it.
		if (disabled || !valid) {
			return;
		}
		setPending(true);
		setError(null);
		const context = {
			...(opening.bindingTarget
				? { expectedBindingTarget: opening.bindingTarget }
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
					target,
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
			setError(folderSaveError(failure, workspaceSaved));
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
							{acquisitionError}{" "}
							<button
								className="underline"
								onClick={input.onRetryRead}
								type="button"
							>
								Try again
							</button>
						</p>
					) : null}
					{savedConfigurationError ? (
						<p className="text-destructive text-sm" role="alert">
							{savedConfigurationError}
						</p>
					) : null}
					<ImportedWorkingFolderNotice workspace={savedSettings?.workspace} />
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
						target={target}
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
					{saveBlockedReason ? (
						<output className="text-muted-foreground text-sm">
							{saveBlockedReason}
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

function ImportedWorkingFolderNotice(input: {
	workspace?: ProfileWorkspaceReadResult;
}) {
	if (
		input.workspace?.status !== "configured" ||
		input.workspace.configurationOrigin !== "imported_native_session"
	) {
		return null;
	}
	return (
		<p className="text-muted-foreground text-sm">
			This folder came from a local agent conversation. If it becomes
			unavailable, restore the original folder in that app or choose a folder
			for new work. A different folder does not restore its files.
		</p>
	);
}

function changedFolderTargetMessage(
	opening: {
		target?: PeopleComputerTarget;
		bindingTarget?: AgentProfileBindingTarget;
	},
	current: {
		target?: PeopleComputerTarget;
		bindingTarget?: AgentProfileBindingTarget;
	},
	acquiredTarget?: PeopleComputerTarget
): string | undefined {
	// The saved-read receipt pins the Computer. A temporarily absent route is
	// not a different identity; Binding changes remain independently fenced.
	const pinned = acquiredTarget ?? opening.target;
	const sameComputer =
		!(current.target && pinned) ||
		(pinned.deviceId === current.target.deviceId &&
			pinned.runtimeLane === current.target.runtimeLane);
	const previous = opening.bindingTarget;
	const next = current.bindingTarget;
	const sameBinding =
		previous?.bindingId === next?.bindingId &&
		previous?.openMeldServiceRuntimeId === next?.openMeldServiceRuntimeId &&
		previous?.agentControllerRef === next?.agentControllerRef &&
		previous?.agentControllerConversationId ===
			next?.agentControllerConversationId;
	return sameComputer && sameBinding
		? undefined
		: "This Agent’s Computer or local agent changed. Your changes are still here. Close and reopen Working folder to review its current settings.";
}

async function cancelPreviousProfileRead(
	queryClient: QueryClient,
	storageScope: string
) {
	const { queryKey } = startProfilesQueryOptions({
		enabled: true,
		storageScope,
	});
	// Preserve display data as stale, but never acquire a read from before opening.
	const snapshot =
		queryClient.getQueryState<readonly AuthProfileView[]>(queryKey);
	const cancellation = queryClient.cancelQueries(
		{ queryKey, exact: true },
		{ silent: true }
	);
	if (snapshot?.data !== undefined) {
		queryClient.setQueryData(queryKey, snapshot.data, {
			updatedAt: snapshot.dataUpdatedAt,
		});
	}
	await queryClient.invalidateQueries({
		queryKey,
		exact: true,
		refetchType: "none",
	});
	await cancellation;
}

function savedCustomPath(
	workspace: ProfileWorkspaceReadResult | undefined
): string {
	return workspace?.status === "configured" &&
		workspace.workspaceMode === "custom"
		? workspace.workspacePath
		: "";
}

function savedFolderSource(
	projectId: string,
	workspace: ProfileWorkspaceReadResult
): "advanced" | "managed" | null {
	if (projectId || workspace.status !== "configured") {
		return null;
	}
	return workspace.workspaceMode === "custom" ? "advanced" : "managed";
}

function invalidSavedConfigurationMessage(
	workspace: ProfileWorkspaceReadResult | undefined
): string | null {
	return workspace?.status === "invalid"
		? `The saved folder configuration is invalid. Choose a working folder and save it to repair this setting. (${workspace.reasonCode})`
		: null;
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
