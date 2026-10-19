"use client";

import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	AgentProfileBindingTarget,
	AuthProfileView,
	GetAgentProfileFoldersResponse,
	LocalProjectControlConnection,
	ManageAgentProfileFoldersResponse,
	PeopleComputerTarget,
	ProfileFolderOperation,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { clearPendingAgentProfileCreationLocalSetupForProfile } from "#/lib/profiles/agent-profile-creation-local-setup";
import { manageAgentProfileFolders } from "#/lib/profiles/agent-profile-folders";
import { updateAgentProfileDefaultProject } from "#/lib/profiles/update-default-project";
import { projectsQueryOptions } from "#/query/organizations/projects";
import { agentProfileFoldersQueryOptions } from "#/query/profiles/agent-profile-folders";
import { agentProfileWorkingFolderQueryOptions } from "#/query/profiles/working-folder";
import {
	type AgentProfileFolderRow,
	buildAgentProfileFolderRows,
	folderListNotice,
} from "./agent-profile-folders-model";
import { AgentProfileProjectSelector } from "./agent-profile-project-selector";
import {
	FUTURE_WAKES_PROJECT_SETTINGS_NOTICE,
	shouldShowAgentProfileProjectSettings,
} from "./agent-profile-project-settings";

type FoldersDialogInput = {
	actorProfileId: string | null;
	agentControllerRef: string | null;
	executionTargetChangeEligibilityStatus: "allowed" | "blocked" | "unavailable";
	expectedBindingTarget?: AgentProfileBindingTarget;
	onOpenChange: (open: boolean) => void;
	onProfileUpdated: (profile: AuthProfileView) => void;
	open: boolean;
	organizationId: string;
	profile: AuthProfileView;
	/** Opened to recover a task that couldn't use its working folder. */
	recovery?: WorkingFolderRecovery;
	storageScope: string;
	target?: PeopleComputerTarget;
};

export type WorkingFolderRecovery = {
	message: string;
	/** Runs after the folder new work starts in was saved. */
	onSaved: () => void;
	/** Why writes must wait, such as an unconfirmed or changed Computer. */
	saveBlockedReason?: string;
};

type FolderChange = Exclude<ProfileFolderOperation, { operation: "list" }>;
type RepairOperation = Extract<FolderChange, { operation: "repair" }>;

const CONFIGURATION_INVALID = "profile_folder.configuration_invalid";

/**
 * Owner-only Working folder surface: the Agent's folders on its Computer and
 * which one new work starts in. The Working folder card, the list card's menu
 * and working-folder recovery open it. Folder settings that can't be read are
 * repaired here by choosing the folder new work starts in.
 */
