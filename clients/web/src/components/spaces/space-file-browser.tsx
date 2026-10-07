"use client";

import type { SpaceApi } from "@openmeld/api-client";
import { isSpaceFileTextEditable } from "@openmeld/schemas";
import type {
	SpaceFileBreadcrumb,
	SpaceFileDescriptor,
	SpaceFileEntry,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	ContextMenu,
	ContextMenuTrigger,
} from "@openmeld/ui/components/context-menu";
import {
	DropdownMenuSeparator as ContextMenuSeparator,
	DropdownMenu,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { FluidContextMenu } from "@openmeld/ui/fluid/context-menu";
import {
	FluidDropdownMenuContent as ContextMenuContent,
	FluidDropdownMenuItem as ContextMenuItem,
	FluidDropdownMenuContent,
	FluidDropdownMenuGroup,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowClockwiseIcon,
	ArrowCounterClockwiseIcon,
	CaretRightIcon,
	CopyIcon,
	DotsThreeIcon,
	FileIcon,
	FileTextIcon,
	FolderIcon,
	FolderOpenIcon,
	FolderPlusIcon,
	ImageIcon,
	PencilSimpleIcon,
	PlusIcon,
	PushPinIcon,
	TrashIcon,
	UploadSimpleIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import {
	type DragEvent,
	lazy,
	type ReactNode,
	type RefObject,
	Suspense,
	useEffect,
	useRef,
	useState,
} from "react";
import { ReadPausedState } from "#/components/app/read-paused-state";
import type { FileSystemItem } from "#/components/extend/file-system";
import { mayShowCachedReadData } from "#/lib/query-display";
import { useDelayedPending } from "#/lib/use-delayed-pending";
import { spaceFileContentQueryOptions } from "#/query/spaces/space-files";
import { SpaceFileHtmlBadge } from "./space-file-html-badge";
import {
	formatFileSize,
	formatShortDate,
	resolveSpaceFileErrorMessage,
} from "./space-file-utils";
import { SpaceFilesSkeleton } from "./space-panel-skeletons";
import { useSpaceFilePinAction } from "./space-pins";
import { useSpaceFileImageSource } from "./use-space-file-image-source";

const FileSystem = lazy(() =>
	import("#/components/extend/file-system").then((module) => ({
		default: module.FileSystem,
	}))
);

function DelayedSpaceFilesSkeleton() {
	return useDelayedPending(true) ? <SpaceFilesSkeleton /> : null;
}

export function SpaceFileBrowser(input: {
	actionError: string | null;
	api: Pick<SpaceApi, "downloadFileContent">;
	breadcrumbs: readonly SpaceFileBreadcrumb[];
	busy: boolean;
	canWrite: boolean;
	entries: readonly SpaceFileEntry[];
	error: unknown;
	fileInputRef: RefObject<HTMLInputElement | null>;
	isPending: boolean;
	isPaused: boolean;
	loaded: boolean;
	onDismissError: () => void;
	onMove: (entry: SpaceFileEntry) => void;
	onCopy?: (entry: SpaceFileDescriptor, destination: "team" | "my") => void;
	onNewFolder: () => void;
	onNewTextFile: (kind: "markdown" | "text" | "csv") => void;
	onOpen: (entry: SpaceFileEntry) => void;
	onOpenBreadcrumb: (folderId: string | null, name: string) => void;
	onRename: (entry: SpaceFileEntry) => void;
	onRestore: (entry: SpaceFileEntry) => void;
	onRetry: () => void;
	onTrash: (entry: SpaceFileEntry) => void;
	onUploadFiles: (files: readonly File[]) => Promise<void>;
	spaceId: string;
	view: "active" | "trash";
	onViewChange: (view: "active" | "trash") => void;
}) {
	const [fileDragDepth, setFileDragDepth] = useState(0);
	const showCachedReadError =
		input.loaded && input.error && mayShowCachedReadData(input.error);
	const acceptingDrop = input.canWrite && input.view === "active";
	const fileDragActive = acceptingDrop && fileDragDepth > 0;
	const enterFileDrag = (event: DragEvent<HTMLElement>) => {
		if (!(acceptingDrop && isFileDrag(event))) {
			return;
		}
		event.preventDefault();
		setFileDragDepth((depth) => depth + 1);
	};
	const leaveFileDrag = (event: DragEvent<HTMLElement>) => {
		if (!acceptingDrop) {
			return;
		}
		event.preventDefault();
		setFileDragDepth((depth) => Math.max(0, depth - 1));
	};
	const dropFiles = (event: DragEvent<HTMLElement>) => {
		if (!(acceptingDrop && isFileDrag(event))) {
			return;
		}
		event.preventDefault();
		setFileDragDepth(0);
		input
			.onUploadFiles(Array.from(event.dataTransfer.files))
			.catch(() => undefined);
	};
	const toolbarStart =
		input.view === "active" ? (
			<div className="flex min-w-0 flex-wrap items-center gap-1.5">
				{input.loaded && !input.canWrite ? (
					<Badge variant="outline">View only</Badge>
				) : null}
				{input.canWrite ? (
					<>
						<input
							className="hidden"
							multiple
							onChange={(event) => {
								const files = Array.from(event.currentTarget.files ?? []);
								event.currentTarget.value = "";
								input.onUploadFiles(files).catch(() => undefined);
							}}
							ref={input.fileInputRef}
							type="file"
						/>
						<Button
							disabled={input.busy}
							onClick={() => input.fileInputRef.current?.click()}
							size="sm"
							type="button"
							variant="outline"
						>
							<UploadSimpleIcon aria-hidden="true" />
							Upload
						</Button>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={<Button disabled={input.busy} size="sm" />}
							>
								<PlusIcon aria-hidden="true" />
								New
							</DropdownMenuTrigger>
							<FluidDropdownMenuContent align="start">
								<FluidDropdownMenuItem
									index={0}
									onClick={() => input.onNewTextFile("markdown")}
								>
									<FileTextIcon aria-hidden="true" />
									Markdown file
								</FluidDropdownMenuItem>
								<FluidDropdownMenuItem
									index={1}
									onClick={() => input.onNewTextFile("text")}
								>
									<FileTextIcon aria-hidden="true" />
									Text file
								</FluidDropdownMenuItem>
								<FluidDropdownMenuItem
									index={2}
									onClick={() => input.onNewTextFile("csv")}
								>
									<FileTextIcon aria-hidden="true" />
									CSV file
								</FluidDropdownMenuItem>
								<FluidDropdownMenuItem index={3} onClick={input.onNewFolder}>
									<FolderPlusIcon aria-hidden="true" />
									Folder
								</FluidDropdownMenuItem>
								<DropdownMenuSeparator />
								<FluidDropdownMenuItem
									index={4}
									onClick={() => input.fileInputRef.current?.click()}
								>
									<UploadSimpleIcon aria-hidden="true" />
									Upload file…
								</FluidDropdownMenuItem>
							</FluidDropdownMenuContent>
						</DropdownMenu>
					</>
				) : null}
				{input.canWrite ? (
					<Button
						onClick={() => input.onViewChange("trash")}
						size="sm"
						type="button"
						variant="outline"
					>
						<TrashIcon aria-hidden="true" />
						Trash
					</Button>
				) : null}
			</div>
		) : null;
	const browserContent = (
		<SpaceFileBrowserContent
			api={input.api}
			canWrite={input.canWrite}
			entries={input.entries}
			error={showCachedReadError ? null : input.error}
			isPaused={input.isPaused}
			isPending={input.isPending}
			onCopy={input.onCopy}
			onMove={input.onMove}
			onNewFolder={input.onNewFolder}
			onNewTextFile={input.onNewTextFile}
			onOpen={input.onOpen}
			onRename={input.onRename}
			onRestore={input.onRestore}
			onRetry={input.onRetry}
			onTrash={input.onTrash}
			onUpload={() => input.fileInputRef.current?.click()}
			spaceId={input.spaceId}
			toolbarStart={toolbarStart}
			view={input.view}
		/>
	);
	return (
		// biome-ignore lint/a11y/noNoninteractiveElementInteractions: the Files surface is a mouse drop target; the Upload button provides the keyboard equivalent.
		<section
			aria-label="Space files"
			className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
			onDragEnter={enterFileDrag}
			onDragLeave={leaveFileDrag}
			onDragOver={(event) => {
				if (acceptingDrop && isFileDrag(event)) {
					event.preventDefault();
					event.dataTransfer.dropEffect = "copy";
				}
			}}
			onDrop={dropFiles}
		>
			{fileDragActive ? (
				<div className="pointer-events-none absolute inset-3 z-30 grid place-items-center rounded-xl border-2 border-primary border-dashed bg-background/95 shadow-lg">
					<div className="text-center">
						<UploadSimpleIcon
							aria-hidden="true"
							className="mx-auto size-8 text-primary"
						/>
						<p className="mt-3 font-medium text-sm">Drop files to upload</p>
						<p className="mt-1 text-muted-foreground text-xs">
							They’ll be shared in this folder.
						</p>
					</div>
				</div>
			) : null}
			<div className="flex flex-wrap items-center justify-between gap-3 border-border border-b px-5 py-3.5">
				<div className="min-w-0">
					<div className="flex min-w-0 items-center gap-1 text-sm">
						{input.breadcrumbs.map((crumb, index) => (
							<span
								className="flex min-w-0 items-center gap-1"
								key={`${crumb.id ?? "root"}:${crumb.name}`}
							>
								{index > 0 ? (
									<CaretRightIcon
										aria-hidden="true"
										className="size-3.5 shrink-0 text-muted-foreground"
									/>
								) : null}
								{index === input.breadcrumbs.length - 1 ? (
									<span className="max-w-48 truncate font-medium text-foreground">
										{crumb.name}
									</span>
								) : (
									<button
										className="max-w-48 truncate rounded-sm px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										onClick={() => input.onOpenBreadcrumb(crumb.id, crumb.name)}
										type="button"
									>
										{crumb.name}
									</button>
								)}
							</span>
						))}
					</div>
					<p className="mt-1 text-muted-foreground text-xs">
						{resolveFilesSubtitle(input)}
					</p>
				</div>
				{input.view === "trash" ? (
					<Button
						onClick={() => input.onViewChange("active")}
						size="sm"
						type="button"
						variant="outline"
					>
						<ArrowCounterClockwiseIcon aria-hidden="true" />
						Back to Files
					</Button>
				) : null}
			</div>
			{input.actionError ? (
				<div
					className="flex items-center justify-between gap-3 border-destructive/30 border-b bg-destructive/5 px-5 py-3 text-destructive text-sm"
					role="alert"
				>
					<span>{input.actionError}</span>
					<Button
						onClick={input.onDismissError}
						size="sm"
						type="button"
						variant="ghost"
					>
						Dismiss
					</Button>
				</div>
			) : null}
			{showCachedReadError ? (
				<output className="flex flex-wrap items-center justify-between gap-3 border-border/70 border-b bg-card/35 px-5 py-3 text-sm">
					<span>Couldn't refresh Files. Showing the last loaded list.</span>
					<Button onClick={input.onRetry} size="sm" variant="outline">
						Retry
					</Button>
				</output>
			) : null}
			{input.view === "active" ? (
				<div className="min-h-0 flex-1 p-5">{browserContent}</div>
			) : (
				<ScrollArea
					className="min-h-0 flex-1"
					contentClassName="p-5"
					orientation="vertical"
				>
					{browserContent}
				</ScrollArea>
			)}
		</section>
	);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This boundary keeps the active Finder and Trash on their existing permission and error paths.
function SpaceFileBrowserContent(input: {
	api: Pick<SpaceApi, "downloadFileContent">;
	canWrite: boolean;
	entries: readonly SpaceFileEntry[];
	error: unknown;
	isPending: boolean;
	isPaused: boolean;
	onOpen: (entry: SpaceFileEntry) => void;
	onMove: (entry: SpaceFileEntry) => void;
	onCopy?: (entry: SpaceFileDescriptor, destination: "team" | "my") => void;
	onNewFolder: () => void;
	onNewTextFile: (kind: "markdown" | "text" | "csv") => void;
	onRename: (entry: SpaceFileEntry) => void;
	onRetry: () => void;
	onRestore: (entry: SpaceFileEntry) => void;
	onTrash: (entry: SpaceFileEntry) => void;
	onUpload: () => void;
	spaceId: string;
	toolbarStart: ReactNode;
	view: "active" | "trash";
}) {
	const queryClient = useQueryClient();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const selectedEntry = input.entries.find((entry) => entry.id === selectedId);
	const showPending = useDelayedPending(input.isPending && !input.isPaused);
	let pendingEmptyContent: ReactNode;
	if (input.isPending) {
		pendingEmptyContent = input.isPaused ? (
			<ReadPausedState subject="Files" />
		) : (
			<div className="min-h-64" />
		);
	}
	if (input.isPending && input.view === "trash") {
		if (input.isPaused) {
			return <ReadPausedState subject="Files" />;
		}
		return showPending ? <SpaceFilesSkeleton /> : null;
	}
	if (input.error && input.view === "trash") {
		return <SpaceFilesLoadError error={input.error} onRetry={input.onRetry} />;
	}
	if (input.entries.length === 0 && input.view === "trash") {
		const description = resolveEmptyStateDescription({
			canWrite: input.canWrite,
			view: input.view,
		});
		return (
			<div className="flex min-h-64 flex-col items-center justify-center rounded-md border border-border/70 border-dashed px-6 text-center">
				{input.view === "trash" ? (
					<TrashIcon
						aria-hidden="true"
						className="size-8 text-muted-foreground"
						weight="duotone"
					/>
				) : (
					<FolderOpenIcon
						aria-hidden="true"
						className="size-8 text-muted-foreground"
						weight="duotone"
					/>
				)}
				<h2 className="mt-3 font-medium">
					{input.view === "trash" ? "Trash is empty" : "This folder is empty"}
				</h2>
				<p className="mt-1 max-w-md text-muted-foreground text-sm">
					{description}
				</p>
			</div>
		);
	}
	if (input.view === "active") {
		const items: FileSystemItem[] = input.entries.map((entry) =>
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
						badge: entry.origin === "chat_upload" ? "Chat upload" : undefined,
						contentType: entry.latestRevision.mimeType,
						etag: `${entry.id}:${entry.latestRevision.revision}`,
						size: entry.latestRevision.sizeBytes,
						createdAt: entry.createdAt,
						updatedAt: entry.updatedAt,
					}
		);
		const entriesByPath = new Map(
			items.map((item, index) => [item.path, input.entries[index]])
		);
		return (
			<ContextMenu>
				<ContextMenuTrigger
					className="block h-full min-h-0"
					onContextMenuCapture={(event) => {
						if (!(event.target as Element).closest('[role="option"]')) {
							setSelectedId(null);
						}
					}}
				>
					{mounted ? (
						<Suspense fallback={<DelayedSpaceFilesSkeleton />}>
							<FileSystem
								className="h-full min-h-0"
								embedded
								emptyContent={pendingEmptyContent}
								errorContent={
									input.error ? (
										<SpaceFilesLoadError
											error={input.error}
											onRetry={input.onRetry}
										/>
									) : undefined
								}
								isLoading={input.isPending && !input.isPaused && showPending}
								items={items}
								loadPreviewImageUrl={async (file) => {
									const entry = entriesByPath.get(file.path);
									if (
										entry?.kind !== "file" ||
										!entry.latestRevision.mimeType.startsWith("image/")
									) {
										return null;
									}
									const content = await queryClient.fetchQuery(
										spaceFileContentQueryOptions({
											api: input.api,
											fileId: entry.id,
											revision: entry.latestRevision.revision,
											spaceId: input.spaceId,
										})
									);
									return content.mediaPreview?.getSnapshot() ?? null;
								}}
								onEntryContextMenu={(item) =>
									setSelectedId(entriesByPath.get(item.path)?.id ?? null)
								}
								onFileOpen={(file) => {
									const entry = entriesByPath.get(file.path);
									if (entry) {
										input.onOpen(entry);
									}
								}}
								onFolderOpen={(folder) => {
									const entry = entriesByPath.get(folder.path);
									if (entry) {
										input.onOpen(entry);
									}
								}}
								onSelectionChange={(item) => {
									setSelectedId(
										item ? (entriesByPath.get(item.path)?.id ?? null) : null
									);
								}}
								renderFilePreview={(file) => {
									const entry = entriesByPath.get(file.path);
									return entry?.kind === "file" &&
										entry.latestRevision.mimeType.startsWith("image/") ? (
										<SpaceFileImageThumbnail
											api={input.api}
											entry={entry}
											spaceId={input.spaceId}
										/>
									) : null;
								}}
								title="Files"
								toolbarStart={input.toolbarStart}
							/>
						</Suspense>
					) : (
						<DelayedSpaceFilesSkeleton />
					)}
				</ContextMenuTrigger>
				{selectedEntry || input.canWrite ? (
					<ContextMenuContent className="min-w-44 p-1">
						{selectedEntry ? (
							<SpaceFileContextActions
								canWrite={input.canWrite}
								entry={selectedEntry}
								onCopy={input.onCopy}
								onMove={() => input.onMove(selectedEntry)}
								onOpen={() => input.onOpen(selectedEntry)}
								onRename={() => input.onRename(selectedEntry)}
								onTrash={() => input.onTrash(selectedEntry)}
							/>
						) : (
							<>
								<ContextMenuItem index={0} onClick={input.onNewFolder}>
									<FolderPlusIcon aria-hidden="true" />
									New folder
								</ContextMenuItem>
								<ContextMenuItem
									index={1}
									onClick={() => input.onNewTextFile("markdown")}
								>
									<FileTextIcon aria-hidden="true" />
									New Markdown file
								</ContextMenuItem>
								<ContextMenuItem
									index={2}
									onClick={() => input.onNewTextFile("text")}
								>
									<FileTextIcon aria-hidden="true" />
									New text file
								</ContextMenuItem>
								<ContextMenuItem
									index={3}
									onClick={() => input.onNewTextFile("csv")}
								>
									<FileTextIcon aria-hidden="true" />
									New CSV file
								</ContextMenuItem>
								<ContextMenuSeparator />
								<ContextMenuItem index={4} onClick={input.onUpload}>
									<UploadSimpleIcon aria-hidden="true" />
									Upload file…
								</ContextMenuItem>
							</>
						)}
					</ContextMenuContent>
				) : null}
			</ContextMenu>
		);
	}

	return (
		<div className="overflow-hidden rounded-md border border-border/70">
			<div className="grid grid-cols-[minmax(0,1fr)_9rem_8rem_2rem] gap-3 border-border border-b bg-muted/25 px-4 py-2 text-muted-foreground text-xs max-sm:grid-cols-[minmax(0,1fr)_2rem]">
				<span>Name</span>
				<span className="max-sm:hidden">
					{input.view === "trash" ? "Deleted" : "Updated"}
				</span>
				<span className="max-sm:hidden">Size</span>
				<span className="sr-only">Actions</span>
			</div>
			<ul className="divide-y divide-border/70">
				{input.entries.map((entry) => (
					<FluidContextMenu
						key={entry.id}
						target={
							<li className="group/entry grid grid-cols-[minmax(0,1fr)_9rem_8rem_2rem] items-center gap-3 px-2 py-1.5 hover:bg-muted/35 max-sm:grid-cols-[minmax(0,1fr)_2rem]">
								{input.view === "active" ? (
									<button
										className="flex min-w-0 items-center gap-3 rounded-sm px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										onClick={() => input.onOpen(entry)}
										type="button"
									>
										<SpaceFileEntryVisual
											api={input.api}
											entry={entry}
											previewImages={true}
											spaceId={input.spaceId}
										/>
										<span className="min-w-0">
											<span className="flex min-w-0 items-center gap-1.5">
												<span className="block truncate font-medium text-sm">
													{entry.name}
												</span>
												{entry.kind === "file" &&
												entry.origin === "chat_upload" ? (
													<Badge className="shrink-0" variant="outline">
														Chat upload
													</Badge>
												) : null}
											</span>
											<span className="block truncate text-muted-foreground text-xs sm:hidden">
												{entry.kind === "folder"
													? "Folder"
													: formatFileSize(entry.latestRevision.sizeBytes)}
											</span>
										</span>
									</button>
								) : (
									<div className="flex min-w-0 items-center gap-3 px-2 py-1.5">
										<SpaceFileEntryVisual
											api={input.api}
											entry={entry}
											previewImages={false}
											spaceId={input.spaceId}
										/>
										<span className="min-w-0">
											<span className="block truncate font-medium text-sm">
												{entry.name}
											</span>
											<span className="block truncate text-muted-foreground text-xs">
												Deleted by{" "}
												{entry.trashedBy?.displayName ?? "a Space member"}
											</span>
										</span>
									</div>
								)}
								<span className="truncate text-muted-foreground text-xs max-sm:hidden">
									{formatShortDate(entry.trashedAt ?? entry.updatedAt)}
								</span>
								<span className="text-muted-foreground text-xs max-sm:hidden">
									{entry.kind === "folder"
										? "—"
										: formatFileSize(entry.latestRevision.sizeBytes)}
								</span>
								<EntryRowAction
									canWrite={input.canWrite}
									entry={entry}
									onCopy={input.onCopy}
									onMove={() => input.onMove(entry)}
									onOpen={() => input.onOpen(entry)}
									onRename={() => input.onRename(entry)}
									onRestore={() => input.onRestore(entry)}
									onTrash={() => input.onTrash(entry)}
									view={input.view}
								/>
							</li>
						}
					>
						{input.view === "trash" ? (
							<ContextMenuItem index={0} onClick={() => input.onRestore(entry)}>
								<ArrowCounterClockwiseIcon aria-hidden="true" /> Restore
							</ContextMenuItem>
						) : (
							<SpaceFileContextActions
								canWrite={input.canWrite}
								entry={entry}
								onCopy={input.onCopy}
								onMove={() => input.onMove(entry)}
								onOpen={() => input.onOpen(entry)}
								onRename={() => input.onRename(entry)}
								onTrash={() => input.onTrash(entry)}
							/>
						)}
					</FluidContextMenu>
				))}
			</ul>
		</div>
	);
}

function resolveFilesSubtitle(input: { view: "active" | "trash" }): string {
	if (input.view === "trash") {
		return "Restore files you still need.";
	}
	return "Files shared in this Space, including chat attachments.";
}

function SpaceFilesLoadError(input: { error: unknown; onRetry: () => void }) {
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
			<div className="mt-4 flex flex-wrap justify-center gap-2">
				<Button
					onClick={input.onRetry}
					size="sm"
					type="button"
					variant="outline"
				>
					<ArrowClockwiseIcon aria-hidden="true" />
					Try again
				</Button>
			</div>
		</div>
	);
}

function resolveEmptyStateDescription(input: {
	canWrite: boolean;
	view: "active" | "trash";
}): string {
	if (input.view === "trash") {
		return "Items moved to Trash will appear here.";
	}
	return input.canWrite
		? "Create a Markdown file, upload a file, or add a folder to start working together."
		: "There aren’t any shared files here yet.";
}

function EntryRowAction(input: {
	onOpen: () => void;
	onCopy?: (entry: SpaceFileDescriptor, destination: "team" | "my") => void;
	canWrite: boolean;
	entry: SpaceFileEntry;
	onMove: () => void;
	onRename: () => void;
	onRestore: () => void;
	onTrash: () => void;
	view: "active" | "trash";
}) {
	if (input.view === "trash") {
		return (
			<Button
				aria-label={`Restore ${input.entry.name}`}
				onClick={input.onRestore}
				size="icon-sm"
				type="button"
				variant="ghost"
			>
				<ArrowCounterClockwiseIcon aria-hidden="true" />
			</Button>
		);
	}
	if (!input.canWrite) {
		return <span />;
	}
	return (
		<EntryActions
			entry={input.entry}
			onCopy={input.onCopy}
			onMove={input.onMove}
			onOpen={input.onOpen}
			onRename={input.onRename}
			onTrash={input.onTrash}
		/>
	);
}

function isFileDrag(event: DragEvent<HTMLElement>): boolean {
	return Array.from(event.dataTransfer.types).includes("Files");
}

function SpaceFileContextActions(input: {
	canWrite: boolean;
	entry: SpaceFileEntry;
	onCopy?: (entry: SpaceFileDescriptor, destination: "team" | "my") => void;
	onMove: () => void;
	onOpen: () => void;
	onRename: () => void;
	onTrash: () => void;
}) {
	const pin = useSpaceFilePinAction(
		input.entry.kind === "file" ? input.entry.id : undefined
	);
	const file = input.entry.kind === "file" ? input.entry : null;
	return (
		<>
			<FluidDropdownMenuGroup>
				<ContextMenuItem index={5} onClick={input.onOpen}>
					Open
				</ContextMenuItem>
			</FluidDropdownMenuGroup>
			{file && input.onCopy ? (
				<>
					<ContextMenuSeparator />
					<FluidDropdownMenuGroup>
						<ContextMenuItem
							index={6}
							onClick={() => input.onCopy?.(file, "team")}
						>
							<CopyIcon aria-hidden="true" />
							Copy to Team files…
						</ContextMenuItem>
						<ContextMenuItem
							index={7}
							onClick={() => input.onCopy?.(file, "my")}
						>
							<CopyIcon aria-hidden="true" />
							Copy to My files…
						</ContextMenuItem>
					</FluidDropdownMenuGroup>
				</>
			) : null}
			{input.canWrite ? (
				<>
					<FluidDropdownMenuGroup>
						{pin ? (
							<ContextMenuItem
								disabled={pin.disabled}
								index={8}
								onClick={pin.onSelect}
							>
								<PushPinIcon aria-hidden="true" />
								{pin.label}
							</ContextMenuItem>
						) : null}
					</FluidDropdownMenuGroup>
					<ContextMenuSeparator />
					<FluidDropdownMenuGroup>
						<ContextMenuItem index={9} onClick={input.onRename}>
							<PencilSimpleIcon aria-hidden="true" />
							Rename
						</ContextMenuItem>
						<ContextMenuItem index={10} onClick={input.onMove}>
							<FolderOpenIcon aria-hidden="true" />
							Move to folder…
						</ContextMenuItem>
					</FluidDropdownMenuGroup>
					<ContextMenuSeparator />
					<FluidDropdownMenuGroup>
						<ContextMenuItem
							index={11}
							onClick={input.onTrash}
							variant="destructive"
						>
							<TrashIcon aria-hidden="true" />
							Move to Trash
						</ContextMenuItem>
					</FluidDropdownMenuGroup>
				</>
			) : null}
		</>
	);
}

function EntryActions(input: {
	onOpen: () => void;
	onCopy?: (entry: SpaceFileDescriptor, destination: "team" | "my") => void;
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
			<FluidDropdownMenuContent
				align="end"
				className="[&_[data-slot=dropdown-menu-item]]:w-full"
			>
				<SpaceFileContextActions {...input} canWrite />
			</FluidDropdownMenuContent>
		</DropdownMenu>
	);
}

function SpaceFileEntryVisual(input: {
	api: Pick<SpaceApi, "downloadFileContent">;
	entry: SpaceFileEntry;
	previewImages: boolean;
	spaceId: string;
}) {
	if (
		input.previewImages &&
		input.entry.kind === "file" &&
		input.entry.latestRevision.mimeType.startsWith("image/")
	) {
		return (
			<span className="inline-flex h-11 w-16 shrink-0 overflow-hidden rounded-md">
				<SpaceFileImageThumbnail
					api={input.api}
					entry={input.entry}
					spaceId={input.spaceId}
				/>
			</span>
		);
	}
	return (
		<span className="grid size-10 shrink-0 place-items-center rounded-md border border-border/70 bg-background text-muted-foreground">
			{renderSpaceFileEntryIcon(input.entry)}
		</span>
	);
}

function SpaceFileImageThumbnail(input: {
	api: Pick<SpaceApi, "downloadFileContent">;
	entry: Extract<SpaceFileEntry, { kind: "file" }>;
	spaceId: string;
}) {
	const root = useRef<HTMLSpanElement>(null);
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		const element = root.current;
		if (!element) {
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setVisible(true);
					observer.disconnect();
				}
			},
			{ rootMargin: "100px" }
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const imageSource = useSpaceFileImageSource({
		api: input.api,
		enabled: visible,
		fileId: input.entry.id,
		mimeType: input.entry.latestRevision.mimeType,
		revision: input.entry.latestRevision.revision,
		spaceId: input.spaceId,
	});

	return (
		<span
			className="relative inline-flex size-full min-h-0 overflow-hidden bg-muted"
			ref={root}
		>
			{imageSource.sourceUrl ? (
				// biome-ignore lint/correctness/useImageSize: the preview viewport owns dimensions; the absolute image cannot shift layout.
				<img
					alt=""
					className="absolute inset-0 size-full object-contain"
					data-slot="space-file-image-thumbnail"
					decoding="async"
					loading="lazy"
					src={imageSource.sourceUrl}
				/>
			) : (
				<output
					aria-label={
						imageSource.error
							? `Preview unavailable for ${input.entry.name}`
							: `Loading preview for ${input.entry.name}`
					}
					className={cn(
						"absolute inset-0 grid size-full place-items-center bg-muted text-muted-foreground",
						visible &&
							imageSource.isLoading &&
							"animate-pulse motion-reduce:animate-none"
					)}
				>
					{imageSource.error ? (
						<ImageIcon aria-hidden="true" className="size-4.5" />
					) : null}
				</output>
			)}
		</span>
	);
}

function renderSpaceFileEntryIcon(entry: SpaceFileEntry) {
	if (entry.kind === "folder") {
		return (
			<FolderIcon aria-hidden="true" className="size-4.5" weight="duotone" />
		);
	}
	if (entry.latestRevision.mimeType === "text/html") {
		return <SpaceFileHtmlBadge />;
	}
	if (isSpaceFileTextEditable(entry.latestRevision)) {
		return (
			<FileTextIcon aria-hidden="true" className="size-4.5" weight="duotone" />
		);
	}
	return <FileIcon aria-hidden="true" className="size-4.5" weight="duotone" />;
}
