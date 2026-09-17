"use client";

import { isSpaceFileTextEditable } from "@openmeld/schemas";
import type { SpaceFileDescriptor } from "@openmeld/schemas/types";
import { useState } from "react";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { SpaceFileBrowser } from "./space-file-browser";
import { SpaceFileDetail } from "./space-file-detail";
import {
	FolderNameDialog,
	NewMarkdownFileDialog,
	SpaceFileEntryDialogs,
} from "./space-file-dialogs";
import { SpaceFileMaintenanceDialog } from "./space-file-maintenance-dialog";
import { SpaceFileUpdateSettingsDialog } from "./space-file-update-settings-dialog";
import {
	type SpaceFilesPanelProps,
	useSpaceFilesPanelController,
} from "./use-space-files-panel-controller";

export function SpaceFilesPanel(input: SpaceFilesPanelProps) {
	const organization = useOptionalAppOrganization();
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
		markdownFileDialogOpen,
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
		setMarkdownFileDialogOpen,
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
				isPending={filesQuery.isPending}
				loaded={filesQuery.data !== undefined}
				onDismissError={() => setActionError(null)}
				onMove={(entry) => setEntryDialog({ entry, kind: "move" })}
				onNewFolder={() => setFolderDialogOpen(true)}
				onNewMarkdownFile={() => setMarkdownFileDialogOpen(true)}
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
			<NewMarkdownFileDialog
				onOpenChange={setMarkdownFileDialogOpen}
				onSubmit={async ({ content, name }) => {
					let createdFile: SpaceFileDescriptor | null = null;
					const succeeded = await runAction(
						"create-markdown-file",
						async () =>
							await api.uploadFile({
								spaceId: input.spaceId,
								name,
								parentId,
								clientMutationId: crypto.randomUUID(),
								mimeType: "text/markdown",
								bytes: new TextEncoder().encode(content),
							}),
						(file) => {
							createdFile = file;
						}
					);
					if (succeeded) {
						setMarkdownFileDialogOpen(false);
						selectFile(createdFile);
					}
				}}
				open={markdownFileDialogOpen}
				pending={pendingAction === "create-markdown-file"}
			/>
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