export function AgentProfileFoldersDialog(input: FoldersDialogInput) {
	if (
		!shouldShowAgentProfileProjectSettings({
			agentControllerRef: input.agentControllerRef,
			managedRole: input.profile.managedRole,
		})
	) {
		return null;
	}
	return (
		<Dialog onOpenChange={(open) => input.onOpenChange(open)} open={input.open}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Working folder</DialogTitle>
					<DialogDescription>
						Folders {input.profile.profileName} can work in. New work starts in
						the default folder; you can choose another folder for a task.
					</DialogDescription>
				</DialogHeader>
				{input.open ? <FoldersDialogBody {...input} /> : null}
				<DialogFooter>
					<Button onClick={() => input.onOpenChange(false)} variant="ghost">
						Done
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function FoldersDialogBody(input: FoldersDialogInput) {
	const queryClient = useQueryClient();
	const foldersQueryOptions = agentProfileFoldersQueryOptions({
		enabled: true,
		organizationId: input.organizationId,
		profileId: input.profile.openMeldProfileId,
		storageScope: input.storageScope,
	});
	const foldersQuery = useQuery({ ...foldersQueryOptions, staleTime: 0 });
	const defaultPathQuery = useQuery(
		agentProfileWorkingFolderQueryOptions({
			actorProfileId: input.actorProfileId,
			enabled: Boolean(input.target),
			expectedBindingTarget: input.expectedBindingTarget,
			organizationId: input.organizationId,
			profileId: input.profile.openMeldProfileId,
			storageScope: input.storageScope,
			target: input.target,
		})
	);
	const projectsQuery = useQuery(
		projectsQueryOptions({ organizationId: input.organizationId })
	);
	const [pendingFolderId, setPendingFolderId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const response = foldersQuery.data;
	const configurationInvalid =
		response !== undefined &&
		response.status !== "current" &&
		response.reasonCode === CONFIGURATION_INVALID;
	const projection =
		response && response.status !== "unavailable" ? response.projection : null;
	const rows = projection
		? buildAgentProfileFolderRows({
				defaultProjectId: input.profile.defaultProjectId,
				projection,
			})
		: [];
	// Writes keep the Binding this opening was reviewed against. A changed
	// Computer or local agent blocks them until Folders is reopened.
	const [bindingTarget] = useState(input.expectedBindingTarget);
	const targetChanged = !sameBindingTarget(
		bindingTarget,
		input.expectedBindingTarget
	);
	const saveBlockedReason = input.recovery?.saveBlockedReason;
	const reviewed =
		Boolean(bindingTarget) && !targetChanged && !saveBlockedReason;
	// Writes need the Computer to answer; a recorded list is read-only.
	const writable = reviewed && response?.status === "current";
	const localDefaultBlocked =
		input.executionTargetChangeEligibilityStatus !== "allowed";
	const defaultPath =
		defaultPathQuery.data?.workspace.status === "configured"
			? defaultPathQuery.data.workspace.workspacePath
			: null;
	const defaultProjectName = input.profile.defaultProjectId
		? (projectsQuery.data?.projects.find(
				(project) => project.id === input.profile.defaultProjectId
			)?.name ?? "its Default Project")
		: null;

	// A repair replaces the list, so it wins over any list read before it.
	const applied = (
		result: ManageAgentProfileFoldersResponse,
		replaced: boolean
	) => {
		const current: GetAgentProfileFoldersResponse = {
			agentProfileId: result.agentProfileId,
			observedAtMs: result.observedAtMs,
			projection: result.projection,
			status: "current",
			target: result.target,
		};
		// A read that started before this change must not restore the old list.
		queryClient.cancelQueries({ queryKey: foldersQueryOptions.queryKey });
		queryClient.setQueryData<GetAgentProfileFoldersResponse>(
			foldersQueryOptions.queryKey,
			(cached) =>
				!replaced &&
				cached &&
				cached.status !== "unavailable" &&
				cached.projection.revision > current.projection.revision
					? cached
					: current
		);
	};
	const change = async (operation: FolderChange) => {
		if (!bindingTarget) {
			throw new Error("OpenMeld couldn’t confirm this Agent’s computer.");
		}
		const result = await manageAgentProfileFolders({
			actorProfileId: input.actorProfileId,
			expectedBindingTarget: bindingTarget,
			operation,
			organizationId: input.organizationId,
			profileId: input.profile.openMeldProfileId,
		});
		applied(result, operation.operation === "repair");
		return result;
	};
	// The folder new work starts in changed: unfinished creation setup is
	// settled, and recovery rechecks whether the Agent can take new work.
	const defaultSaved = (message: string) => {
		clearPendingAgentProfileCreationLocalSetupForProfile(
			input.profile.openMeldProfileId
		);
		queryClient.invalidateQueries({
			queryKey: ["private-working-folder", input.storageScope],
		});
		if (input.recovery) {
			toast.success("Working folder saved. Checking Agent availability…");
			input.onOpenChange(false);
			input.recovery.onSaved();
			return;
		}
		toast.success(message);
	};
	const run = async (folderId: string, action: () => Promise<void>) => {
		setPendingFolderId(folderId);
		setError(null);
		try {
			await action();
		} catch (failure) {
			setError(
				toStructuredApiClientFailure(failure).message ||
					"Couldn’t change this folder. Try again."
			);
		} finally {
			setPendingFolderId(null);
		}
	};
	const setDefaultProject = async (projectId: string | null) => {
		const updated = await updateAgentProfileDefaultProject({
			actorProfileId: input.actorProfileId,
			defaultProjectId: projectId,
			organizationId: input.organizationId,
			profileId: input.profile.openMeldProfileId,
			...(bindingTarget ? { expectedBindingTarget: bindingTarget } : {}),
		});
		input.onProfileUpdated(updated);
	};
	// Second ordered write after a local default change: a Default Project
	// would otherwise still win. It is cleared even when this opening saw none,
	// because another tab may have set one since.
	const finishLocalDefault = async (message: string): Promise<boolean> => {
		try {
			await setDefaultProject(null);
		} catch {
			setError(
				"The default folder was saved on this Agent’s computer, but OpenMeld couldn’t confirm that the Default Project was cleared. New work may still start in that Project. Choose Make default on that folder to finish."
			);
			return false;
		}
		defaultSaved(message);
		return true;
	};
	const makeDefault = (row: AgentProfileFolderRow) =>
		run(row.folderId, async () => {
			// A Project folder becomes the default through Default Project.
			if (row.kind === "project" && row.projectId) {
				await setDefaultProject(row.projectId);
				defaultSaved(`${row.displayName} is now the default folder.`);
				return;
			}
			// Also for the saved default: choosing it again prepares it again,
			// so a missing OpenMeld folder is recreated before the Project clear.
			await change({ folderId: row.folderId, operation: "set_default" });
			await finishLocalDefault(`${row.displayName} is now the default folder.`);
		});
	// Replaces unreadable settings, or, from recovery, prepares the current
	// default again. A repair is refused by a Service too old to prepare it.
	const repair = async (operation: RepairOperation) => {
		setError(null);
		const result = await change(operation);
		const repaired = result.projection.folders.find(
			(folder) => folder.folderId === result.folderId
		);
		await finishLocalDefault(
			repaired
				? `${repaired.displayName} is now the default folder.`
				: "Working folder updated."
		);
	};
	const setUpAgain = (row: AgentProfileFolderRow, path: string | null) => {
		if (row.kind === "custom" && !path) {
			return undefined;
		}
		return () =>
			run(row.folderId, () =>
				repair({
					folder:
						row.kind === "custom" && path
							? { kind: "custom", path }
							: { kind: "openmeld_managed" },
					operation: "repair",
				})
			);
	};
	const canSetUpAgain =
		Boolean(input.recovery) && !input.profile.defaultProjectId;

	return (
		<div className="grid gap-4">
			{input.recovery ? (
				<output className="text-sm">{input.recovery.message}</output>
			) : null}
			<FolderListStatus
				configurationInvalid={configurationInvalid}
				defaultProjectName={defaultProjectName}
				error={foldersQuery.isError ? foldersQuery.error : null}
				loading={foldersQuery.isPending}
				onRetry={() => foldersQuery.refetch()}
				response={response}
			/>
			{rows.length > 0 ? (
				<ul aria-label="Folders" className="grid gap-2">
					{rows.map((row) => (
						<FolderRow
							defaultPath={row.isDefault ? defaultPath : null}
							disabled={!writable || pendingFolderId !== null}
							key={row.folderId}
							localDefaultBlocked={localDefaultBlocked}
							onMakeDefault={() => makeDefault(row)}
							onRemove={() =>
								run(row.folderId, async () => {
									await change({
										folderId: row.folderId,
										operation: "remove",
									});
									toast.success(`${row.displayName} was removed.`);
								})
							}
							onRename={(displayName) =>
								run(row.folderId, async () => {
									await change({
										displayName,
										folderId: row.folderId,
										operation: "rename",
									});
								})
							}
							onSetUpAgain={
								row.isDefault && canSetUpAgain
									? setUpAgain(row, defaultPath)
									: undefined
							}
							pending={pendingFolderId === row.folderId}
							row={row}
						/>
					))}
				</ul>
			) : null}
			{response?.status === "current" && rows.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No folders yet. Add one to choose where this Agent works.
				</p>
			) : null}
			<FolderEditPanel
				addDisabled={!writable || pendingFolderId !== null}
				adding={adding}
				configurationInvalid={configurationInvalid}
				hasBindingTarget={Boolean(bindingTarget)}
				onAdd={async (operation) => {
					const result = await change(operation);
					setAdding(false);
					const added = result.projection.folders.find(
						(folder) => folder.folderId === result.folderId
					);
					toast.success(
						added ? `${added.displayName} was added.` : "Folder added."
					);
				}}
				onAddingChange={setAdding}
				onRepair={repair}
				organizationId={input.organizationId}
				projects={projectsQuery.data?.projects ?? []}
				repairDisabled={!reviewed || localDefaultBlocked}
				target={response?.target ?? input.target}
			/>
			<FolderListNotes
				eligibility={input.executionTargetChangeEligibilityStatus}
				error={error}
				saveBlockedReason={saveBlockedReason}
				targetChanged={targetChanged}
			/>
		</div>
	);
}

function FolderListStatus(input: {
	configurationInvalid: boolean;
	defaultProjectName: string | null;
	error: unknown;
	loading: boolean;
	onRetry: () => void;
	response: GetAgentProfileFoldersResponse | undefined;
}) {
	const notice = input.configurationInvalid
		? "This Agent’s saved folder settings on its computer can’t be read. Choose the folder new work starts in to replace them."
		: folderListNotice(input.response);
	return (
		<>
			{input.loading ? (
				<output className="text-muted-foreground text-sm">
					Loading folders…
				</output>
			) : null}
			{input.error ? (
				<p className="text-destructive text-sm" role="alert">
					{toStructuredApiClientFailure(input.error).message ||
						"Couldn’t read this Agent’s folders."}{" "}
					<button className="underline" onClick={input.onRetry} type="button">
						Try again
					</button>
				</p>
			) : null}
			{notice ? (
				<output className="text-muted-foreground text-sm">{notice}</output>
			) : null}
			{input.defaultProjectName ? (
				<p className="text-muted-foreground text-sm">
					New work starts in {input.defaultProjectName}. Making a folder on this
					computer the default clears the Default Project.
				</p>
			) : null}
		</>
	);
}

function FolderListNotes(input: {
	eligibility: FoldersDialogInput["executionTargetChangeEligibilityStatus"];
	error: string | null;
	saveBlockedReason?: string;
	targetChanged: boolean;
}) {
	return (
		<>
			{input.saveBlockedReason ? (
				<output className="text-muted-foreground text-sm">
					{input.saveBlockedReason}
				</output>
			) : null}
			{input.targetChanged ? (
				<output className="text-muted-foreground text-sm">
					This Agent’s Computer or local agent changed. Close and reopen Working
					folder to review its current folders.
				</output>
			) : null}
			{input.eligibility === "allowed" ? null : (
				<p className="text-muted-foreground text-sm">
					{input.eligibility === "blocked"
						? "This Agent is working. Wait until this task finishes to change its default folder on this computer."
						: "OpenMeld can’t check whether this Agent is working. Try again before changing its default folder on this computer."}
				</p>
			)}
			<p className="text-muted-foreground text-xs">
				{FUTURE_WAKES_PROJECT_SETTINGS_NOTICE}
			</p>
			{input.error ? (
				<p className="text-destructive text-sm" role="alert">
					{input.error}
				</p>
			) : null}
		</>
	);
}

function FolderRow(input: {
	defaultPath: string | null;
	disabled: boolean;
	localDefaultBlocked: boolean;
	onMakeDefault: () => void;
	onRemove: () => void;
	onRename: (displayName: string) => void;
	onSetUpAgain?: () => void;
	pending: boolean;
	row: AgentProfileFolderRow;
}) {
	const [renaming, setRenaming] = useState(false);
	const [confirmingRemove, setConfirmingRemove] = useState(false);
	const [name, setName] = useState(input.row.displayName);
	const row = input.row;
	const trimmedName = name.trim();
	return (
		<li className="grid gap-2 rounded-md border p-3">
			<div className="flex items-start gap-2">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="truncate font-medium">{row.displayName}</span>
						{row.effectiveDefault ? (
							<Badge variant="secondary">Default</Badge>
						) : null}
					</div>
					<p className="text-muted-foreground text-xs">{row.kindLabel}</p>
					{input.defaultPath ? (
						<p
							className="truncate font-mono text-muted-foreground text-xs"
							title={input.defaultPath}
						>
							{input.defaultPath}
						</p>
					) : null}
				</div>
				{input.pending ? (
					<output className="text-muted-foreground text-xs">Saving…</output>
				) : null}
			</div>
			{renaming ? (
				<form
					className="flex gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						// The list can turn read-only while this editor is open.
						if (
							!input.disabled &&
							trimmedName &&
							trimmedName !== row.displayName
						) {
							input.onRename(trimmedName);
						}
						setRenaming(false);
					}}
				>
					<Input
						aria-label={`Name for ${row.displayName}`}
						maxLength={120}
						onChange={(event) => setName(event.target.value)}
						value={name}
					/>
					<Button
						disabled={input.disabled || !trimmedName}
						type="submit"
						variant="outline"
					>
						Save
					</Button>
					<Button
						onClick={() => {
							setName(row.displayName);
							setRenaming(false);
						}}
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
				</form>
			) : null}
			{confirmingRemove ? (
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-sm">
						Remove {row.displayName}? Its files stay on your computer.
					</span>
					<Button
						disabled={input.disabled}
						onClick={() => {
							setConfirmingRemove(false);
							input.onRemove();
						}}
						variant="destructive"
					>
						Remove
					</Button>
					<Button onClick={() => setConfirmingRemove(false)} variant="ghost">
						Cancel
					</Button>
				</div>
			) : null}
			{renaming || confirmingRemove ? null : (
				<div className="flex flex-wrap gap-2">
					{input.onSetUpAgain ? (
						<Button
							disabled={input.disabled || input.localDefaultBlocked}
							onClick={input.onSetUpAgain}
							size="sm"
							variant="outline"
						>
							Set up again
						</Button>
					) : null}
					{row.effectiveDefault ? null : (
						<Button
							disabled={
								input.disabled ||
								(row.kind !== "project" && input.localDefaultBlocked)
							}
							onClick={input.onMakeDefault}
							size="sm"
							variant="outline"
						>
							Make default
						</Button>
					)}
					<Button
						disabled={input.disabled}
						onClick={() => setRenaming(true)}
						size="sm"
						variant="ghost"
					>
						Rename
					</Button>
					<Button
						disabled={input.disabled || row.removeBlockedReason !== null}
						onClick={() => setConfirmingRemove(true)}
						size="sm"
						title={row.removeBlockedReason ?? undefined}
						variant="ghost"
					>
						Remove
					</Button>
				</div>
			)}
		</li>
	);
}

