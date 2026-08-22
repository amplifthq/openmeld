"use client";

import type { SpaceApi, SpaceFileContent } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import {
	isSpaceFileTextEditable,
	SPACE_FILE_MAX_SIZE_BYTES,
} from "@openmeld/schemas";
import type {
	SpaceFileDescriptor,
	SpaceFileEntry,
	SpaceFileRevision,
} from "@openmeld/schemas/types";
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
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { Textarea } from "@openmeld/ui/components/textarea";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowClockwiseIcon,
	ArrowLeftIcon,
	CaretRightIcon,
	DotsThreeIcon,
	DownloadSimpleIcon,
	FileIcon,
	FileTextIcon,
	FolderIcon,
	FolderOpenIcon,
	FolderPlusIcon,
	PencilSimpleIcon,
	PlusIcon,
	TrashIcon,
	UploadSimpleIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	createOrganizationScopedWebSpaceApi,
	createUnscopedWebSpaceApi,
} from "#/lib/spaces/api";
import { baseQueryOptions } from "#/query/query-config";
import { spaceFileQueryKeys } from "#/query/spaces/space-files";

type SpaceFilesPanelProps = {
	openMeldProfileId?: string;
	organizationSlug?: string;
	readOnly?: boolean;
	spaceId: string;
};

type EntryDialogState =
	| { kind: "closed" }
	| { entry: SpaceFileEntry; kind: "move" }
	| { entry: SpaceFileEntry; kind: "rename" }
	| { entry: SpaceFileEntry; kind: "trash" };

const ROOT_FOLDER_ID: null = null;

