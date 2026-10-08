"use client";

import { createFileRootApi } from "@openmeld/api-client";
import { isSpaceFileTextEditable } from "@openmeld/schemas";
import type { SpaceFileDescriptor } from "@openmeld/schemas/types";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@openmeld/ui/components/alert-dialog";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { SpaceFileBrowser } from "./space-file-browser";
import { SpaceFileDetail } from "./space-file-detail";
import {
	FolderNameDialog,
	NewTextFileDialog,
	SpaceFileEntryDialogs,
} from "./space-file-dialogs";
import { SpaceFileMaintenanceDialog } from "./space-file-maintenance-dialog";
import { SpaceFileUpdateSettingsDialog } from "./space-file-update-settings-dialog";
import { resolveSpaceFileErrorMessage } from "./space-file-utils";
import {
	type SpaceFilesPanelProps,
	useSpaceFilesPanelController,
} from "./use-space-files-panel-controller";

const NEW_TEXT_FILE_MIME_TYPES = {
	markdown: "text/markdown",
	text: "text/plain",
	csv: "text/csv",
} as const;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This panel coordinates Space Files browsing, editing, maintenance, and cross-location copy dialogs.
export function SpaceFilesPanel(input: SpaceFilesPanelProps) {
	const organization = useOptionalAppOrganization();
	const [copyingFile, setCopyingFile] = useState<{
		file: SpaceFileDescriptor;
		destination: "team" | "my";
		clientMutationId: string;
	} | null>(null);
	const [collaborationDialog, setCollaborationDialog] = useState<
		"notifications" | "maintenance" | null
	>(null);
	const {
		actionError,
		api,
		canWrite,
		changeView,
		entryDialog,
		fileInputRef,
		filesQuery,
		folderDialogOpen,
		newTextFileKind,
		moveEntry,
		parentId,
		pendingAction,
		uploadProgress,
		refreshFiles,
		restoreEntry,
		renameEntry,
		runAction,
		selectedFile,
		selectedInitialRevision,
		selectedOpenRequestId,
		selectFile,
		setActionError,
		setEntryDialog,
		setFolderDialogOpen,
		setNewTextFileKind,
		setParentId,
		trashEntry,
		uploadFiles,
		view,
	} = useSpaceFilesPanelController(input);

	if (selectedFile) {
		return (
			<>
				<SpaceFileDetail
					api={api}
					canWrite={canWrite}
					file={selectedFile}
					initialRevision={selectedInitialRevision}
					key={`${selectedFile.id}:${selectedInitialRevision ?? "latest"}:${selectedOpenRequestId ?? "manual"}`}
					onBack={() => selectFile(null)}
					onFileChanged={(file) => {
						selectFile(file);
						refreshFiles().catch(() => undefined);
					}}
					onLeaveGuardChange={input.onLeaveGuardChange}
					onMaintain={
						organization && isSpaceFileTextEditable(selectedFile.latestRevision)
							? () => setCollaborationDialog("maintenance")
							: undefined
					}
					onMove={() => setEntryDialog({ entry: selectedFile, kind: "move" })}
					onRename={() =>
						setEntryDialog({ entry: selectedFile, kind: "rename" })
					}
					onTrash={() => setEntryDialog({ entry: selectedFile, kind: "trash" })}
					onUpdateSettings={() => setCollaborationDialog("notifications")}
					openMeldProfileId={input.openMeldProfileId}
					organizationSlug={input.organizationSlug}
					spaceId={input.spaceId}
				/>
				{collaborationDialog === "notifications" ? (
					<SpaceFileUpdateSettingsDialog
						api={api}
						file={selectedFile}
						key={selectedFile.id}
						onClose={() => setCollaborationDialog(null)}
						profileId={input.openMeldProfileId}
						spaceId={input.spaceId}
					/>
				) : null}
				{collaborationDialog === "maintenance" && organization ? (
					<SpaceFileMaintenanceDialog
						file={selectedFile}
						key={selectedFile.id}
						onClose={() => setCollaborationDialog(null)}
						organizationId={organization.currentOrganization.id}
						orgSlug={organization.currentOrganization.slug}
						spaceId={input.spaceId}
					/>
				) : null}
				<SpaceFileEntryDialogs
					api={api}
					dialog={entryDialog}
					onClose={() => setEntryDialog({ kind: "closed" })}
					onMove={moveEntry}
					onRename={renameEntry}
					onTrash={trashEntry}
					pendingAction={pendingAction}
					spaceId={input.spaceId}
				/>
			</>
		);
	}

	return (
		<>
			{uploadProgress !== null && (
				<output className="px-4 py-2 text-muted-foreground text-sm">
					{uploadProgress < 100
						? `Uploading files… ${uploadProgress}%`
						: "Finishing upload…"}
				</output>
			)}
			<SpaceFileBrowser
				actionError={actionError}
				api={api}
				breadcrumbs={filesQuery.data?.breadcrumbs ?? []}
				busy={pendingAction !== null}
				canWrite={canWrite}
				entries={filesQuery.data?.entries ?? []}
				error={filesQuery.isError ? filesQuery.error : null}
				fileInputRef={fileInputRef}
				isPaused={filesQuery.fetchStatus === "paused"}
				isPending={filesQuery.isPending}
				loaded={filesQuery.data !== undefined}
				onCopy={
					organization && !organization.currentOrganization.isPersonal
						? (file, destination) =>
								setCopyingFile({
									file,
									destination,
									clientMutationId: crypto.randomUUID(),
								})
						: undefined
				}
				onDismissError={() => setActionError(null)}
				onMove={(entry) => setEntryDialog({ entry, kind: "move" })}
				onNewFolder={() => setFolderDialogOpen(true)}
				onNewTextFile={setNewTextFileKind}
				onOpen={(entry) => {
					if (view === "trash") {
						return;
					}
					if (entry.kind === "folder") {
						setParentId(entry.id);
						return;
					}
					selectFile(entry);
				}}
				onOpenBreadcrumb={(folderId, name) => {
					if (view === "trash") {
						if (name === "Files") {
							changeView("active");
						}
						return;
					}
					setParentId(folderId);
				}}
				onRename={(entry) => setEntryDialog({ entry, kind: "rename" })}
				onRestore={restoreEntry}
				onRetry={() => filesQuery.refetch()}
				onTrash={(entry) => setEntryDialog({ entry, kind: "trash" })}
				onUploadFiles={uploadFiles}
				onViewChange={changeView}
				spaceId={input.spaceId}
				view={view}
			/>
			<FolderNameDialog
				onOpenChange={setFolderDialogOpen}
				onSubmit={async (name) => {
					const succeeded = await runAction("create-folder", async () =>
						api.createFolder({
							spaceId: input.spaceId,
							body: {
								name,
								parentId,
								clientMutationId: crypto.randomUUID(),
							},
						})
					);
					if (succeeded) {
						setFolderDialogOpen(false);
					}
				}}
				open={folderDialogOpen}
				pending={pendingAction === "create-folder"}
			/>
			{newTextFileKind ? (
				<NewTextFileDialog
					kind={newTextFileKind}
					onOpenChange={(open) => {
						if (!open) {
							setNewTextFileKind(null);
						}
					}}
					onSubmit={async ({ content, name }) => {
						let createdFile: SpaceFileDescriptor | null = null;
						const succeeded = await runAction(
							"create-text-file",
							async () =>
								await api.uploadFile({
									spaceId: input.spaceId,
									name,
									parentId,
									clientMutationId: crypto.randomUUID(),
									mimeType: NEW_TEXT_FILE_MIME_TYPES[newTextFileKind],
									origin: "artifact",
									bytes: new TextEncoder().encode(content),
								}),
							(file) => {
								createdFile = file;
							}
						);
						if (succeeded) {
							setNewTextFileKind(null);
							selectFile(createdFile);
						}
					}}
					open={true}
					pending={pendingAction === "create-text-file"}
				/>
			) : null}
			<SpaceFileEntryDialogs
				api={api}
				dialog={entryDialog}
				onClose={() => setEntryDialog({ kind: "closed" })}
				onMove={moveEntry}
				onRename={renameEntry}
				onTrash={trashEntry}
				pendingAction={pendingAction}
				spaceId={input.spaceId}
			/>
			{copyingFile && organization ? (
				<SpaceFileCopyDialog
					choice={copyingFile}
					onClose={() => setCopyingFile(null)}
					organizationId={organization.currentOrganization.id}
					profileId={input.openMeldProfileId}
					spaceId={input.spaceId}
				/>
			) : null}
		</>
	);
}

