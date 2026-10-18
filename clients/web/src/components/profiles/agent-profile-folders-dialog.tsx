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
	storageScope: string;
	target?: PeopleComputerTarget;
};

type FolderChange = Exclude<ProfileFolderOperation, { operation: "list" }>;

/** Owner-only list of an Agent's folders on its Computer. */
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
					<DialogTitle>Folders</DialogTitle>
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
	const projection =
		response && response.status !== "unavailable" ? response.projection : null;
	const rows = projection
		? buildAgentProfileFolderRows({
				defaultProjectId: input.profile.defaultProjectId,
				projection,
			})
		: [];
	const bindingTarget = input.expectedBindingTarget;
	// Writes need the Computer to answer; a recorded list is read-only.
	const writable = Boolean(bindingTarget) && response?.status === "current";
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

	const applied = (result: ManageAgentProfileFoldersResponse) => {
		const current: GetAgentProfileFoldersResponse = {
			agentProfileId: result.agentProfileId,
			observedAtMs: result.observedAtMs,
			projection: result.projection,
			status: "current",
			target: result.target,
		};
		queryClient.setQueryData(foldersQueryOptions.queryKey, current);
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
		applied(result);
		return result;
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
	const makeDefault = (row: AgentProfileFolderRow) =>
		run(row.folderId, async () => {
			// A Project folder becomes the default through Default Project.
			if (row.kind === "project" && row.projectId) {
				await setDefaultProject(row.projectId);
			} else {
				await change({ folderId: row.folderId, operation: "set_default" });
				// Second ordered write: a Default Project would otherwise still win.
				if (input.profile.defaultProjectId) {
					try {
						await setDefaultProject(null);
					} catch {
						throw new Error(
							"The default folder was saved on this Agent’s computer, but its Default Project couldn’t be cleared, so new work still starts in that Project. Try again."
						);
					}
				}
			}
			queryClient.invalidateQueries({
				queryKey: ["private-working-folder", input.storageScope],
			});
			toast.success(`${row.displayName} is now the default folder.`);
		});

	return (
		<div className="grid gap-4">
			<FolderListStatus
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
			{adding && bindingTarget ? (
				<AddFolderPanel
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
					onCancel={() => setAdding(false)}
					organizationId={input.organizationId}
					projects={projectsQuery.data?.projects ?? []}
					target={response?.target ?? input.target}
				/>
			) : (
				<div>
					<Button
						disabled={!writable || pendingFolderId !== null}
						onClick={() => setAdding(true)}
						variant="outline"
					>
						Add folder
					</Button>
				</div>
			)}
			<FolderListNotes
				eligibility={input.executionTargetChangeEligibilityStatus}
				error={error}
			/>
		</div>
	);
}

function FolderListStatus(input: {
	defaultProjectName: string | null;
	error: unknown;
	loading: boolean;
	onRetry: () => void;
	response: GetAgentProfileFoldersResponse | undefined;
}) {
	const notice = folderListNotice(input.response);
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
}) {
	return (
		<>
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
						if (trimmedName && trimmedName !== row.displayName) {
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
					<Button disabled={!trimmedName} type="submit" variant="outline">
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

function AddFolderPanel(input: {
	onAdd: (operation: FolderChange) => Promise<void>;
	onCancel: () => void;
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
	if (projectId && connection) {
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
				disabled={pending}
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
				<Button disabled={pending} onClick={input.onCancel} variant="ghost">
					Cancel
				</Button>
				<Button
					disabled={pending || operation === null}
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
									"Couldn’t add this folder. Try again."
							);
						} finally {
							setPending(false);
						}
					}}
				>
					{pending ? "Adding…" : "Add folder"}
				</Button>
			</div>
		</div>
	);
}
