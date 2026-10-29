"use client";

import {
	createFileRootApi,
	type FileRootLocation,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import { SPACE_FILE_MAX_TEXT_EDIT_SIZE_BYTES } from "@openmeld/schemas";
import type {
	FileRootEntry,
	OrganizationDocumentKind,
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
import { Button } from "@openmeld/ui/components/button";
import {
	ContextMenu,
	ContextMenuTrigger,
} from "@openmeld/ui/components/context-menu";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { SkeletonRows } from "@openmeld/ui/components/skeleton-content";
import { Textarea } from "@openmeld/ui/components/textarea";
import {
	FluidDropdownMenuContent as ContextMenuContent,
	FluidDropdownMenuItem as ContextMenuItem,
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import {
	ArrowCounterClockwiseIcon,
	CaretRightIcon,
	ClockCounterClockwiseIcon,
	CopyIcon,
	DownloadSimpleIcon,
	FileTextIcon,
	FolderOpenIcon,
	FolderPlusIcon,
	PencilSimpleIcon,
	PlusIcon,
	TrashIcon,
	UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { parseAsString, useQueryState } from "nuqs";
import {
	type DragEvent,
	lazy,
	type ReactNode,
	Suspense,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import type { FileSystemItem } from "#/components/extend/file-system";
import {
	UnsavedChangesDialog,
	UnsavedChangesGuard,
} from "#/components/forms/unsaved-changes-guard";
import { OrganizationDocumentDetailPage } from "#/components/organization-documents/organization-document-detail-page";
import { OrganizationDocumentNewPage } from "#/components/organization-documents/organization-document-new-page";
import { TeamKnowledgeFilesBrowser } from "#/components/organizations/team-knowledge-files-browser";
import {
	FolderNameDialog,
	MoveEntryDialog,
	NewTextFileDialog,
	RenameEntryDialog,
} from "#/components/spaces/space-file-dialogs";
import {
	downloadContent,
	formatFileDateTime,
	formatFileSize,
	resolveSpaceFileErrorMessage,
	utf8ByteLength,
} from "#/components/spaces/space-file-utils";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationFilesPath } from "#/lib/organizations/organization-routes";
import { useSelectedHumanProfile } from "#/lib/profiles/use-selected-human-profile";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import { useTeamFilesView } from "./team-files-navigation";

const FileSystem = lazy(() =>
	import("#/components/extend/file-system").then((module) => ({
		default: module.FileSystem,
	}))
);

const NEW_TEXT_FILE_MIME_TYPES = {
	markdown: "text/markdown",
	text: "text/plain",
	csv: "text/csv",
} as const;
const NEW_TEXT_FILE_CONTEXT_LABELS = {
	markdown: "New Markdown file",
	text: "New text file",
	csv: "New CSV file",
} as const;

export function TeamFilesPage() {
	const { currentOrganization } = useAppOrganization();
	const [fileView, changeView] = useTeamFilesView();
	const location = fileView === "my" || fileView === "trash-my" ? "my" : "team";
	const view =
		fileView === "trash" || fileView === "trash-my" ? "trash" : "active";
	return (
		<TeamFilesBrowser
			currentOrganization={currentOrganization}
			key={`${currentOrganization.id}:${fileView}`}
			location={location}
			onViewChange={changeView}
			view={view}
		/>
	);
}

export function TeamKnowledgeFilesPage(input: {
	create?: boolean;
	documentId?: string;
	folderId?: string;
	kind?: OrganizationDocumentKind;
	subjectUserId?: string;
}) {
	return (
		<section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
			<ScrollArea
				className="min-h-0 flex-1"
				contentClassName={
					input.documentId || input.create
						? "px-[var(--app-page-inline-padding)] py-[var(--app-page-block-padding)]"
						: "px-[calc(var(--app-page-inline-padding)-0.5rem)] py-[var(--app-page-block-padding)]"
				}
			>
				{input.documentId ? (
					<OrganizationDocumentDetailPage documentId={input.documentId} />
				) : null}
				{!input.documentId && input.create ? (
					<OrganizationDocumentNewPage
						initialFolderId={input.folderId}
						initialKind={input.kind}
						initialSubjectUserId={input.subjectUserId}
					/>
				) : null}
				{input.documentId || input.create ? null : (
					<TeamKnowledgeFilesBrowser folderId={input.folderId} />
				)}
			</ScrollArea>
		</section>
	);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This page coordinates the shared browser with root navigation and file actions.
function TeamFilesBrowser(input: {
	currentOrganization: ReturnType<
		typeof useAppOrganization
	>["currentOrganization"];
	location: FileRootLocation;
	view: "active" | "trash";
	onViewChange: (view: "team" | "my" | "trash" | "trash-my") => unknown;
}) {
	const { currentOrganization } = input;
	const navigate = useNavigate();
	const { location, view } = input;
	const [parentId, setParentId] = useQueryState("folder", parseAsString);
	const [folderDialogOpen, setFolderDialogOpen] = useState(false);
	const [newTextFileKind, setNewTextFileKind] = useState<
		"markdown" | "text" | "csv" | null
	>(null);
	const [renamingEntry, setRenamingEntry] = useState<FileRootEntry | null>(
		null
	);
	const [movingEntry, setMovingEntry] = useState<FileRootEntry | null>(null);
	const [historyEntry, setHistoryEntry] = useState<Extract<
		FileRootEntry,
		{ kind: "file" }
	> | null>(null);
	const [editingEntry, setEditingEntry] = useState<Extract<
		FileRootEntry,
		{ kind: "file" }
	> | null>(null);
	const [copyingEntry, setCopyingEntry] = useState<{
		entry: Extract<FileRootEntry, { kind: "file" }>;
		clientMutationId: string;
	} | null>(null);
	const [copyError, setCopyError] = useState<string | null>(null);
	const [copyToSpaceEntry, setCopyToSpaceEntry] = useState<{
		entry: Extract<FileRootEntry, { kind: "file" }>;
		location: FileRootLocation;
		clientMutationId: string;
	} | null>(null);
	const [busy, setBusy] = useState(false);
	const [fileDragDepth, setFileDragDepth] = useState(0);
	const [uploadProgress, setUploadProgress] = useState<{
		name: string;
		percent: number;
	} | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [dialogError, setDialogError] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [selectedKnowledgeFolder, setSelectedKnowledgeFolder] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const objectUrls = useRef(new Map<string, string>());
	const queryClient = useQueryClient();
	const api = useMemo(
		() =>
			createFileRootApi(
				createOrganizationScopedWebOpenMeldApiFoundation({
					organizationId: currentOrganization.id,
				})
			),
		[currentOrganization.id]
	);
	useEffect(() => {
		const urls = objectUrls.current;
		return () => {
			for (const url of urls.values()) {
				URL.revokeObjectURL(url);
			}
			urls.clear();
		};
	}, []);
	const queryKey = [
		"file-root",
		currentOrganization.id,
		location,
		parentId,
		view,
	];
	const files = useQuery({
		queryKey,
		queryFn: ({ signal }) => api.list({ location, parentId, view, signal }),
	});
	const entries = files.data?.entries ?? [];
	const selectedEntry = entries.find((entry) => entry.id === selectedId);
	const knowledgeFolderPath = "__openmeld_team_knowledge__/";
	const items: FileSystemItem[] = entries.map((entry) =>
		entry.kind === "folder"
			? {
					kind: "folder",
					path: `${entry.name}/`,
					name: entry.name,
					createdAt: entry.createdAt,
					updatedAt: entry.updatedAt,
				}
			: {
					kind: "file",
					path: entry.name,
					name: entry.name,
					contentType: entry.latestRevision.mimeType,
					size: entry.latestRevision.sizeBytes,
					createdAt: entry.createdAt,
					updatedAt: entry.updatedAt,
				}
	);
	if (location === "team" && parentId === null && view === "active") {
		items.unshift({
			kind: "folder",
			name: "Team Knowledge",
			path: knowledgeFolderPath,
			emblem: "knowledge",
		});
	}
	const entriesByPath = new Map(
		entries.map((entry) => [
			entry.kind === "folder" ? `${entry.name}/` : entry.name,
			entry,
		])
	);
	const browserVersionKey = entries
		.map((entry) =>
			entry.kind === "file"
				? `${entry.id}:${entry.latestRevision.id}:${entry.name}`
				: `${entry.id}:${entry.name}`
		)
		.join("|");
	const refresh = async () => {
		await queryClient.invalidateQueries({
			queryKey: ["file-root", currentOrganization.id],
		});
	};
	const runAction = async (
		action: () => Promise<unknown>,
		errorPlacement: "page" | "dialog" = "page"
	): Promise<boolean> => {
		setBusy(true);
		setActionError(null);
		setDialogError(null);
		setSelectedId(null);
		setSelectedKnowledgeFolder(false);
		try {
			await action();
			await refresh();
			return true;
		} catch (error) {
			const message = resolveSpaceFileErrorMessage(error);
			if (errorPlacement === "dialog") {
				setDialogError(message);
			} else {
				setActionError(message);
			}
			return false;
		} finally {
			setBusy(false);
		}
	};
	const uploadFiles = async (selected: readonly File[]) => {
		if (selected.length === 0 || busy || view !== "active") {
			return;
		}
		try {
			await runAction(async () => {
				for (const file of selected) {
					setUploadProgress({ name: file.name, percent: 0 });
					await api.upload({
						location,
						bytes: file,
						mimeType: file.type || "application/octet-stream",
						name: file.name,
						parentId,
						clientMutationId: crypto.randomUUID(),
						onProgress: (uploadedBytes, totalBytes) =>
							setUploadProgress({
								name: file.name,
								percent: Math.round((uploadedBytes / totalBytes) * 100),
							}),
					});
				}
			});
		} finally {
			setUploadProgress(null);
		}
	};
	const isFileDrag = (event: DragEvent<HTMLElement>) =>
		event.dataTransfer.types.includes("Files");
	const changeView = (
		nextLocation: FileRootLocation,
		nextView: "active" | "trash"
	) => {
		setActionError(null);
		setSelectedId(null);
		setSelectedKnowledgeFolder(false);
		let fileView: "team" | "my" | "trash" | "trash-my" = nextLocation;
		if (nextView === "trash") {
			fileView = nextLocation === "my" ? "trash-my" : "trash";
		}
		input.onViewChange(fileView);
	};
	const copyDestination: FileRootLocation = location === "team" ? "my" : "team";
	const rootLabel = location === "my" ? "My files" : "Team files";
	let breadcrumb: ReactNode = null;
	if (view === "trash") {
		breadcrumb = (
			<div className="flex min-w-0 items-center gap-1 text-sm">
				<Button
					onClick={() => changeView(location, "active")}
					size="sm"
					type="button"
					variant="ghost"
				>
					{location === "my" ? "My files" : "Team files"}
				</Button>
				<CaretRightIcon
					aria-hidden="true"
					className="size-3.5 text-muted-foreground"
				/>
				<span className="font-medium">Trash</span>
			</div>
		);
	} else if (parentId) {
		breadcrumb = (
			<div className="flex min-w-0 items-center gap-1 text-sm">
				{files.data?.breadcrumbs.map((crumb, index) => (
					<span
						className="flex min-w-0 items-center gap-1"
						key={crumb.id ?? "root"}
					>
						{index > 0 ? (
							<CaretRightIcon
								aria-hidden="true"
								className="size-3.5 text-muted-foreground"
							/>
						) : null}
						{crumb.id === parentId ? (
							<span className="font-medium">{crumb.name}</span>
						) : (
							<Button
								onClick={() => setParentId(crumb.id)}
								size="sm"
								type="button"
								variant="ghost"
							>
								{crumb.id === null ? rootLabel : crumb.name}
							</Button>
						)}
					</span>
				))}
			</div>
		);
	}
	const toolbarActions = (
		<div className="flex min-w-0 flex-wrap items-center gap-1.5">
			{view === "active" ? (
				<>
					<input
						className="hidden"
						multiple
						onChange={(event) => {
							const selected = Array.from(event.currentTarget.files ?? []);
							event.currentTarget.value = "";
							uploadFiles(selected).catch(console.error);
						}}
						ref={inputRef}
						type="file"
					/>
					<DropdownMenu>
						<DropdownMenuTrigger render={<Button disabled={busy} size="sm" />}>
							<PlusIcon aria-hidden="true" /> New
						</DropdownMenuTrigger>
						<FluidDropdownMenuContent align="start">
							<FluidDropdownMenuItem
								index={0}
								onClick={() => setNewTextFileKind("markdown")}
							>
								<FileTextIcon aria-hidden="true" /> Markdown file
							</FluidDropdownMenuItem>
							<FluidDropdownMenuItem
								index={1}
								onClick={() => setNewTextFileKind("text")}
							>
								<FileTextIcon aria-hidden="true" /> Text file
							</FluidDropdownMenuItem>
							<FluidDropdownMenuItem
								index={2}
								onClick={() => setNewTextFileKind("csv")}
							>
								<FileTextIcon aria-hidden="true" /> CSV file
							</FluidDropdownMenuItem>
							<FluidDropdownMenuItem
								index={3}
								onClick={() => setFolderDialogOpen(true)}
							>
								<FolderPlusIcon aria-hidden="true" /> Folder
							</FluidDropdownMenuItem>
							<DropdownMenuSeparator className="my-1.5" />
							<FluidDropdownMenuItem
								index={4}
								onClick={() => inputRef.current?.click()}
							>
								<UploadSimpleIcon aria-hidden="true" /> Upload file…
							</FluidDropdownMenuItem>
						</FluidDropdownMenuContent>
					</DropdownMenu>
				</>
			) : null}
			{view === "trash" && !currentOrganization.isPersonal ? (
				<Select
					onValueChange={(value) =>
						changeView(value as FileRootLocation, "trash")
					}
					value={location}
				>
					<SelectTrigger
						aria-label="Trash location"
						className="h-8 min-w-32"
						displayValue={location === "my" ? "My files" : "Team files"}
					/>
					<SelectContent>
						<SelectItem index={0} value="team">
							Team files
						</SelectItem>
						<SelectItem index={1} value="my">
							My files
						</SelectItem>
					</SelectContent>
				</Select>
			) : null}
		</div>
	);
	let browserTitle = rootLabel;
	if (view === "trash") {
		browserTitle = "Trash";
	} else if (parentId) {
		browserTitle = files.data?.breadcrumbs.at(-1)?.name ?? "Folder";
	}
	return (
		// biome-ignore lint/a11y/noNoninteractiveElementInteractions: the Files surface accepts OS file drops; the New menu and empty state provide keyboard upload controls.
		<section
			aria-label={browserTitle}
			className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
			onDragEnter={(event) => {
				if (view !== "active" || !isFileDrag(event)) {
					return;
				}
				event.preventDefault();
				setFileDragDepth((depth) => depth + 1);
			}}
			onDragLeave={(event) => {
				if (view !== "active" || !isFileDrag(event)) {
					return;
				}
				event.preventDefault();
				setFileDragDepth((depth) => Math.max(0, depth - 1));
			}}
			onDragOver={(event) => {
				if (view !== "active" || !isFileDrag(event)) {
					return;
				}
				event.preventDefault();
				event.dataTransfer.dropEffect = busy ? "none" : "copy";
			}}
			onDrop={(event) => {
				if (view !== "active" || !isFileDrag(event)) {
					return;
				}
				event.preventDefault();
				setFileDragDepth(0);
				uploadFiles(Array.from(event.dataTransfer.files)).catch(console.error);
			}}
		>
			{view === "active" && fileDragDepth > 0 && !busy ? (
				<div className="pointer-events-none absolute inset-3 z-30 grid place-items-center rounded-md border-2 border-primary border-dashed bg-background/95">
					<div className="text-center">
						<UploadSimpleIcon
							aria-hidden="true"
							className="mx-auto size-8 text-primary"
						/>
						<p className="mt-3 font-medium text-sm">Drop files to upload</p>
						<p className="mt-1 text-muted-foreground text-xs">
							Files will be added to {browserTitle}.
						</p>
					</div>
				</div>
			) : null}
			{actionError ? (
				<p
					className="border-destructive/30 border-b px-5 py-2 text-destructive text-sm"
					role="alert"
				>
					{actionError}
				</p>
			) : null}
			{uploadProgress ? (
				<output className="block border-b px-5 py-2 text-muted-foreground text-sm">
					{uploadProgress.percent >= 100
						? `Saving ${uploadProgress.name}…`
						: `Uploading ${uploadProgress.name} · ${uploadProgress.percent}%`}
				</output>
			) : null}
			<div className="min-h-0 flex-1 px-[calc(var(--app-page-inline-padding)_-_0.5rem)] py-[var(--app-page-block-padding)]">
				<ContextMenu
					key={`${currentOrganization.id}:${location}:${parentId ?? "root"}:${view}`}
				>
					<ContextMenuTrigger
						className="block h-full"
						onContextMenuCapture={(event) => {
							if (!(event.target as Element).closest('[role="option"]')) {
								setSelectedId(null);
								setSelectedKnowledgeFolder(false);
							}
						}}
					>
						<Suspense
							fallback={<SkeletonRows className="p-3" label="Loading files" />}
						>
							<FileSystem
								breadcrumb={breadcrumb}
								className="h-full min-h-96"
								embedded
								emptyContent={
									view === "active" ? (
										<div className="grid size-full place-items-center px-4 py-8">
											<button
												className="flex min-h-48 w-full max-w-lg flex-col items-center justify-center rounded-md border border-border border-dashed bg-card/25 px-6 py-8 text-center transition-colors hover:border-foreground/40 hover:bg-card/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
												disabled={busy}
												onClick={() => inputRef.current?.click()}
												type="button"
											>
												<UploadSimpleIcon
													aria-hidden="true"
													className="size-7 text-muted-foreground"
												/>
												<span className="mt-3 font-medium text-sm">
													Drop files here
												</span>
												<span className="mt-1 text-muted-foreground text-xs">
													Add files to {browserTitle}.
												</span>
												<span className="mt-4 rounded-md border border-border bg-background px-3 py-1.5 font-medium text-xs">
													Browse files
												</span>
											</button>
										</div>
									) : undefined
								}
								emptyLabel={view === "trash" ? "Trash is empty" : undefined}
								errorContent={
									files.isError ? (
										<div className="grid justify-items-center gap-3 p-8">
											<p>Files couldn't be loaded.</p>
											<Button
												onClick={() => files.refetch()}
												size="sm"
												variant="outline"
											>
												Try again
											</Button>
										</div>
									) : undefined
								}
								getFileUrl={async (file) => {
									const entry = entriesByPath.get(file.path);
									if (!entry || entry.kind !== "file") {
										throw new Error("File not found.");
									}
									return await resolveFileUrl({
										api,
										entry,
										organizationId: currentOrganization.id,
										location,
										objectUrls: objectUrls.current,
									});
								}}
								isLoading={files.isPending}
								items={items}
								key={`${currentOrganization.id}:${location}:${parentId ?? "root"}:${view}:${browserVersionKey}`}
								onEntryContextMenu={(item) => {
									setSelectedKnowledgeFolder(item.path === knowledgeFolderPath);
									setSelectedId(entriesByPath.get(item.path)?.id ?? null);
								}}
								onFolderOpen={(folder) => {
									if (folder.path === knowledgeFolderPath) {
										navigate({
											to: buildOrganizationFilesPath(currentOrganization.slug),
											search: { view: "knowledge" },
										}).catch(console.error);
										return;
									}
									const entry = entriesByPath.get(folder.path);
									if (entry?.kind === "folder") {
										setParentId(entry.id);
									}
								}}
								onSelectionChange={(item) => {
									setSelectedKnowledgeFolder(
										item?.path === knowledgeFolderPath
									);
									setSelectedId(
										item ? (entriesByPath.get(item.path)?.id ?? null) : null
									);
								}}
								reserveBreadcrumbSpace
								title={browserTitle}
								toolbarActions={toolbarActions}
							/>
						</Suspense>
					</ContextMenuTrigger>
					{selectedEntry || selectedKnowledgeFolder || view === "active" ? (
						<ContextMenuContent className="min-w-40 p-1">
							{selectedKnowledgeFolder ? (
								<ContextMenuItem
									disabled={busy}
									index={0}
									onClick={() =>
										navigate({
											to: buildOrganizationFilesPath(currentOrganization.slug),
											search: { view: "knowledge" },
										}).catch(console.error)
									}
								>
									<FolderOpenIcon aria-hidden="true" /> Open
								</ContextMenuItem>
							) : null}
							{!selectedKnowledgeFolder && selectedEntry ? (
								<>
									{view === "active" && selectedEntry.kind === "folder" ? (
										<ContextMenuItem
											index={0}
											onClick={() => setParentId(selectedEntry.id)}
										>
											Open
										</ContextMenuItem>
									) : null}
									{view === "active" && selectedEntry.kind === "file" ? (
										<ContextMenuItem
											disabled={busy}
											index={0}
											onClick={() =>
												runAction(async () => {
													const content = await api.download({
														location,
														fileId: selectedEntry.id,
													});
													downloadContent(selectedEntry.name, content);
												}).catch(console.error)
											}
										>
											Download
										</ContextMenuItem>
									) : null}
									{view === "active" ? (
										<ContextMenuItem
											disabled={busy}
											index={1}
											onClick={() => setMovingEntry(selectedEntry)}
										>
											<FolderOpenIcon aria-hidden="true" />
											Move to folder…
										</ContextMenuItem>
									) : null}
									{view === "active" && selectedEntry.kind === "file" ? (
										<>
											{isEditableRootTextFile(selectedEntry) ? (
												<ContextMenuItem
													disabled={busy}
													index={2}
													onClick={() => setEditingEntry(selectedEntry)}
												>
													<PencilSimpleIcon aria-hidden="true" />
													Edit text
												</ContextMenuItem>
											) : null}
											<ContextMenuItem
												disabled={busy}
												index={3}
												onClick={() => setHistoryEntry(selectedEntry)}
											>
												<ClockCounterClockwiseIcon aria-hidden="true" />
												Version history
											</ContextMenuItem>
											<ContextMenuItem
												disabled={busy}
												index={4}
												onClick={() =>
													setCopyToSpaceEntry({
														entry: selectedEntry,
														location,
														clientMutationId: crypto.randomUUID(),
													})
												}
											>
												<CopyIcon aria-hidden="true" />
												Copy to Space…
											</ContextMenuItem>
										</>
									) : null}
									{view === "active" &&
									selectedEntry.kind === "file" &&
									!currentOrganization.isPersonal ? (
										<ContextMenuItem
											disabled={busy}
											index={5}
											onClick={() => {
												setCopyError(null);
												setCopyingEntry({
													entry: selectedEntry,
													clientMutationId: crypto.randomUUID(),
												});
											}}
										>
											<CopyIcon aria-hidden="true" />
											{location === "my"
												? "Copy to Team files…"
												: "Copy to My files…"}
										</ContextMenuItem>
									) : null}
									{view === "active" ? (
										<ContextMenuItem
											disabled={busy}
											index={6}
											onClick={() => setRenamingEntry(selectedEntry)}
										>
											<PencilSimpleIcon aria-hidden="true" />
											Rename
										</ContextMenuItem>
									) : null}
									<ContextMenuItem
										disabled={busy}
										index={7}
										onClick={() =>
											runAction(() =>
												view === "trash"
													? api.restore({
															location,
															entryId: selectedEntry.id,
															clientMutationId: crypto.randomUUID(),
														})
													: api.trash({
															location,
															entryId: selectedEntry.id,
															clientMutationId: crypto.randomUUID(),
														})
											).catch(console.error)
										}
									>
										{view === "trash" ? (
											<ArrowCounterClockwiseIcon aria-hidden="true" />
										) : (
											<TrashIcon aria-hidden="true" />
										)}
										{view === "trash" ? "Restore" : "Move to Trash"}
									</ContextMenuItem>
								</>
							) : null}
							{selectedKnowledgeFolder || selectedEntry ? null : (
								<>
									<ContextMenuItem
										disabled={busy}
										index={8}
										onClick={() => setFolderDialogOpen(true)}
									>
										<FolderPlusIcon aria-hidden="true" />
										New folder
									</ContextMenuItem>
									{(["markdown", "text", "csv"] as const).map((kind, index) => (
										<ContextMenuItem
											disabled={busy}
											index={9 + index}
											key={kind}
											onClick={() => setNewTextFileKind(kind)}
										>
											<FileTextIcon aria-hidden="true" />
											{NEW_TEXT_FILE_CONTEXT_LABELS[kind]}
										</ContextMenuItem>
									))}
									<ContextMenuItem
										disabled={busy}
										index={12}
										onClick={() => inputRef.current?.click()}
									>
										<UploadSimpleIcon aria-hidden="true" />
										Upload file…
									</ContextMenuItem>
								</>
							)}
						</ContextMenuContent>
					) : null}
				</ContextMenu>
			</div>
			<FolderNameDialog
				error={dialogError}
				onOpenChange={(open) => {
					setFolderDialogOpen(open);
					if (!open) {
						setDialogError(null);
					}
				}}
				onSubmit={async (name) => {
					let savedName: string | null = null;
					const created = await runAction(async () => {
						const folder = await api.createFolder({
							location,
							name,
							parentId,
							clientMutationId: crypto.randomUUID(),
						});
						savedName = folder.name;
					}, "dialog");
					if (created) {
						setFolderDialogOpen(false);
						if (savedName && savedName !== name) {
							toast.message(
								`Created “${savedName}” because “${name}” is already here.`
							);
						}
					}
				}}
				open={folderDialogOpen}
				pending={busy}
			/>
			{newTextFileKind ? (
				<NewTextFileDialog
					error={dialogError}
					kind={newTextFileKind}
					onOpenChange={(open) => {
						if (!open) {
							setNewTextFileKind(null);
							setDialogError(null);
						}
					}}
					onSubmit={async ({ content, name }) => {
						const created = await runAction(
							() =>
								api.upload({
									location,
									bytes: new Blob([content], {
										type: NEW_TEXT_FILE_MIME_TYPES[newTextFileKind],
									}),
									mimeType: NEW_TEXT_FILE_MIME_TYPES[newTextFileKind],
									name,
									parentId,
									clientMutationId: crypto.randomUUID(),
								}),
							"dialog"
						);
						if (created) {
							setNewTextFileKind(null);
						}
					}}
					open={true}
					pending={busy}
				/>
			) : null}
			{historyEntry ? (
				<FileRootVersionHistory
					api={api}
					entry={historyEntry}
					key={`${location}:${historyEntry.id}`}
					location={location}
					onClose={() => setHistoryEntry(null)}
				/>
			) : null}
			{editingEntry ? (
				<FileRootTextEditor
					api={api}
					entry={editingEntry}
					key={`${location}:${editingEntry.id}`}
					location={location}
					onClose={() => setEditingEntry(null)}
					onSaved={refresh}
				/>
			) : null}
			<RenameEntryDialog
				entry={renamingEntry}
				error={dialogError}
				onOpenChange={(open) => {
					if (!open) {
						setRenamingEntry(null);
						setDialogError(null);
					}
				}}
				onSubmit={async (entry, name) => {
					const updated = await runAction(
						() =>
							api.updateEntry({
								location,
								entryId: entry.id,
								name,
								clientMutationId: crypto.randomUUID(),
							}),
						"dialog"
					);
					if (updated) {
						setRenamingEntry(null);
					}
				}}
				pending={busy}
			/>
			<MoveEntryDialog
				entry={movingEntry}
				error={dialogError}
				loadDestinations={(excludedFolderId) =>
					loadFileRootMoveDestinations({ api, excludedFolderId, location })
				}
				onOpenChange={(open) => {
					if (!open) {
						setMovingEntry(null);
						setDialogError(null);
					}
				}}
				onSubmit={async (entry, destinationId) => {
					const updated = await runAction(
						() =>
							api.updateEntry({
								location,
								entryId: entry.id,
								parentId: destinationId,
								clientMutationId: crypto.randomUUID(),
							}),
						"dialog"
					);
					if (updated) {
						setMovingEntry(null);
					}
				}}
				pending={busy}
				queryKey={[
					"file-root",
					currentOrganization.id,
					location,
					"move-destinations",
				]}
				rootLabel={location === "my" ? "My files" : "Team files"}
			/>
			<AlertDialog
				onOpenChange={(open) => {
					if (!open) {
						setCopyingEntry(null);
					}
				}}
				open={copyingEntry !== null}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Copy {copyingEntry?.entry.name} to{" "}
							{copyDestination === "team" ? "Team files" : "My files"}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							{copyDestination === "team"
								? "Team members will be able to open this copy. Your original stays private."
								: "Only you can open this copy. The Team original stays in Team files."}{" "}
							The copy keeps this version and won't follow later changes.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{copyError ? (
						<p className="text-destructive text-sm" role="alert">
							{copyError}
						</p>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={busy}
							onClick={async (event) => {
								event.preventDefault();
								const choice = copyingEntry;
								if (!choice) {
									return;
								}
								setBusy(true);
								setCopyError(null);
								try {
									await api.copyRevision({
										location: copyDestination,
										body: {
											sourceLocation: location,
											sourceFileId: choice.entry.id,
											sourceRevision: choice.entry.latestRevision.revision,
											name: choice.entry.name,
											parentId: null,
											clientMutationId: choice.clientMutationId,
										},
									});
									await refresh();
									setCopyingEntry(null);
									changeView(copyDestination, "active");
								} catch (cause) {
									setCopyError(
										cause instanceof Error
											? cause.message
											: "Files couldn't copy that file."
									);
								} finally {
									setBusy(false);
								}
							}}
							type="button"
						>
							Copy file
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			{copyToSpaceEntry ? (
				<CopyToSpaceDialog
					api={api}
					choice={copyToSpaceEntry}
					key={copyToSpaceEntry.clientMutationId}
					onClose={() => setCopyToSpaceEntry(null)}
					organizationId={currentOrganization.id}
				/>
			) : null}
		</section>
	);
}

function FileRootVersionHistory(input: {
	api: ReturnType<typeof createFileRootApi>;
	entry: Extract<FileRootEntry, { kind: "file" }>;
	location: FileRootLocation;
	onClose: () => void;
}) {
	const [downloadingRevision, setDownloadingRevision] = useState<number | null>(
		null
	);
	const [downloadError, setDownloadError] = useState<string | null>(null);
	const history = useQuery({
		queryKey: ["file-root-revisions", input.location, input.entry.id],
		queryFn: () =>
			input.api.listRevisions({
				location: input.location,
				fileId: input.entry.id,
			}),
	});
	return (
		<Dialog onOpenChange={(open) => !open && input.onClose()} open>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Version history · {input.entry.name}</DialogTitle>
				</DialogHeader>
				{history.isPending ? (
					<p className="text-muted-foreground text-sm">Loading versions…</p>
				) : null}
				{history.isError ? (
					<div
						className="flex items-center justify-between gap-3 text-sm"
						role="alert"
					>
						<span>Versions couldn’t be loaded.</span>
						<Button
							onClick={() => history.refetch()}
							size="sm"
							variant="outline"
						>
							Try again
						</Button>
					</div>
				) : null}
				{history.data ? (
					<ScrollArea className="max-h-80">
						<ul className="divide-y">
							{history.data.revisions.map((revision) => (
								<li
									className="flex items-center justify-between gap-3 py-3"
									key={revision.id}
								>
									<div className="min-w-0 text-sm">
										<p className="font-medium">
											Version {revision.revision}
											{revision.revision ===
											history.data.file.latestRevision.revision
												? " · Current"
												: ""}
										</p>
										<p className="text-muted-foreground text-xs">
											{formatFileDateTime(revision.createdAt)} ·{" "}
											{formatFileSize(revision.sizeBytes)}
										</p>
									</div>
									<Button
										aria-label={`Download version ${revision.revision}`}
										disabled={downloadingRevision !== null}
										onClick={async () => {
											setDownloadingRevision(revision.revision);
											setDownloadError(null);
											try {
												const content = await input.api.download({
													location: input.location,
													fileId: input.entry.id,
													revision: revision.revision,
												});
												downloadContent(input.entry.name, content);
											} catch (error) {
												setDownloadError(
													error instanceof Error
														? error.message
														: "This version couldn’t be downloaded."
												);
											} finally {
												setDownloadingRevision(null);
											}
										}}
										size="sm"
										variant="outline"
									>
										<DownloadSimpleIcon aria-hidden="true" />
										Download
									</Button>
								</li>
							))}
						</ul>
					</ScrollArea>
				) : null}
				{downloadError ? (
					<p className="text-destructive text-sm" role="alert">
						{downloadError}
					</p>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function isEditableRootTextFile(
	entry: FileRootEntry
): entry is Extract<FileRootEntry, { kind: "file" }> {
	if (entry.kind !== "file") {
		return false;
	}
	return (
		entry.latestRevision.sizeBytes <= SPACE_FILE_MAX_TEXT_EDIT_SIZE_BYTES &&
		["text/markdown", "text/plain", "text/csv"].includes(
			entry.latestRevision.mimeType.split(";")[0]?.toLowerCase() ?? ""
		)
	);
}

function FileRootTextEditor(input: {
	api: ReturnType<typeof createFileRootApi>;
	entry: Extract<FileRootEntry, { kind: "file" }>;
	location: FileRootLocation;
	onClose: () => void;
	onSaved: () => Promise<void>;
}) {
	const [draft, setDraft] = useState("");
	const [savedDraft, setSavedDraft] = useState("");
	const [loadedRevision, setLoadedRevision] = useState<number | null>(null);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [conflict, setConflict] = useState(false);
	const [leaveOpen, setLeaveOpen] = useState(false);
	const content = useQuery({
		queryKey: [
			"file-root-edit",
			input.location,
			input.entry.id,
			input.entry.latestRevision.revision,
		],
		queryFn: () =>
			input.api.download({
				location: input.location,
				fileId: input.entry.id,
			}),
	});
	useEffect(() => {
		if (!content.data || loadedRevision !== null) {
			return;
		}
		try {
			if (content.data.bytes.byteLength > SPACE_FILE_MAX_TEXT_EDIT_SIZE_BYTES) {
				throw new Error("This file is too large to edit here.");
			}
			const text = new TextDecoder("utf-8", { fatal: true }).decode(
				content.data.bytes
			);
			setDraft(text);
			setSavedDraft(text);
			setLoadedRevision(content.data.revision);
		} catch (error) {
			setSaveError(
				error instanceof Error ? error.message : "This file couldn't be opened."
			);
		}
	}, [content.data, loadedRevision]);
	const hasUnsavedChanges = loadedRevision !== null && draft !== savedDraft;
	const overLimit = utf8ByteLength(draft) > SPACE_FILE_MAX_TEXT_EDIT_SIZE_BYTES;
	const save = async (): Promise<boolean> => {
		if (
			loadedRevision === null ||
			!hasUnsavedChanges ||
			overLimit ||
			saving ||
			conflict
		) {
			return false;
		}
		const savingDraft = draft;
		setSaving(true);
		setSaveError(null);
		try {
			const saved = await input.api.updateContent({
				location: input.location,
				fileId: input.entry.id,
				bytes: new Blob([savingDraft], {
					type: input.entry.latestRevision.mimeType,
				}),
				mimeType: input.entry.latestRevision.mimeType,
				baseRevision: loadedRevision,
				clientMutationId: crypto.randomUUID(),
			});
			setSavedDraft(savingDraft);
			setLoadedRevision(saved.latestRevision.revision);
			await input.onSaved();
			toast.success("File saved");
			return true;
		} catch (error) {
			if (toStructuredApiClientFailure(error).code === "space_file.conflict") {
				setConflict(true);
				setSaveError(
					"Someone saved a newer version. Your changes are still here. Copy them before reopening the latest version."
				);
			} else {
				setSaveError(
					error instanceof Error
						? error.message
						: "This file couldn't be saved."
				);
			}
			return false;
		} finally {
			setSaving(false);
		}
	};
	return (
		<>
			<UnsavedChangesGuard
				description="Your edits to this file haven't been saved."
				hasUnsavedChanges={hasUnsavedChanges}
				onSave={save}
				saving={saving}
			/>
			<Dialog
				onOpenChange={(open) => {
					if (open || saving) {
						return;
					}
					if (hasUnsavedChanges) {
						setLeaveOpen(true);
					} else {
						input.onClose();
					}
				}}
				open
			>
				<DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>Edit {input.entry.name}</DialogTitle>
						<DialogDescription>
							Saving creates a new version. Another person's newer version won't
							be overwritten.
						</DialogDescription>
					</DialogHeader>
					{content.isPending ? (
						<p className="text-muted-foreground text-sm">Loading file…</p>
					) : null}
					{content.isError ? (
						<div
							className="flex items-center justify-between gap-3"
							role="alert"
						>
							<p>This file couldn't be opened.</p>
							<Button
								onClick={() => content.refetch()}
								size="sm"
								variant="outline"
							>
								Try again
							</Button>
						</div>
					) : null}
					{loadedRevision !== null ? (
						<>
							<Textarea
								aria-label="File contents"
								className="min-h-72 flex-1 resize-none font-mono text-sm leading-6"
								disabled={saving}
								onChange={(event) => setDraft(event.currentTarget.value)}
								spellCheck={false}
								value={draft}
							/>
							<p
								className={
									overLimit
										? "text-destructive text-xs"
										: "text-muted-foreground text-xs"
								}
							>
								{formatFileSize(utf8ByteLength(draft))} / 1 MB
								{overLimit ? " — too long to save" : ""}
							</p>
						</>
					) : null}
					{saveError ? (
						<p className="text-destructive text-sm" role="alert">
							{saveError}
						</p>
					) : null}
					<DialogFooter>
						<Button
							disabled={!hasUnsavedChanges || overLimit || saving || conflict}
							onClick={() => save().catch(console.error)}
						>
							{saving ? "Saving…" : "Save changes"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<UnsavedChangesDialog
				description="Your edits to this file haven't been saved."
				onCancel={() => setLeaveOpen(false)}
				onDiscard={input.onClose}
				onSaveAndLeave={async () => {
					const saved = await save();
					if (saved) {
						input.onClose();
					}
					return saved;
				}}
				open={leaveOpen}
				saving={saving}
			/>
		</>
	);
}

function CopyToSpaceDialog(input: {
	api: ReturnType<typeof createFileRootApi>;
	choice: {
		entry: Extract<FileRootEntry, { kind: "file" }>;
		location: FileRootLocation;
		clientMutationId: string;
	};
	onClose: () => void;
	organizationId: string;
}) {
	const [spaceId, setSpaceId] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { selectedHumanProfile } = useSelectedHumanProfile({
		selectDefaultWhenMissing: true,
	});
	const spacesQuery = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: !!selectedHumanProfile,
			profileId: selectedHumanProfile?.openMeldProfileId ?? "",
		})
	);
	const spaces = [
		...(spacesQuery.data?.pinnedItems ?? []),
		...(spacesQuery.data?.spaceItems ?? []),
	].filter(
		(space) =>
			space.organizationId === input.organizationId &&
			!space.directMessageProfileIds
	);
	const selectedSpace = spaces.find((space) => space.spaceId === spaceId);
	return (
		<AlertDialog onOpenChange={(open) => !open && input.onClose()} open>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						Copy {input.choice.entry.name} to a Space?
					</AlertDialogTitle>
					<AlertDialogDescription>
						People and agents in the Space can open the copy. The original stays
						in {input.choice.location === "my" ? "My files" : "Team files"}. The
						copy keeps this version and won’t follow later changes.
					</AlertDialogDescription>
				</AlertDialogHeader>
				{spacesQuery.isPending ? (
					<p className="text-muted-foreground text-sm">Loading your Spaces…</p>
				) : null}
				{spacesQuery.isError ? (
					<p className="text-destructive text-sm" role="alert">
						Couldn’t load your Spaces. Try again.
					</p>
				) : null}
				{spacesQuery.isSuccess && spaces.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						You haven’t joined any Spaces in this Team.
					</p>
				) : null}
				{spaces.length > 0 ? (
					<Select onValueChange={setSpaceId} value={spaceId}>
						<SelectTrigger
							aria-label="Destination Space"
							displayValue={selectedSpace?.spaceName}
							placeholder="Choose a Space"
						/>
						<SelectContent>
							{spaces.map((space, index) => (
								<SelectItem
									index={index}
									key={space.spaceId}
									value={space.spaceId}
								>
									{space.spaceName}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : null}
				{error ? (
					<p className="text-destructive text-sm" role="alert">
						{error}
					</p>
				) : null}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						disabled={busy || !selectedSpace}
						onClick={async (event) => {
							event.preventDefault();
							if (!selectedSpace) {
								return;
							}
							setBusy(true);
							setError(null);
							try {
								await input.api.copyToSpace({
									spaceId: selectedSpace.spaceId,
									body: {
										sourceLocation: input.choice.location,
										sourceFileId: input.choice.entry.id,
										sourceRevision: input.choice.entry.latestRevision.revision,
										name: input.choice.entry.name,
										parentId: null,
										clientMutationId: input.choice.clientMutationId,
									},
								});
								input.onClose();
								toast.success(`Copied to ${selectedSpace.spaceName}.`);
							} catch (cause) {
								setError(
									cause instanceof Error
										? cause.message
										: "Files couldn’t copy that file."
								);
							} finally {
								setBusy(false);
							}
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

async function loadFileRootMoveDestinations(input: {
	api: ReturnType<typeof createFileRootApi>;
	excludedFolderId?: string;
	location: FileRootLocation;
}): Promise<readonly { id: string; path: string }[]> {
	const destinations: { id: string; path: string }[] = [];
	const pending: Array<string | null> = [null];
	const visited = new Set<string>();
	while (pending.length > 0) {
		const parentId = pending.shift() ?? null;
		const page = await input.api.list({ location: input.location, parentId });
		for (const entry of page.entries) {
			if (
				entry.kind !== "folder" ||
				entry.id === input.excludedFolderId ||
				visited.has(entry.id)
			) {
				continue;
			}
			visited.add(entry.id);
			destinations.push({ id: entry.id, path: entry.path });
			pending.push(entry.id);
			if (destinations.length > 500) {
				throw new Error("This location has too many folders to show here.");
			}
		}
	}
	return destinations.sort((left, right) =>
		left.path.localeCompare(right.path)
	);
}

async function resolveFileUrl(input: {
	api: ReturnType<typeof createFileRootApi>;
	entry: Extract<FileRootEntry, { kind: "file" }>;
	organizationId: string;
	location: FileRootLocation;
	objectUrls: Map<string, string>;
}): Promise<string> {
	const key = `${input.organizationId}:${input.location}:${input.entry.id}:${input.entry.latestRevision.revision}`;
	const existing = input.objectUrls.get(key);
	if (existing) {
		return existing;
	}
	const content = await input.api.download({
		location: input.location,
		fileId: input.entry.id,
		revision: input.entry.latestRevision.revision,
	});
	const url = URL.createObjectURL(
		new Blob([content.bytes], { type: content.mimeType })
	);
	input.objectUrls.set(key, url);
	return url;
}