/**
 * Adds a folder, or, when the saved settings can't be read, repairs them by
 * choosing the folder new work starts in.
 */
function FolderEditPanel(input: {
	addDisabled: boolean;
	adding: boolean;
	configurationInvalid: boolean;
	hasBindingTarget: boolean;
	onAdd: (operation: FolderChange) => Promise<void>;
	onAddingChange: (adding: boolean) => void;
	onRepair: (operation: RepairOperation) => Promise<void>;
	organizationId: string;
	projects: Parameters<typeof AgentProfileProjectSelector>[0]["projects"];
	repairDisabled: boolean;
	target?: PeopleComputerTarget;
}) {
	if (input.configurationInvalid) {
		return input.hasBindingTarget ? (
			<AddFolderPanel
				disabled={input.repairDisabled}
				mode="repair"
				onAdd={async (operation) => {
					if (operation.operation === "repair") {
						await input.onRepair(operation);
					}
				}}
				organizationId={input.organizationId}
				projects={[]}
				target={input.target}
			/>
		) : null;
	}
	if (input.adding && input.hasBindingTarget) {
		return (
			<AddFolderPanel
				disabled={input.addDisabled}
				mode="add"
				onAdd={input.onAdd}
				onCancel={() => input.onAddingChange(false)}
				organizationId={input.organizationId}
				projects={input.projects}
				target={input.target}
			/>
		);
	}
	return (
		<div>
			<Button
				disabled={input.addDisabled}
				onClick={() => input.onAddingChange(true)}
				variant="outline"
			>
				Add folder
			</Button>
		</div>
	);
}

