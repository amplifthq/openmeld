"use client";

import { isSpaceFileTextEditable } from "@openmeld/schemas";
import type {
	SpaceFileBreadcrumb,
	SpaceFileEntry,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowClockwiseIcon,
	CaretRightIcon,
	DotsThreeIcon,
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
import type { RefObject } from "react";
import {
	formatFileSize,
	formatShortDate,
	resolveSpaceFileErrorMessage,
} from "./space-file-utils";

export function SpaceFileBrowser(input: {
	actionError: string | null;
	breadcrumbs: readonly SpaceFileBreadcrumb[];
	busy: boolean;
	canWrite: boolean;
	entries: readonly SpaceFileEntry[];
	error: unknown;
	fileInputRef: RefObject<HTMLInputElement | null>;
	isPending: boolean;
	loaded: boolean;
	onDismissError: () => void;
	onMove: (entry: SpaceFileEntry) => void;
	onNewFolder: () => void;
	onNewMarkdownFile: () => void;
	onOpen: (entry: SpaceFileEntry) => void;
	onOpenBreadcrumb: (folderId: string | null) => void;
	onRename: (entry: SpaceFileEntry) => void;
	onRetry: () => void;
	onTrash: (entry: SpaceFileEntry) => void;
	onUploadFiles: (files: readonly File[]) => Promise<void>;
}) {
	return (
		<section
			aria-label="Space files"
			className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
		>
			<div className="flex flex-wrap items-center justify-between gap-3 border-border border-b px-5 py-3.5">
				<div className="min-w-0">
					<div className="flex min-w-0 items-center gap-1 text-sm">
						{input.breadcrumbs.map((crumb, index) => (
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
										index === input.breadcrumbs.length - 1 &&
											"font-medium text-foreground"
									)}
									onClick={() => input.onOpenBreadcrumb(crumb.id)}
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
					{input.loaded && !input.canWrite ? (
						<Badge variant="outline">View only</Badge>
					) : null}
					{input.canWrite ? (
						<>
							<input
								aria-label="Upload files"
								className="sr-only"
								multiple={true}
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
								<DropdownMenuContent align="end">
									<DropdownMenuItem onClick={input.onNewMarkdownFile}>
										<FileTextIcon aria-hidden="true" />
										Markdown file
									</DropdownMenuItem>
									<DropdownMenuItem onClick={input.onNewFolder}>
										<FolderPlusIcon aria-hidden="true" />
										Folder
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</>
					) : null}
				</div>
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
			<div className="min-h-0 flex-1 overflow-y-auto p-5">
				<SpaceFileBrowserContent
					canWrite={input.canWrite}
					entries={input.entries}
					error={input.error}
					isPending={input.isPending}
					onMove={input.onMove}
					onOpen={input.onOpen}
					onRename={input.onRename}
					onRetry={input.onRetry}
					onTrash={input.onTrash}
				/>
			</div>
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
						? "Create a Markdown file, upload a file, or add a folder to start working together."
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