export function SpaceFilesPanel(input: SpaceFilesPanelProps) {
	const api = useMemo(
		() =>
			input.organizationSlug
				? createOrganizationScopedWebSpaceApi({
						organizationSlug: input.organizationSlug,
						...(input.openMeldProfileId
							? { openMeldProfileId: input.openMeldProfileId }
							: {}),
					})
				: createUnscopedWebSpaceApi(
						input.openMeldProfileId
							? { openMeldProfileId: input.openMeldProfileId }
							: {}
					),
		[input.openMeldProfileId, input.organizationSlug]
	);
	const queryClient = useQueryClient();
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [parentId, setParentId] = useState<string | null>(ROOT_FOLDER_ID);
	const [selectedFile, setSelectedFile] = useState<SpaceFileDescriptor | null>(
		null
	);
	const [folderDialogOpen, setFolderDialogOpen] = useState(false);
	const [textFileDialogOpen, setTextFileDialogOpen] = useState(false);
	const [entryDialog, setEntryDialog] = useState<EntryDialogState>({
		kind: "closed",
	});
	const [pendingAction, setPendingAction] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const filesQuery = useQuery({
		queryKey: spaceFileQueryKeys.folder(input.spaceId, parentId),
		queryFn: async ({ signal }) =>
			await api.listFiles({
				spaceId: input.spaceId,
				query: { parentId },
				signal,
			}),
		gcTime: baseQueryOptions.gcTime,
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: 3000,
	});
	const canWrite =
		input.readOnly !== true && filesQuery.data?.capabilities.canWrite === true;

	const refreshFiles = async () => {
		await queryClient.invalidateQueries({
			queryKey: spaceFileQueryKeys.space(input.spaceId),
		});
	};
	const runAction = async <T,>(
		action: string,
		operation: () => Promise<T>,
		onSuccess?: (result: T) => void
	): Promise<boolean> => {
		setPendingAction(action);
		setActionError(null);
		try {
			const result = await operation();
			onSuccess?.(result);
			await refreshFiles();
			return true;
		} catch (error) {
			const message = resolveSpaceFileErrorMessage(error);
			setActionError(message);
			toast.error(message);
			return false;
		} finally {
			setPendingAction(null);
		}
	};
	const uploadFiles = async (files: readonly File[]) => {
		if (files.length === 0) {
			return;
		}
		await runAction("upload", async () => {
			for (const file of files) {
				if (file.size > SPACE_FILE_MAX_SIZE_BYTES) {
					throw new Error(`${file.name} is larger than 10 MiB.`);
				}
				await api.uploadFile({
					spaceId: input.spaceId,
					name: file.name,
					parentId,
					clientMutationId: crypto.randomUUID(),
					mimeType: file.type || "application/octet-stream",
					bytes: file,
				});
			}
		});
	};
	const renameEntry = async (entry: SpaceFileEntry, name: string) => {
		const succeeded = await runAction(
			"rename-entry",
			async () =>
				await api.updateFileEntry({
					spaceId: input.spaceId,
					entryId: entry.id,
					body: {
						name,
						clientMutationId: crypto.randomUUID(),
					},
				}),
			(updatedEntry) => {
				if (updatedEntry.kind === "file" && selectedFile?.id === entry.id) {
					setSelectedFile(updatedEntry);
				}
			}
		);
		if (succeeded) {
			setEntryDialog({ kind: "closed" });
		}
	};
	const moveEntry = async (
		entry: SpaceFileEntry,
		destinationId: string | null
	) => {
		const succeeded = await runAction(
			"move-entry",
			async () =>
				await api.updateFileEntry({
					spaceId: input.spaceId,
					entryId: entry.id,
					body: {
						parentId: destinationId,
						clientMutationId: crypto.randomUUID(),
					},
				}),
			(updatedEntry) => {
				if (updatedEntry.kind === "file" && selectedFile?.id === entry.id) {
					setSelectedFile(updatedEntry);
				}
			}
		);
		if (succeeded) {
			setEntryDialog({ kind: "closed" });
			toast.success(`Moved ${entry.name}`);
		}
	};
	const trashEntry = async (entry: SpaceFileEntry) => {
		const succeeded = await runAction("trash-entry", async () =>
			api.trashFileEntry({
				spaceId: input.spaceId,
				entryId: entry.id,
				clientMutationId: crypto.randomUUID(),
			})
		);
		if (succeeded) {
			setEntryDialog({ kind: "closed" });
			if (selectedFile?.id === entry.id) {
				setSelectedFile(null);
			}
		}
	};

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
				<RenameEntryDialog
					entry={entryDialog.kind === "rename" ? entryDialog.entry : null}
					onOpenChange={(open) => {
						if (!open) {
							setEntryDialog({ kind: "closed" });
						}
					}}
					onSubmit={renameEntry}
					pending={pendingAction === "rename-entry"}
				/>
				<MoveEntryDialog
					api={api}
					entry={entryDialog.kind === "move" ? entryDialog.entry : null}
					onOpenChange={(open) => {
						if (!open) {
							setEntryDialog({ kind: "closed" });
						}
					}}
					onSubmit={moveEntry}
					pending={pendingAction === "move-entry"}
					spaceId={input.spaceId}
				/>
				<TrashEntryDialog
					entry={entryDialog.kind === "trash" ? entryDialog.entry : null}
					onConfirm={trashEntry}
					onOpenChange={(open) => {
						if (!open) {
							setEntryDialog({ kind: "closed" });
						}
					}}
					pending={pendingAction === "trash-entry"}
				/>
			</>
		);
	}

	return (
		<section
			aria-label="Space files"
			className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
		>
			<div className="flex flex-wrap items-center justify-between gap-3 border-border border-b px-5 py-3.5">
				<div className="min-w-0">
					<div className="flex min-w-0 items-center gap-1 text-sm">
						{filesQuery.data?.breadcrumbs.map((crumb, index) => (
							<span
								className="flex min-w-0 items-center gap-1"
								key={crumb.id ?? "root"}
							>
								{index > 0 ? (
									<CaretRightIcon
										aria-hidden="true"
										className="size-3.5 shrink-0 text-muted-foreground"
									/>
								) : null}
								<button
									className={cn(
										"max-w-48 truncate rounded-sm px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
										index === (filesQuery.data?.breadcrumbs.length ?? 0) - 1 &&
											"font-medium text-foreground"
									)}
									onClick={() => setParentId(crumb.id)}
									type="button"
								>
									{crumb.name}
								</button>
							</span>
						))}
					</div>
					<p className="mt-1 text-muted-foreground text-xs">
						Shared with the people and agents in this Space.
					</p>
				</div>
				<div className="flex items-center gap-2">
					{filesQuery.data && !canWrite ? (
						<Badge variant="outline">View only</Badge>
					) : null}
					{canWrite ? (
						<>
							<input
								aria-label="Upload files"
								className="sr-only"
								multiple={true}
								onChange={(event) => {
									const files = Array.from(event.currentTarget.files ?? []);
									event.currentTarget.value = "";
									uploadFiles(files).catch(() => undefined);
								}}
								ref={fileInputRef}
								type="file"
							/>
							<Button
								disabled={pendingAction !== null}
								onClick={() => fileInputRef.current?.click()}
								size="sm"
								type="button"
								variant="outline"
							>
								<UploadSimpleIcon aria-hidden="true" />
								Upload
							</Button>
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button disabled={pendingAction !== null} size="sm" />
									}
								>
									<PlusIcon aria-hidden="true" />
									New
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onClick={() => setTextFileDialogOpen(true)}>
										<FileTextIcon aria-hidden="true" />
										Text file
									</DropdownMenuItem>
									<DropdownMenuItem onClick={() => setFolderDialogOpen(true)}>
										<FolderPlusIcon aria-hidden="true" />
										Folder
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</>
					) : null}
				</div>
			</div>

			{actionError ? (
				<div
					className="flex items-center justify-between gap-3 border-destructive/30 border-b bg-destructive/5 px-5 py-3 text-destructive text-sm"
					role="alert"
				>
					<span>{actionError}</span>
					<Button
						onClick={() => setActionError(null)}
						size="sm"
						type="button"
						variant="ghost"
					>
						Dismiss
					</Button>
				</div>
			) : null}

			<div className="min-h-0 flex-1 overflow-y-auto p-5">
				<SpaceFileBrowserContent
					canWrite={canWrite}
					entries={filesQuery.data?.entries ?? []}
					error={filesQuery.isError ? filesQuery.error : null}
					isPending={filesQuery.isPending}
					onMove={(entry) => setEntryDialog({ entry, kind: "move" })}
					onOpen={(entry) => {
						if (entry.kind === "folder") {
							setParentId(entry.id);
							return;
						}
						setSelectedFile(entry);
					}}
					onRename={(entry) => setEntryDialog({ entry, kind: "rename" })}
					onRetry={() => filesQuery.refetch()}
					onTrash={(entry) => setEntryDialog({ entry, kind: "trash" })}
				/>
			</div>

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
			<NewTextFileDialog
				onOpenChange={setTextFileDialogOpen}
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
								mimeType: "text/markdown",
								bytes: new TextEncoder().encode(content),
							}),
						(file) => {
							createdFile = file;
						}
					);
					if (succeeded) {
						setTextFileDialogOpen(false);
						setSelectedFile(createdFile);
					}
				}}
				open={textFileDialogOpen}
				pending={pendingAction === "create-text-file"}
			/>
			<RenameEntryDialog
				entry={entryDialog.kind === "rename" ? entryDialog.entry : null}
				onOpenChange={(open) => {
					if (!open) {
						setEntryDialog({ kind: "closed" });
					}
				}}
				onSubmit={renameEntry}
				pending={pendingAction === "rename-entry"}
			/>
			<MoveEntryDialog
				api={api}
				entry={entryDialog.kind === "move" ? entryDialog.entry : null}
				onOpenChange={(open) => {
					if (!open) {
						setEntryDialog({ kind: "closed" });
					}
				}}
				onSubmit={moveEntry}
				pending={pendingAction === "move-entry"}
				spaceId={input.spaceId}
			/>
			<TrashEntryDialog
				entry={entryDialog.kind === "trash" ? entryDialog.entry : null}
				onConfirm={trashEntry}
				onOpenChange={(open) => {
					if (!open) {
						setEntryDialog({ kind: "closed" });
					}
				}}
				pending={pendingAction === "trash-entry"}
			/>
		</section>
	);
}