function AddFolderPanel(input: {
	disabled: boolean;
	/** "repair" replaces unreadable folder settings with one default folder. */
	mode: "add" | "repair";
	onAdd: (operation: FolderChange) => Promise<void>;
	onCancel?: () => void;
	organizationId: string;
	projects: Parameters<typeof AgentProfileProjectSelector>[0]["projects"];
	target?: PeopleComputerTarget;
}) {
	const [projectId, setProjectId] = useState("");
	const [connection, setConnection] =
		useState<LocalProjectControlConnection | null>(null);
	const [source, setSource] = useState<
		"advanced" | "managed" | "project" | null
	>(null);
	const [path, setPath] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	let operation: FolderChange | null = null;
	if (input.mode === "repair") {
		if (source === "managed") {
			operation = {
				folder: { kind: "openmeld_managed" },
				operation: "repair",
			};
		} else if (source === "advanced" && path.trim()) {
			operation = {
				folder: { kind: "custom", path: path.trim() },
				operation: "repair",
			};
		}
	} else if (projectId && connection) {
		operation = {
			operation: "add_project",
			organizationId: input.organizationId,
			projectId,
		};
	} else if (!projectId && source === "managed") {
		operation = { operation: "add_openmeld_managed" };
	} else if (!projectId && source === "advanced" && path.trim()) {
		operation = { operation: "add_custom", path: path.trim() };
	}
	return (
		<div className="grid gap-3 rounded-md border p-3">
			<AgentProfileProjectSelector
				disabled={input.disabled || pending}
				localFoldersOnly={input.mode === "repair"}
				manualPath={path}
				onConnectionReady={setConnection}
				onManualPathChange={(value) => {
					setPath(value);
					setError(null);
				}}
				onProjectChange={(value) => {
					setProjectId(value);
					setConnection(null);
					setSource(null);
					setError(null);
				}}
				onUseAdvancedWorkspace={() => setSource("advanced")}
				onUseManagedWorkspace={() => setSource("managed")}
				onUseProjectWorkspace={() => setSource("project")}
				organizationId={input.organizationId}
				projectId={projectId}
				projects={input.projects}
				selectedBindingGeneration={connection?.bindingGeneration ?? null}
				target={input.target}
				workspaceFallbackMode={source}
			/>
			{error ? (
				<p className="text-destructive text-sm" role="alert">
					{error}
				</p>
			) : null}
			<div className="flex justify-end gap-2">
				{input.onCancel ? (
					<Button disabled={pending} onClick={input.onCancel} variant="ghost">
						Cancel
					</Button>
				) : null}
				<Button
					disabled={input.disabled || pending || operation === null}
					onClick={async () => {
						if (!operation) {
							return;
						}
						setPending(true);
						setError(null);
						try {
							await input.onAdd(operation);
						} catch (failure) {
							setError(
								toStructuredApiClientFailure(failure).message ||
									"Couldn’t save this folder. Try again."
							);
						} finally {
							setPending(false);
						}
					}}
				>
					{addFolderButtonLabel(input.mode, pending)}
				</Button>
			</div>
		</div>
	);
}

function sameBindingTarget(
	left: AgentProfileBindingTarget | undefined,
	right: AgentProfileBindingTarget | undefined
): boolean {
	return (
		left?.bindingId === right?.bindingId &&
		left?.openMeldServiceRuntimeId === right?.openMeldServiceRuntimeId &&
		left?.agentControllerRef === right?.agentControllerRef &&
		left?.agentControllerConversationId === right?.agentControllerConversationId
	);
}

function addFolderButtonLabel(mode: "add" | "repair", pending: boolean) {
	if (mode === "repair") {
		return pending ? "Saving…" : "Use this folder";
	}
	return pending ? "Adding…" : "Add folder";
}
