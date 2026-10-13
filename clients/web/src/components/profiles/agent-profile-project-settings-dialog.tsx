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
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { clearPendingAgentProfileCreationLocalSetupForProfile } from "#/lib/profiles/agent-profile-creation-local-setup";
import { updateAgentProfileDefaultProject } from "#/lib/profiles/update-default-project";
import { updateAgentProfileWorkspace } from "#/lib/profiles/update-profile-workspace";
import { projectsQueryOptions } from "#/query/organizations/projects";
import { startProfilesQueryOptions } from "#/query/profiles/profiles";
import { agentProfileWorkingFolderQueryOptions } from "#/query/profiles/working-folder";
import { AgentProfileProjectSelector } from "./agent-profile-project-selector";
import {
	FUTURE_WAKES_PROJECT_SETTINGS_NOTICE,
	shouldShowAgentProfileProjectSettings,
} from "./agent-profile-project-settings";

type SettingsInput = {
	recoveryMessage?: string;
	onSaved?: () => void;
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
			key={`${input.storageScope}:${input.organizationId}:${input.profile.openMeldProfileId}:${input.open}`}
			onRetryRead={() => setReadRetry((retry) => retry + 1)}
			readRevision={readRetry}
		/>
	);
}

function LocalAgentProfileProjectSettingsDialog(
	input: SettingsInput & { onRetryRead: () => void; readRevision: number }
) {
	const queryClient = useQueryClient();
	const [opening] = useState(() => ({
		target: input.target,
		bindingTarget: input.expectedBindingTarget,
	}));
	const workspaceQueryOptions = useMemo(
		() =>
			agentProfileWorkingFolderQueryOptions({
				actorProfileId: input.actorProfileId,
				organizationId: input.organizationId,
				profileId: input.profile.openMeldProfileId,
				storageScope: input.storageScope,
				target: opening.target,
				expectedBindingTarget: opening.bindingTarget,
				enabled: input.open,
			}),
		[
			input.actorProfileId,
			input.organizationId,
			input.profile.openMeldProfileId,
			input.storageScope,
			input.open,
			opening,
		]
	);
	const cachedWorkspace = queryClient.getQueryData(
		workspaceQueryOptions.queryKey
	);
	const draftChanged = useRef(false);
	const [projectId, setProjectId] = useState(
		input.profile.defaultProjectId ?? ""
	);
	const [savedSettings, setSavedSettings] =
		useState<GetCurrentAgentProfileWorkspaceResponse | null>(
			cachedWorkspace ?? null
		);
	const [verified, setVerified] = useState(false);
	const [fallback, setFallback] = useState<
		"advanced" | "managed" | "project" | null
	>(() =>
		savedFolderSource(
			input.profile.defaultProjectId ?? "",
			cachedWorkspace?.workspace
		)
	);
	const savedLocalDraft = useRef<string | null>(null);
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
			enabled: input.open && (Boolean(projectId) || fallback === "project"),
		})
	);
	const selectedProjectId = projectId;
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
	const [path, setPath] = useState(() =>
		savedCustomPath(cachedWorkspace?.workspace)
	);
	const [connection, setConnection] =
		useState<LocalProjectControlConnection | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// The revision is an explicit user retry signal; retain the draft between reads.
	// biome-ignore lint/correctness/useExhaustiveDependencies: A retry must reacquire the same scoped query without remounting the draft.
	useEffect(() => {
		if (verified || !input.open) {
			return;
		}
		let disposed = false;
		const acquire = async () => {
			setAcquisitionError(null);
			await cancelPreviousProfileRead(queryClient, input.storageScope);
			if (disposed) {
				return;
			}
			const [result, local] = await Promise.all([
				refetchProfiles({ throwOnError: true }),
				queryClient.fetchQuery({ ...workspaceQueryOptions, staleTime: 0 }),
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
			setVerified(true);
			if (!draftChanged.current) {
				setProjectId(savedProjectId);
				setPath(savedCustomPath(local.workspace));
				setFallback(savedFolderSource(savedProjectId, local.workspace));
			}
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
		verified,
		input.readRevision,
		input.open,
		input.profile.openMeldProfileId,
		input.storageScope,
		queryClient,
		refetchProfiles,
		workspaceQueryOptions,
	]);
	const disabled = pending;
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
		if (disabled || !valid || !verified) {
			return;
		}
		setPending(true);
		setError(null);
		const context = {
			expectedBindingTarget: opening.bindingTarget,
			actorProfileId: input.actorProfileId,
			organizationId: input.organizationId,
			profileId: input.profile.openMeldProfileId,
		};
		let workspaceSaved = false;
		const draftKey = JSON.stringify({
			target,
			binding: opening.bindingTarget,
			fallback,
			path,
		});
		try {
			// Project intent is resolved by the Service's canonical connection. Do not
			// copy its path into a second custom-folder preference.
			if (!projectId && savedLocalDraft.current !== draftKey) {
				await updateAgentProfileWorkspace({
					...context,
					previousWorkspace: savedSettings?.workspace,
					target,
					workspaceMode:
						fallback === "advanced" ? "custom" : "openmeld_managed",
					...(fallback === "advanced" ? { workspacePath: path } : {}),
				});
				workspaceSaved = true;
				savedLocalDraft.current = draftKey;
			}
			workspaceSaved = !projectId && savedLocalDraft.current === draftKey;
			const updated = await updateAgentProfileDefaultProject({
				...context,
				defaultProjectId: projectId || null,
			});
			clearPendingAgentProfileCreationLocalSetupForProfile(
				input.profile.openMeldProfileId
			);
			input.onProfileUpdated(updated);
			queryClient.invalidateQueries({
				queryKey: workspaceQueryOptions.queryKey,
			});
			toast.success(
				input.recoveryMessage
					? "Working folder saved. Checking Agent availability…"
					: "Working folder updated."
			);
			input.onOpenChange(false);
			input.onSaved?.();
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
					<WorkingFolderReadStatus
						acquired={acquired}
						configurationError={savedConfigurationError}
						error={acquisitionError}
						onRetry={input.onRetryRead}
					/>
					<ImportedWorkingFolderNotice
						recoveryMessage={input.recoveryMessage}
						workspace={savedSettings?.workspace}
					/>
					<AgentProfileProjectSelector
						disabled={disabled}
						localFolderChangesBlocked={localFolderChangesBlocked}
						manualPath={path}
						onConnectionReady={setConnection}
						onManualPathChange={(value) => {
							draftChanged.current = true;
							setPath(value);
							setError(null);
						}}
						onProjectChange={(value) => {
							draftChanged.current = true;
							setProjectId(value);
							setConnection(null);
							setFallback(null);
							setError(null);
						}}
						onUseAdvancedWorkspace={() => {
							draftChanged.current = true;
							setFallback("advanced");
						}}
						onUseManagedWorkspace={() => {
							draftChanged.current = true;
							setFallback("managed");
						}}
						onUseProjectWorkspace={() => {
							draftChanged.current = true;
							setFallback("project");
						}}
						organizationId={input.organizationId}
						projectId={selectedProjectId}
						projects={projectsQuery.data?.projects ?? []}
						selectedBindingGeneration={connection?.bindingGeneration ?? null}
						target={target}
						workspaceFallbackMode={fallback}
					/>
					{projectsQuery.isPending &&
					(Boolean(projectId) || fallback === "project") ? (
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
					<Button disabled={disabled || !valid || !verified} onClick={save}>
						{pending ? "Saving…" : "Save changes"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function WorkingFolderReadStatus(input: {
	acquired: boolean;
	error: string | null;
	configurationError: string | null;
	onRetry: () => void;
}) {
	if (input.error) {
		return (
			<p className="text-destructive text-sm" role="alert">
				{input.error}{" "}
				<button className="underline" onClick={input.onRetry} type="button">
					Try again
				</button>
			</p>
		);
	}
	if (!input.acquired) {
		return (
			<output className="text-muted-foreground text-sm">
				Loading the saved working folder…
			</output>
		);
	}
	return input.configurationError ? (
		<p className="text-destructive text-sm" role="alert">
			{input.configurationError}
		</p>
	) : null;
}

function ImportedWorkingFolderNotice(input: {
	workspace?: ProfileWorkspaceReadResult;
	recoveryMessage?: string;
}) {
	if (input.recoveryMessage) {
		return <output className="text-sm">{input.recoveryMessage}</output>;
	}
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
	workspace: ProfileWorkspaceReadResult | undefined
): "advanced" | "managed" | null {
	if (projectId || workspace?.status !== "configured") {
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
			: "The folder was saved on this computer, but the Default Project update could not be confirmed. Retry to finish applying this choice.";
	}
	if (targetChanged) {
		return "This Agent’s Computer or local agent changed. Close and reopen Working folder to review its current settings.";
	}
	return structured.message || "Couldn’t save the working folder. Try again.";
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