function SpaceFileBrowserContent(input: {
	canWrite: boolean;
	entries: readonly SpaceFileEntry[];
	error: unknown;
	isPending: boolean;
	onOpen: (entry: SpaceFileEntry) => void;
	onMove: (entry: SpaceFileEntry) => void;
	onRename: (entry: SpaceFileEntry) => void;
	onRetry: () => void;
	onTrash: (entry: SpaceFileEntry) => void;
}) {
	if (input.isPending) {
		return (
			<output
				aria-busy="true"
				aria-label="Loading files"
				className="grid gap-2"
			>
				<Skeleton className="h-14 w-full rounded-md" />
				<Skeleton className="h-14 w-full rounded-md" />
				<Skeleton className="h-14 w-full rounded-md" />
			</output>
		);
	}
	if (input.error) {
		return (
			<div
				className="flex min-h-64 flex-col items-center justify-center rounded-md border border-destructive/40 bg-destructive/5 px-6 text-center"
				role="alert"
			>
				<WarningCircleIcon
					aria-hidden="true"
					className="size-7 text-destructive"
				/>
				<h2 className="mt-3 font-medium">Files couldn’t be loaded</h2>
				<p className="mt-1 max-w-md text-muted-foreground text-sm">
					{resolveSpaceFileErrorMessage(input.error)}
				</p>
				<Button
					className="mt-4"
					onClick={input.onRetry}
					size="sm"
					type="button"
					variant="outline"
				>
					<ArrowClockwiseIcon aria-hidden="true" />
					Try again
				</Button>
			</div>
		);
	}
	if (input.entries.length === 0) {
		return (
			<div className="flex min-h-64 flex-col items-center justify-center rounded-md border border-border/70 border-dashed px-6 text-center">
				<FolderOpenIcon
					aria-hidden="true"
					className="size-8 text-muted-foreground"
					weight="duotone"
				/>
				<h2 className="mt-3 font-medium">This folder is empty</h2>
				<p className="mt-1 max-w-md text-muted-foreground text-sm">
					{input.canWrite
						? "Create a text file, upload a file, or add a folder to start working together."
						: "There aren’t any shared files here yet."}
				</p>
			</div>
		);
	}

	return (
		<div className="overflow-hidden rounded-md border border-border/70">
			<div className="grid grid-cols-[minmax(0,1fr)_9rem_8rem_2rem] gap-3 border-border border-b bg-muted/25 px-4 py-2 text-muted-foreground text-xs max-sm:grid-cols-[minmax(0,1fr)_2rem]">
				<span>Name</span>
				<span className="max-sm:hidden">Updated</span>
				<span className="max-sm:hidden">Size</span>
				<span className="sr-only">Actions</span>
			</div>
			<ul className="divide-y divide-border/70">
				{input.entries.map((entry) => (
					<li
						className="group/entry grid grid-cols-[minmax(0,1fr)_9rem_8rem_2rem] items-center gap-3 px-2 py-1.5 hover:bg-muted/35 max-sm:grid-cols-[minmax(0,1fr)_2rem]"
						key={entry.id}
					>
						<button
							className="flex min-w-0 items-center gap-3 rounded-sm px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							onClick={() => input.onOpen(entry)}
							type="button"
						>
							<span className="grid size-8 shrink-0 place-items-center rounded-md border border-border/70 bg-background text-muted-foreground">
								{renderSpaceFileEntryIcon(entry)}
							</span>
							<span className="min-w-0">
								<span className="block truncate font-medium text-sm">
									{entry.name}
								</span>
								<span className="block truncate text-muted-foreground text-xs sm:hidden">
									{entry.kind === "folder"
										? "Folder"
										: formatFileSize(entry.latestRevision.sizeBytes)}
								</span>
							</span>
						</button>
						<span className="truncate text-muted-foreground text-xs max-sm:hidden">
							{formatShortDate(entry.updatedAt)}
						</span>
						<span className="text-muted-foreground text-xs max-sm:hidden">
							{entry.kind === "folder"
								? "—"
								: formatFileSize(entry.latestRevision.sizeBytes)}
						</span>
						{input.canWrite ? (
							<EntryActions
								entry={entry}
								onMove={() => input.onMove(entry)}
								onRename={() => input.onRename(entry)}
								onTrash={() => input.onTrash(entry)}
							/>
						) : (
							<span />
						)}
					</li>
				))}
			</ul>
		</div>
	);
}

