"use client";

import type { SpaceApi } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import {
	isSpaceFileTextEditable,
	SPACE_FILE_MAX_TEXT_EDIT_SIZE_BYTES,
} from "@openmeld/schemas";
import type {
	SpaceFileDescriptor,
	SpaceFileRevision,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { Textarea } from "@openmeld/ui/components/textarea";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowClockwiseIcon,
	ArrowLeftIcon,
	CopyIcon,
	DotsThreeIcon,
	DownloadSimpleIcon,
	FileIcon,
	FolderOpenIcon,
	PencilSimpleIcon,
	TrashIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { MarkdownEditor } from "#/components/editor/markdown-editor";
import { UnsavedChangesDialog } from "#/components/forms/unsaved-changes-guard";
import { baseQueryOptions } from "#/query/query-config";
import { spaceFileQueryKeys } from "#/query/spaces/space-files";
import {
	downloadContent,
	formatFileSize,
	formatShortDate,
	resolveSpaceFileErrorMessage,
	utf8ByteLength,
} from "./space-file-utils";

function isMarkdownSpaceFile(file: SpaceFileDescriptor): boolean {
	return (
		file.latestRevision.mimeType === "text/markdown" ||
		file.latestRevision.mimeType === "text/x-markdown"
	);
}

export function SpaceFileDetail(input: {
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
	const markdown = isMarkdownSpaceFile(input.file);
	const imagePreviewable =
		input.file.latestRevision.mimeType.startsWith("image/");
	const [draft, setDraft] = useState("");
	const [savedDraft, setSavedDraft] = useState("");
	const [loadedRevision, setLoadedRevision] = useState<number | null>(null);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [conflict, setConflict] = useState(false);
	const [backConfirmationOpen, setBackConfirmationOpen] = useState(false);
	const [downloadingRevision, setDownloadingRevision] = useState<number | null>(
		null
	);
	const contentQuery = useQuery({
		enabled: editable || imagePreviewable,
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
	const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
	useEffect(() => {
		if (!(imagePreviewable && contentQuery.data)) {
			setImagePreviewUrl(null);
			return;
		}
		const objectUrl = URL.createObjectURL(
			new Blob([contentQuery.data.bytes], { type: contentQuery.data.mimeType })
		);
		setImagePreviewUrl(objectUrl);
		return () => URL.revokeObjectURL(objectUrl);
	}, [contentQuery.data, imagePreviewable]);
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
		if (
			!(editable && contentQuery.data) ||
			loadedRevision === contentQuery.data.revision
		) {
			return;
		}
		const content = new TextDecoder().decode(contentQuery.data.bytes);
		setDraft(content);
		setSavedDraft(content);
		setLoadedRevision(contentQuery.data.revision);
		setConflict(false);
		setSaveError(null);
	}, [contentQuery.data, editable, loadedRevision]);

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
	const draftSizeBytes = utf8ByteLength(draft);
	const draftOverLimit = draftSizeBytes > SPACE_FILE_MAX_TEXT_EDIT_SIZE_BYTES;
	const hasUnsavedChanges = draft !== savedDraft;
	const save = async (): Promise<boolean> => {
		if (
			!input.canWrite ||
			saving ||
			!hasUnsavedChanges ||
			draftOverLimit ||
			conflict
		) {
			return false;
		}
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
			setSavedDraft(draft);
			input.onFileChanged(file);
			toast.success("File saved");
			return true;
		} catch (error) {
			const failure = toStructuredApiClientFailure(error);
			if (failure.code === "space_file.conflict") {
				setConflict(true);
			} else {
				setSaveError(resolveSpaceFileErrorMessage(error));
			}
			return false;
		} finally {
			setSaving(false);
		}
	};
	const copyDraft = async () => {
		try {
			await navigator.clipboard.writeText(draft);
			toast.success("Draft copied");
		} catch {
			setSaveError(
				"OpenMeld couldn’t copy your draft. Select the text and copy it manually."
			);
		}
	};
	const returnToFiles = () => {
		if (hasUnsavedChanges) {
			setBackConfirmationOpen(true);
			return;
		}
		input.onBack();
	};
	let fileContent: ReactNode;
	if (editable) {
		fileContent = (
			<FileTextEditor
				canWrite={input.canWrite}
				contentLimitExceeded={draftOverLimit}
				draft={draft}
				editorKey={`${input.file.id}:${loadedRevision ?? "loading"}`}
				hasUnsavedChanges={hasUnsavedChanges}
				isError={contentQuery.isError}
				isLoading={contentQuery.isPending}
				markdown={markdown}
				onChange={setDraft}
				onRetry={() => contentQuery.refetch()}
				onSave={save}
				saveBlockedByConflict={conflict}
				saving={saving}
			/>
		);
	} else if (imagePreviewable) {
		fileContent = (
			<SpaceFileImagePreview
				fileName={input.file.name}
				isError={contentQuery.isError}
				isLoading={contentQuery.isPending}
				onRetry={() => contentQuery.refetch()}
				previewUrl={imagePreviewUrl}
			/>
		);
	} else {
		fileContent = (
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
		);
	}

	return (
		<section
			aria-label={`File ${input.file.name}`}
			className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
		>
			<header className="flex flex-wrap items-center justify-between gap-3 border-border border-b px-5 py-3">
				<div className="flex min-w-0 items-center gap-3">
					<Button
						aria-label="Back to files"
						onClick={returnToFiles}
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
							Your edits are still here. Copy your draft, then reload the latest
							version before editing again.
						</p>
					</div>
					<div className="flex items-center gap-2">
						<Button
							onClick={() => copyDraft()}
							size="sm"
							type="button"
							variant="outline"
						>
							<CopyIcon aria-hidden="true" />
							Copy your draft
						</Button>
						<Button
							onClick={() => reloadLatest()}
							size="sm"
							type="button"
							variant="outline"
						>
							Reload latest
						</Button>
					</div>
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
					{fileContent}
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
			<UnsavedChangesDialog
				description="Your changes to this file haven't been saved."
				onCancel={() => setBackConfirmationOpen(false)}
				onDiscard={() => {
					setBackConfirmationOpen(false);
					input.onBack();
				}}
				onSaveAndLeave={async () => {
					const saved = await save();
					if (saved) {
						setBackConfirmationOpen(false);
						input.onBack();
					}
					return saved;
				}}
				open={backConfirmationOpen}
				saving={saving}
			/>
		</section>
	);
}

function SpaceFileImagePreview(input: {
	fileName: string;
	isError: boolean;
	isLoading: boolean;
	onRetry: () => void;
	previewUrl: string | null;
}) {
	if (input.isLoading) {
		return (
			<Skeleton
				aria-label="Loading image"
				className="min-h-80 flex-1 rounded-md"
			/>
		);
	}
	if (input.isError || !input.previewUrl) {
		return (
			<div className="flex min-h-64 flex-1 flex-col items-center justify-center rounded-md border border-border/70 bg-muted/15 px-6 text-center">
				<WarningCircleIcon
					aria-hidden="true"
					className="size-10 text-muted-foreground"
					weight="duotone"
				/>
				<h3 className="mt-3 font-medium">Image preview couldn’t be loaded</h3>
				<p className="mt-1 text-muted-foreground text-sm">
					The file is still available in this Space.
				</p>
				<Button
					className="mt-4"
					onClick={input.onRetry}
					size="sm"
					type="button"
				>
					<ArrowClockwiseIcon aria-hidden="true" />
					Try again
				</Button>
			</div>
		);
	}
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-md border border-border/70 bg-muted/15 p-4">
			<img
				alt={input.fileName}
				className="max-h-full max-w-full object-contain"
				height={900}
				src={input.previewUrl}
				width={1600}
			/>
		</div>
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
	contentLimitExceeded: boolean;
	draft: string;
	editorKey: string;
	hasUnsavedChanges: boolean;
	isError: boolean;
	isLoading: boolean;
	markdown: boolean;
	onChange: (value: string) => void;
	onRetry: () => void;
	onSave: () => Promise<boolean>;
	saveBlockedByConflict: boolean;
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
			{input.markdown ? (
				<MarkdownEditor
					ariaLabel="File contents"
					disabled={!input.canWrite || input.saving}
					key={input.editorKey}
					maxBytes={SPACE_FILE_MAX_TEXT_EDIT_SIZE_BYTES}
					onChange={input.onChange}
					value={input.draft}
				/>
			) : (
				<>
					<Textarea
						aria-label="File contents"
						className="min-h-80 flex-1 resize-none font-mono text-sm leading-6"
						onChange={(event) => input.onChange(event.currentTarget.value)}
						readOnly={!input.canWrite}
						spellCheck={false}
						value={input.draft}
					/>
					<p
						className={cn(
							"text-muted-foreground text-xs",
							input.contentLimitExceeded && "text-destructive"
						)}
					>
						{formatFileSize(utf8ByteLength(input.draft))} / 1 MB
						{input.contentLimitExceeded ? " — too long to save" : ""}
					</p>
				</>
			)}
			{input.canWrite ? (
				<div className="flex justify-end border-t pt-4">
					<Button
						disabled={
							input.saving ||
							!input.hasUnsavedChanges ||
							input.contentLimitExceeded ||
							input.saveBlockedByConflict
						}
						onClick={() => {
							input.onSave().catch(() => undefined);
						}}
						type="button"
					>
						{input.saving ? "Saving…" : "Save changes"}
					</Button>
				</div>
			) : null}
		</div>
	);
}
