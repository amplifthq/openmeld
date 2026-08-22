"use client";

import type { SpaceFileDescriptor } from "@openmeld/schemas/types";
import { SpaceFileBrowser } from "./space-file-browser";
import { SpaceFileDetail } from "./space-file-detail";
import {
	FolderNameDialog,
	NewMarkdownFileDialog,
	SpaceFileEntryDialogs,
} from "./space-file-dialogs";
import {
	type SpaceFilesPanelProps,
	useSpaceFilesPanelController,
} from "./use-space-files-panel-controller";

export function SpaceFilesPanel(input: SpaceFilesPanelProps) {
	const {
		actionError,
		api,
		canWrite,
		entryDialog,
		fileInputRef,
		filesQuery,
		folderDialogOpen,
		markdownFileDialogOpen,
		moveEntry,
		parentId,
		pendingAction,
		refreshFiles,
		renameEntry,
		runAction,
		selectedFile,
		setActionError,
		setEntryDialog,
		setFolderDialogOpen,
		setMarkdownFileDialogOpen,
		setParentId,
		setSelectedFile,
		trashEntry,
		uploadFiles,
	} = useSpaceFilesPanelController(input);

	if (selectedFile) {
		return (
			<>
				<SpaceFileDetail
					api={api}
					canWrite={canWrite}
					file={selectedFile}
					onBack={() => setSelectedFile(null)}
					onFileChanged={(file) => {
						setSelectedFile(file);
						refreshFiles().catch(() => undefined);
					}}
					onMove={() => setEntryDialog({ entry: selectedFile, kind: "move" })}
					onRename={() =>
						setEntryDialog({ entry: selectedFile, kind: "rename" })
					}
					onTrash={() => setEntryDialog({ entry: selectedFile, kind: "trash" })}
					spaceId={input.spaceId}
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

	return (
		<>
			<SpaceFileBrowser
				actionError={actionError}
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
					if (entry.kind === "folder") {
						setParentId(entry.id);
						return;
					}
					setSelectedFile(entry);
				}}
				onOpenBreadcrumb={setParentId}
				onRename={(entry) => setEntryDialog({ entry, kind: "rename" })}
				onRetry={() => filesQuery.refetch()}
				onTrash={(entry) => setEntryDialog({ entry, kind: "trash" })}
				onUploadFiles={uploadFiles}
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
						setSelectedFile(createdFile);
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