function EntryActions(input: {
	entry: SpaceFileEntry;
	onMove: () => void;
	onRename: () => void;
	onTrash: () => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label={`Actions for ${input.entry.name}`}
						className="opacity-60 focus-visible:opacity-100 group-hover/entry:opacity-100 data-popup-open:opacity-100"
						size="icon-sm"
						variant="ghost"
					/>
				}
			>
				<DotsThreeIcon aria-hidden="true" weight="bold" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={input.onRename}>
					<PencilSimpleIcon aria-hidden="true" />
					Rename
				</DropdownMenuItem>
				<DropdownMenuItem onClick={input.onMove}>
					<FolderOpenIcon aria-hidden="true" />
					Move to folder…
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					className="text-destructive focus:text-destructive"
					onClick={input.onTrash}
				>
					<TrashIcon aria-hidden="true" />
					Move to Trash
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function renderSpaceFileEntryIcon(entry: SpaceFileEntry) {
	if (entry.kind === "folder") {
		return (
			<FolderIcon aria-hidden="true" className="size-4.5" weight="duotone" />
		);
	}
	if (isSpaceFileTextEditable(entry.latestRevision)) {
		return (
			<FileTextIcon aria-hidden="true" className="size-4.5" weight="duotone" />
		);
	}
	return <FileIcon aria-hidden="true" className="size-4.5" weight="duotone" />;
}

function SpaceFileDetail(input: {
	api: SpaceApi;
	canWrite: boolean;
	file: SpaceFileDescriptor;
	onBack: () => void;
	onFileChanged: (file: SpaceFileDescriptor) => void;
	onMove: () => void;
	onRename: () => void;
	onTrash: () => void;
	spaceId: string;
}) {
	const editable = isSpaceFileTextEditable(input.file.latestRevision);
	const [draft, setDraft] = useState("");
	const [loadedRevision, setLoadedRevision] = useState<number | null>(null);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [conflict, setConflict] = useState(false);
	const [downloadingRevision, setDownloadingRevision] = useState<number | null>(
		null
	);
	const contentQuery = useQuery({
		enabled: editable,
		queryKey: spaceFileQueryKeys.content(
			input.spaceId,
			input.file.id,
			input.file.latestRevision.revision
		),
		queryFn: async ({ signal }) =>
			await input.api.downloadFileContent({
				spaceId: input.spaceId,
				fileId: input.file.id,
				revision: input.file.latestRevision.revision,
				signal,
			}),
		gcTime: baseQueryOptions.gcTime,
		retry: baseQueryOptions.retry,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const revisionsQuery = useQuery({
		queryKey: spaceFileQueryKeys.revisions(input.spaceId, input.file.id),
		queryFn: async ({ signal }) =>
			await input.api.listFileRevisions({
				spaceId: input.spaceId,
				fileId: input.file.id,
				signal,
			}),
		gcTime: baseQueryOptions.gcTime,
		retry: baseQueryOptions.retry,
		staleTime: 3000,
	});

	useEffect(() => {
		if (!contentQuery.data || loadedRevision === contentQuery.data.revision) {
			return;
		}
		setDraft(new TextDecoder().decode(contentQuery.data.bytes));
		setLoadedRevision(contentQuery.data.revision);
		setConflict(false);
		setSaveError(null);
	}, [contentQuery.data, loadedRevision]);

	const downloadRevision = async (revision?: number) => {
		const targetRevision = revision ?? input.file.latestRevision.revision;
		setDownloadingRevision(targetRevision);
		setSaveError(null);
		try {
			const content =
				revision === undefined && contentQuery.data
					? contentQuery.data
					: await input.api.downloadFileContent({
							spaceId: input.spaceId,
							fileId: input.file.id,
							...(revision === undefined ? {} : { revision }),
						});
			downloadContent(input.file.name, content);
		} catch (error) {
			setSaveError(resolveSpaceFileErrorMessage(error));
		} finally {
			setDownloadingRevision(null);
		}
	};
	const reloadLatest = async () => {
		setSaveError(null);
		try {
			const { file } = await input.api.getFile({
				spaceId: input.spaceId,
				fileId: input.file.id,
			});
			setLoadedRevision(null);
			input.onFileChanged(file);
		} catch (error) {
			setSaveError(resolveSpaceFileErrorMessage(error));
		}
	};
	const save = async () => {
		setSaving(true);
		setSaveError(null);
		setConflict(false);
		try {
			const file = await input.api.updateFileContent({
				spaceId: input.spaceId,
				fileId: input.file.id,
				baseRevision: input.file.latestRevision.revision,
				clientMutationId: crypto.randomUUID(),
				mimeType: input.file.latestRevision.mimeType,
				bytes: new TextEncoder().encode(draft),
			});
			input.onFileChanged(file);
			toast.success("File saved");
		} catch (error) {
			const failure = toStructuredApiClientFailure(error);
			if (failure.code === "space_file.conflict") {
				setConflict(true);
			} else {
				setSaveError(resolveSpaceFileErrorMessage(error));
			}
		} finally {
			setSaving(false);
		}
	};

	return (
		<section
			aria-label={`File ${input.file.name}`}
			className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
		>
			<header className="flex flex-wrap items-center justify-between gap-3 border-border border-b px-5 py-3">
				<div className="flex min-w-0 items-center gap-3">
					<Button
						aria-label="Back to files"
						onClick={input.onBack}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<ArrowLeftIcon aria-hidden="true" />
					</Button>
					<div className="min-w-0">
						<h2 className="truncate font-medium text-sm">{input.file.name}</h2>
						<p className="truncate text-muted-foreground text-xs">
							Version {input.file.latestRevision.revision} ·{" "}
							{formatFileSize(input.file.latestRevision.sizeBytes)} ·{" "}
							{input.file.updatedBy.displayName}
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<Button
						disabled={downloadingRevision !== null}
						onClick={() => downloadRevision()}
						size="sm"
						type="button"
						variant="outline"
					>
						<DownloadSimpleIcon aria-hidden="true" />
						Download
					</Button>
					{input.canWrite ? (
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										aria-label="File actions"
										size="icon-sm"
										variant="ghost"
									/>
								}
							>
								<DotsThreeIcon aria-hidden="true" weight="bold" />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem onClick={input.onRename}>
									<PencilSimpleIcon aria-hidden="true" />
									Rename
								</DropdownMenuItem>
								<DropdownMenuItem onClick={input.onMove}>
									<FolderOpenIcon aria-hidden="true" />
									Move to folder…
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									className="text-destructive focus:text-destructive"
									onClick={input.onTrash}
								>
									<TrashIcon aria-hidden="true" />
									Move to Trash
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					) : null}
				</div>
			</header>

			{conflict ? (
				<div
					className="flex flex-wrap items-center justify-between gap-3 border-amber-500/30 border-b bg-amber-500/10 px-5 py-3 text-sm"
					role="alert"
				>
					<div>
						<p className="font-medium">
							A newer version was saved by someone else.
						</p>
						<p className="text-muted-foreground">
							Your edits are still here. Reload the latest version before
							editing again.
						</p>
					</div>
					<Button
						onClick={() => reloadLatest()}
						size="sm"
						type="button"
						variant="outline"
					>
						Reload latest
					</Button>
				</div>
			) : null}
			{saveError ? (
				<div
					className="border-destructive/30 border-b bg-destructive/5 px-5 py-3 text-destructive text-sm"
					role="alert"
				>
					{saveError}
				</div>
			) : null}

			<div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_17rem] max-lg:grid-cols-1">
				<div className="flex min-h-0 flex-col overflow-hidden p-5">
					{editable ? (
						<FileTextEditor
							canWrite={input.canWrite}
							draft={draft}
							isError={contentQuery.isError}
							isLoading={contentQuery.isPending}
							onChange={setDraft}
							onRetry={() => contentQuery.refetch()}
							onSave={save}
							saving={saving}
						/>
					) : (
						<div className="flex min-h-64 flex-1 flex-col items-center justify-center rounded-md border border-border/70 bg-muted/15 px-6 text-center">
							<FileIcon
								aria-hidden="true"
								className="size-10 text-muted-foreground"
								weight="duotone"
							/>
							<h3 className="mt-3 font-medium">
								Preview isn’t available for this file
							</h3>
							<p className="mt-1 text-muted-foreground text-sm">
								Download it to open it in an app on your computer.
							</p>
							<Button
								className="mt-4"
								onClick={() => downloadRevision()}
								size="sm"
								type="button"
							>
								<DownloadSimpleIcon aria-hidden="true" />
								Download file
							</Button>
						</div>
					)}
				</div>
				<aside
					aria-label="Version history"
					className="min-h-0 overflow-y-auto border-border border-l p-5 max-lg:border-t max-lg:border-l-0"
				>
					<h3 className="font-medium text-sm">Version history</h3>
					{renderVersionHistory({
						downloadingRevision,
						isError: revisionsQuery.isError,
						isPending: revisionsQuery.isPending,
						onDownload: downloadRevision,
						revisions: revisionsQuery.data?.revisions ?? [],
					})}
				</aside>
			</div>
		</section>
	);
}

function renderVersionHistory(input: {
	downloadingRevision: number | null;
	isError: boolean;
	isPending: boolean;
	onDownload: (revision?: number) => Promise<void>;
	revisions: readonly SpaceFileRevision[];
}) {
	if (input.isPending) {
		return <Skeleton className="mt-3 h-16 w-full rounded-md" />;
	}
	if (input.isError) {
		return (
			<p className="mt-3 text-destructive text-xs">
				Version history couldn’t be loaded.
			</p>
		);
	}
	return (
		<ul className="mt-3 space-y-2">
			{input.revisions.map((revision) => (
				<li
					className="rounded-md border border-border/70 px-3 py-2"
					key={revision.id}
				>
					<div className="flex items-center justify-between gap-2">
						<span className="font-medium text-xs">
							Version {revision.revision}
						</span>
						<Button
							aria-label={`Download version ${revision.revision}`}
							disabled={input.downloadingRevision !== null}
							onClick={() => input.onDownload(revision.revision)}
							size="icon-sm"
							type="button"
							variant="ghost"
						>
							<DownloadSimpleIcon aria-hidden="true" />
						</Button>
					</div>
					<p className="mt-1 truncate text-muted-foreground text-xs">
						{revision.createdBy.displayName} ·{" "}
						{formatShortDate(revision.createdAt)}
					</p>
				</li>
			))}
		</ul>
	);
}

function FileTextEditor(input: {
	canWrite: boolean;
	draft: string;
	isError: boolean;
	isLoading: boolean;
	onChange: (value: string) => void;
	onRetry: () => void;
	onSave: () => void;
	saving: boolean;
}) {
	if (input.isLoading) {
		return (
			<Skeleton
				aria-label="Loading file"
				className="min-h-80 flex-1 rounded-md"
			/>
		);
	}
	if (input.isError) {
		return (
			<div
				className="flex min-h-64 flex-1 flex-col items-center justify-center rounded-md border border-destructive/40 bg-destructive/5 px-6 text-center"
				role="alert"
			>
				<p className="font-medium">This file couldn’t be opened.</p>
				<Button
					className="mt-4"
					onClick={input.onRetry}
					size="sm"
					type="button"
					variant="outline"
				>
					Try again
				</Button>
			</div>
		);
	}
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			<Textarea
				aria-label="File contents"
				className="min-h-80 flex-1 resize-none font-mono text-sm leading-6"
				onChange={(event) => input.onChange(event.currentTarget.value)}
				readOnly={!input.canWrite}
				spellCheck={false}
				value={input.draft}
			/>
			{input.canWrite ? (
				<div className="flex justify-end">
					<Button disabled={input.saving} onClick={input.onSave} type="button">
						{input.saving ? "Saving…" : "Save changes"}
					</Button>
				</div>
			) : null}
		</div>
	);
}