function SpaceFileCopyDialog(input: {
	choice: {
		file: SpaceFileDescriptor;
		destination: "team" | "my";
		clientMutationId: string;
	};
	onClose: () => void;
	organizationId: string;
	profileId?: string;
	spaceId: string;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const api = useMemo(
		() =>
			createFileRootApi(
				createOrganizationScopedWebOpenMeldApiFoundation({
					organizationId: input.organizationId,
					...(input.profileId ? { openMeldProfileId: input.profileId } : {}),
				})
			),
		[input.organizationId, input.profileId]
	);
	const destinationName =
		input.choice.destination === "team" ? "Team files" : "My files";
	return (
		<AlertDialog onOpenChange={(open) => !open && input.onClose()} open>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						Copy {input.choice.file.name} to {destinationName}?
					</AlertDialogTitle>
					<AlertDialogDescription>
						{input.choice.destination === "team"
							? "Team members will be able to open this copy."
							: "Only you can open this copy."}{" "}
						The Space original stays where it is. The copy keeps this version
						and won’t follow later changes.
					</AlertDialogDescription>
				</AlertDialogHeader>
				{error ? (
					<p className="text-destructive text-sm" role="alert">
						{error}
					</p>
				) : null}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						disabled={busy}
						onClick={(event) => {
							event.preventDefault();
							setBusy(true);
							setError(null);
							api
								.copyRevision({
									location: input.choice.destination,
									body: {
										sourceLocation: "space",
										sourceSpaceId: input.spaceId,
										sourceFileId: input.choice.file.id,
										sourceRevision: input.choice.file.latestRevision.revision,
										name: input.choice.file.name,
										parentId: null,
										clientMutationId: input.choice.clientMutationId,
									},
								})
								.then(() => {
									input.onClose();
									toast.success(`Copied to ${destinationName}.`);
								})
								.catch((cause) => {
									setError(resolveSpaceFileErrorMessage(cause));
								})
								.finally(() => setBusy(false));
						}}
						type="button"
					>
						Copy file
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
