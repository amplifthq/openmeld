"use client";

import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	AgentProfileBindingTarget,
	AuthProfileView,
	GetAgentProfileFoldersResponse,
	ManageAgentProfileFoldersResponse,
	PeopleComputerTarget,
	ProfileFolderOperation,
	ProfileFolderProjectionEntry,
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
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { clearPendingAgentProfileCreationLocalSetupForProfile } from "#/lib/profiles/agent-profile-creation-local-setup";
import { manageAgentProfileFolders } from "#/lib/profiles/agent-profile-folders";
import { updateAgentProfileDefaultProject } from "#/lib/profiles/update-default-project";
import { projectsQueryOptions } from "#/query/organizations/projects";
import { agentProfileFoldersQueryOptions } from "#/query/profiles/agent-profile-folders";
import { agentProfileWorkingFolderQueryOptions } from "#/query/profiles/working-folder";
import { AgentProfileDirectFolderFlow } from "./agent-profile-direct-folder-flow";
import {
	type AgentProfileFolderRow,
	buildAgentProfileFolderRows,
	folderListNotice,
} from "./agent-profile-folders-model";
import { shouldShowAgentProfileProjectSettings } from "./agent-profile-project-settings";

type FoldersDialogInput = {
	actorProfileId: string | null;
	agentControllerRef: string | null;
	executionTargetChangeEligibilityStatus: "allowed" | "blocked" | "unavailable";
	expectedBindingTarget?: AgentProfileBindingTarget;
	onOpenChange: (open: boolean) => void;
	/** Runs once the open or close animation has finished. */
	onOpenChangeComplete?: (open: boolean) => void;
	onProfileUpdated: (profile: AuthProfileView) => void;
	open: boolean;
	organizationId: string;
	/**
	 * The caller is still reading the Agent's Computer: the dialog shows its
	 * loading layout, or the failure with a retry, instead of the folders.
	 */
	preparing?: { failed: boolean; onRetry: () => void };
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
 * Owner-only Folder action: opens the bound Computer's native picker first.
 * Saved-folder controls are available as a secondary recovery option.
 */
export function AgentProfileFoldersDialog(input: FoldersDialogInput) {
	if (
		!(
			input.open &&
			shouldShowAgentProfileProjectSettings({
				agentControllerRef: input.agentControllerRef,
				managedRole: input.profile.managedRole,
			})
		)
	) {
		return null;
	}
	const close = () => {
		input.onOpenChange(false);
		input.onOpenChangeComplete?.(false);
	};
	return (
		<AgentProfileDirectFolderFlow
			actorProfileId={input.actorProfileId}
			eligibility={input.executionTargetChangeEligibilityStatus}
			expectedBindingTarget={input.expectedBindingTarget}
			key={`${input.organizationId}:${input.profile.openMeldProfileId}`}
			onClose={close}
			onProfileUpdated={input.onProfileUpdated}
			onSaved={input.recovery?.onSaved}
			organizationId={input.organizationId}
			preparing={input.preparing}
			profileId={input.profile.openMeldProfileId}
			renderSavedFolders={() => (
				<SavedAgentProfileFoldersDialog
					{...input}
					onOpenChange={(open) => !open && close()}
				/>
			)}
			saveBlockedReason={input.recovery?.saveBlockedReason}
			storageScope={input.storageScope}
			target={input.target}
		/>
	);
}

export function SavedAgentProfileFoldersDialog(input: FoldersDialogInput) {
	// The body stays until the close animation ends, so the dialog leaves with
	// the content it showed instead of collapsing to its header first.
	const [closing, setClosing] = useState(false);
	const [wasOpen, setWasOpen] = useState(input.open);
	if (wasOpen !== input.open) {
		setWasOpen(input.open);
		setClosing(!input.open);
	}
	if (
		!shouldShowAgentProfileProjectSettings({
			agentControllerRef: input.agentControllerRef,
			managedRole: input.profile.managedRole,
		})
	) {
		return null;
	}
	return (
		<Dialog
			onOpenChange={(open) => input.onOpenChange(open)}
			onOpenChangeComplete={(open) => {
				if (!open) {
					setClosing(false);
				}
				input.onOpenChangeComplete?.(open);
			}}
			open={input.open}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Saved folders</DialogTitle>
					<DialogDescription className="sr-only">
						Manage folders saved for {input.profile.profileName}.
					</DialogDescription>
				</DialogHeader>
				{input.open || closing ? (
					<FoldersDialogBodyOrPreparing {...input} />
				) : null}
				<DialogFooter>
					<Button onClick={() => input.onOpenChange(false)} variant="ghost">
						Done
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function FoldersDialogBodyOrPreparing(input: FoldersDialogInput) {
	if (!input.preparing) {
		return <FoldersDialogBody {...input} />;
	}
	if (!input.preparing.failed) {
		return <FoldersDialogSkeleton message={input.recovery?.message} />;
	}
	return (
		<p className="text-muted-foreground text-sm" role="alert">
			Couldn’t confirm this Agent’s Computer and settings.{" "}
			<button
				className="underline"
				onClick={input.preparing.onRetry}
				type="button"
			>
				Try again
			</button>
		</p>
	);
}

function resolveFolderRows(input: {
	defaultProjectId: string | null | undefined;
	response: GetAgentProfileFoldersResponse | undefined;
}): AgentProfileFolderRow[] {
	const response = input.response;
	if (!response || response.status === "unavailable") {
		return [];
	}
	return buildAgentProfileFolderRows({
		defaultProjectId: input.defaultProjectId,
		projection: response.projection,
	});
}

function folderDetailsPending(input: {
	defaultPathPending: boolean;
	foldersPending: boolean;
	hasTarget: boolean;
}): boolean {
	return input.foldersPending || (input.hasTarget && input.defaultPathPending);
}

/**
 * Keep the optional saved folder list stable while it loads.
 */
function FoldersDialogSkeleton(input: { message?: string }) {
	return (
		<div
			aria-busy="true"
			className="grid min-w-0 grid-cols-1 gap-4"
			data-slot="folders-dialog-skeleton"
		>
			{input.message ? (
				<output className="text-sm">{input.message}</output>
			) : null}
			<output className="sr-only">Loading folders…</output>
			<div className="grid min-w-0 grid-cols-1 gap-2">
				<FolderRowSkeleton withPath />
				<FolderRowSkeleton />
			</div>
			<Skeleton className="h-8 w-24" />
		</div>
	);
}

function FolderRowSkeleton(input: { withPath?: boolean }) {
	return (
		<div className="grid gap-2 rounded-md border p-3">
			<div className="grid gap-1.5">
				<Skeleton className="h-4 w-32" />
				<Skeleton className="h-3 w-40" />
				{input.withPath ? <Skeleton className="h-3 w-72" /> : null}
			</div>
			<div className="flex gap-2">
				<Skeleton className="h-7 w-24" />
				<Skeleton className="h-7 w-16" />
				<Skeleton className="h-7 w-16" />
			</div>
		</div>
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
	const response = foldersQuery.data;
	const configurationInvalid =
		response !== undefined &&
		response.status !== "current" &&
		response.reasonCode === CONFIGURATION_INVALID;
	const rows = resolveFolderRows({
		defaultProjectId: input.profile.defaultProjectId,
		response,
	});
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
			// Recovery confirms the save itself, once readiness settles.
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
				"The folder was saved, but OpenMeld couldn’t clear the Default Project. Choose Make default again to finish."
			);
			return false;
		}
		defaultSaved(message);
		return true;
	};
	const setDefaultFolder = async (
		row: Pick<
			ProfileFolderProjectionEntry,
			"displayName" | "folderId" | "kind" | "projectId"
		>
	) => {
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
	};
	const makeDefault = (row: AgentProfileFolderRow) =>
		run(row.folderId, () => setDefaultFolder(row));
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
	// Show the folders once they and the default's path are read, not piece
	// by piece: the list, path and notes would otherwise pop in.
	if (
		folderDetailsPending({
			defaultPathPending: defaultPathQuery.isPending,
			foldersPending: foldersQuery.isPending,
			hasTarget: Boolean(input.target),
		})
	) {
		return <FoldersDialogSkeleton message={input.recovery?.message} />;
	}

	// Grids here use minmax(0, 1fr) columns and min-w-0 so a long folder path
	// truncates inside the dialog instead of widening it.
	return (
		<div className="grid min-w-0 grid-cols-1 gap-4">
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
				<ul aria-label="Folders" className="grid min-w-0 grid-cols-1 gap-2">
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
			{configurationInvalid || rows.length === 0 || input.recovery ? (
				<div>
					<Button
						disabled={
							!reviewed || localDefaultBlocked || pendingFolderId !== null
						}
						onClick={() =>
							run("managed", () =>
								repair({
									folder: { kind: "openmeld_managed" },
									operation: "repair",
								})
							)
						}
						size="sm"
						variant="outline"
					>
						{pendingFolderId === "managed" ? "Saving…" : "Use OpenMeld folder"}
					</Button>
				</div>
			) : null}

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
		? "This Agent’s saved folders can’t be read."
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
					Default Project: {input.defaultProjectName}
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
		<li className="grid min-w-0 grid-cols-1 gap-2 rounded-md border p-3">
			<div className="flex items-start gap-2">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="truncate font-medium">{row.displayName}</span>
						{row.effectiveDefault ? (
							<Badge variant="secondary">Default</Badge>
						) : null}
					</div>
					<p className="text-muted-foreground text-xs">{row.kindLabel}</p>
					{input.defaultPath ? <FolderPath path={input.defaultPath} /> : null}
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

function FolderPath(input: { path: string }) {
	const cut = input.path.lastIndexOf("/", input.path.length - 2);
	const head = cut > 0 ? input.path.slice(0, cut) : "";
	const tail = cut > 0 ? input.path.slice(cut) : input.path;
	return (
		<TooltipHint content={input.path}>
			<p
				className="flex min-w-0 font-mono text-muted-foreground text-xs"
				data-slot="folder-path"
			>
				<span className="truncate">{head}</span>
				<span className="max-w-full shrink-0 truncate">{tail}</span>
			</p>
		</TooltipHint>
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