function FolderNameDialog(input: {
	onOpenChange: (open: boolean) => void;
	onSubmit: (name: string) => Promise<void>;
	open: boolean;
	pending: boolean;
}) {
	const [name, setName] = useState("");
	useEffect(() => {
		if (input.open) {
			setName("");
		}
	}, [input.open]);
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="sm:max-w-md">
				<form
					onSubmit={(event) => submitNamedForm(event, name, input.onSubmit)}
				>
					<DialogHeader>
						<DialogTitle>New folder</DialogTitle>
					</DialogHeader>
					<div className="grid gap-2 py-5">
						<Label htmlFor="space-folder-name">Folder name</Label>
						<Input
							autoFocus={true}
							id="space-folder-name"
							maxLength={255}
							onChange={(event) => setName(event.currentTarget.value)}
							placeholder="Project files"
							value={name}
						/>
					</div>
					<DialogFooter>
						<Button
							disabled={input.pending}
							onClick={() => input.onOpenChange(false)}
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={input.pending || name.trim().length === 0}
							type="submit"
						>
							{input.pending ? "Creating…" : "Create folder"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function NewTextFileDialog(input: {
	onOpenChange: (open: boolean) => void;
	onSubmit: (input: { content: string; name: string }) => Promise<void>;
	open: boolean;
	pending: boolean;
}) {
	const [name, setName] = useState("untitled.md");
	const [content, setContent] = useState("");
	useEffect(() => {
		if (input.open) {
			setName("untitled.md");
			setContent("");
		}
	}, [input.open]);
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="sm:max-w-2xl">
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (name.trim()) {
							input
								.onSubmit({ content, name: name.trim() })
								.catch(() => undefined);
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>New text file</DialogTitle>
					</DialogHeader>
					<div className="grid gap-4 py-5">
						<div className="grid gap-2">
							<Label htmlFor="space-text-file-name">File name</Label>
							<Input
								autoFocus={true}
								id="space-text-file-name"
								maxLength={255}
								onChange={(event) => setName(event.currentTarget.value)}
								value={name}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="space-text-file-content">Contents</Label>
							<Textarea
								className="min-h-56 font-mono text-sm"
								id="space-text-file-content"
								onChange={(event) => setContent(event.currentTarget.value)}
								placeholder="Start writing…"
								value={content}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							disabled={input.pending}
							onClick={() => input.onOpenChange(false)}
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={input.pending || name.trim().length === 0}
							type="submit"
						>
							{input.pending ? "Creating…" : "Create file"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function RenameEntryDialog(input: {
	entry: SpaceFileEntry | null;
	onOpenChange: (open: boolean) => void;
	onSubmit: (entry: SpaceFileEntry, name: string) => Promise<void>;
	pending: boolean;
}) {
	const [name, setName] = useState("");
	useEffect(() => setName(input.entry?.name ?? ""), [input.entry]);
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.entry !== null}>
			<DialogContent className="sm:max-w-md">
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (input.entry && name.trim()) {
							input.onSubmit(input.entry, name.trim()).catch(() => undefined);
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>Rename {input.entry?.kind ?? "item"}</DialogTitle>
					</DialogHeader>
					<div className="grid gap-2 py-5">
						<Label htmlFor="space-entry-name">Name</Label>
						<Input
							autoFocus={true}
							id="space-entry-name"
							maxLength={255}
							onChange={(event) => setName(event.currentTarget.value)}
							value={name}
						/>
					</div>
					<DialogFooter>
						<Button
							disabled={input.pending}
							onClick={() => input.onOpenChange(false)}
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={input.pending || name.trim().length === 0}
							type="submit"
						>
							{input.pending ? "Renaming…" : "Rename"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

const ROOT_DESTINATION_VALUE = "__openmeld_space_files_root__";
const MAX_MOVE_DESTINATION_FOLDERS = 500;

function MoveEntryDialog(input: {
	api: SpaceApi;
	entry: SpaceFileEntry | null;
	onOpenChange: (open: boolean) => void;
	onSubmit: (
		entry: SpaceFileEntry,
		destinationId: string | null
	) => Promise<void>;
	pending: boolean;
	spaceId: string;
}) {
	const [destinationValue, setDestinationValue] = useState(
		ROOT_DESTINATION_VALUE
	);
	useEffect(() => {
		setDestinationValue(input.entry?.parentId ?? ROOT_DESTINATION_VALUE);
	}, [input.entry]);
	const destinationsQuery = useQuery({
		enabled: input.entry !== null,
		queryKey: [
			"space-files",
			input.spaceId,
			"move-destinations",
			input.entry?.id,
		],
		queryFn: async () =>
			await loadMoveDestinations({
				api: input.api,
				excludedFolderId:
					input.entry?.kind === "folder" ? input.entry.id : undefined,
				spaceId: input.spaceId,
			}),
		gcTime: baseQueryOptions.gcTime,
		retry: baseQueryOptions.retry,
		staleTime: 3000,
	});
	const loading = input.entry !== null && destinationsQuery.isPending;
	const loadError = destinationsQuery.isError
		? resolveSpaceFileErrorMessage(destinationsQuery.error)
		: null;
	const destinations = destinationsQuery.data ?? [];

	const currentValue = input.entry?.parentId ?? ROOT_DESTINATION_VALUE;
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.entry !== null}>
			<DialogContent className="sm:max-w-md">
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (input.entry && destinationValue !== currentValue) {
							input
								.onSubmit(
									input.entry,
									destinationValue === ROOT_DESTINATION_VALUE
										? null
										: destinationValue
								)
								.catch(() => undefined);
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>Move “{input.entry?.name}”</DialogTitle>
					</DialogHeader>
					<div className="grid gap-2 py-5">
						<Label htmlFor="space-entry-destination">Destination folder</Label>
						<select
							className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
							disabled={loading || input.pending || loadError !== null}
							id="space-entry-destination"
							onChange={(event) =>
								setDestinationValue(event.currentTarget.value)
							}
							value={destinationValue}
						>
							<option value={ROOT_DESTINATION_VALUE}>Files (root)</option>
							{destinations.map((folder) => (
								<option key={folder.id} value={folder.id}>
									{folder.path}
								</option>
							))}
						</select>
						{loading ? (
							<p className="text-muted-foreground text-xs">Loading folders…</p>
						) : null}
						{loadError ? (
							<div
								className="flex items-center justify-between gap-3"
								role="alert"
							>
								<p className="text-destructive text-xs">{loadError}</p>
								<Button
									onClick={() => destinationsQuery.refetch()}
									size="sm"
									type="button"
									variant="outline"
								>
									Try again
								</Button>
							</div>
						) : null}
					</div>
					<DialogFooter>
						<Button
							disabled={input.pending}
							onClick={() => input.onOpenChange(false)}
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={
								input.pending ||
								loading ||
								loadError !== null ||
								destinationValue === currentValue
							}
							type="submit"
						>
							{input.pending ? "Moving…" : "Move"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

async function loadMoveDestinations(input: {
	api: SpaceApi;
	excludedFolderId?: string;
	spaceId: string;
}): Promise<readonly { id: string; path: string }[]> {
	const destinations: { id: string; path: string }[] = [];
	const pendingParentIds: Array<string | null> = [ROOT_FOLDER_ID];
	const visited = new Set<string>();
	while (pendingParentIds.length > 0) {
		const parentId = pendingParentIds.shift() ?? ROOT_FOLDER_ID;
		const result = await input.api.listFiles({
			spaceId: input.spaceId,
			query: { parentId },
		});
		for (const entry of result.entries) {
			if (
				entry.kind !== "folder" ||
				entry.id === input.excludedFolderId ||
				visited.has(entry.id)
			) {
				continue;
			}
			visited.add(entry.id);
			destinations.push({ id: entry.id, path: entry.path });
			pendingParentIds.push(entry.id);
			if (destinations.length > MAX_MOVE_DESTINATION_FOLDERS) {
				throw new Error(
					"This Space has too many folders to show here. Use the CLI to move this item."
				);
			}
		}
	}
	return destinations.sort((left, right) =>
		left.path.localeCompare(right.path)
	);
}

function TrashEntryDialog(input: {
	entry: SpaceFileEntry | null;
	onConfirm: (entry: SpaceFileEntry) => Promise<void>;
	onOpenChange: (open: boolean) => void;
	pending: boolean;
}) {
	return (
		<AlertDialog onOpenChange={input.onOpenChange} open={input.entry !== null}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						Move “{input.entry?.name}” to Trash?
					</AlertDialogTitle>
					<AlertDialogDescription>
						{input.entry?.kind === "folder"
							? "Only empty folders can be moved to Trash."
							: "The saved versions remain protected, but this file will disappear from the shared folder."}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={input.pending}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						disabled={input.pending}
						onClick={(event) => {
							event.preventDefault();
							if (input.entry) {
								input.onConfirm(input.entry).catch(() => undefined);
							}
						}}
					>
						{input.pending ? "Moving…" : "Move to Trash"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function submitNamedForm(
	event: FormEvent<HTMLFormElement>,
	name: string,
	onSubmit: (name: string) => Promise<void>
): void {
	event.preventDefault();
	const normalized = name.trim();
	if (normalized) {
		onSubmit(normalized).catch(() => undefined);
	}
}

function resolveSpaceFileErrorMessage(error: unknown): string {
	const failure = toStructuredApiClientFailure(error);
	switch (failure.code) {
		case "space_file.name_conflict":
			return "That name is already used in this folder.";
		case "space_file.folder_not_empty":
			return "This folder still contains files. Move or remove them first.";
		case "space.membership_required":
			return "Join this Space before changing its files.";
		case "space_file.conflict":
			return "Someone saved a newer version. Reload the file before trying again.";
		case "space_file.too_large":
			return "Files must be 10 MiB or smaller.";
		default:
			return failure.message || "OpenMeld couldn’t complete this file action.";
	}
}

function downloadContent(fileName: string, content: SpaceFileContent): void {
	const url = URL.createObjectURL(
		new Blob([content.bytes], { type: content.mimeType })
	);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = fileName;
	anchor.click();
	URL.revokeObjectURL(url);
}

function formatFileSize(sizeBytes: number): string {
	if (sizeBytes < 1024) {
		return `${sizeBytes} B`;
	}
	if (sizeBytes < 1024 * 1024) {
		return `${(sizeBytes / 1024).toFixed(sizeBytes < 10 * 1024 ? 1 : 0)} KB`;
	}
	return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatShortDate(value: string): string {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
	}).format(new Date(value));
}
