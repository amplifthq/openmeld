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
	ArrowCounterClockwiseIcon,
	ArrowLeftIcon,
	ClockCounterClockwiseIcon,
	CopyIcon,
	DotsThreeIcon,
	DownloadSimpleIcon,
	FileIcon,
	FolderOpenIcon,
	PencilSimpleIcon,
	TrashIcon,
	WarningCircleIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import {
	type CSSProperties,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { MarkdownEditor } from "#/components/editor/markdown-editor";
import { UnsavedChangesDialog } from "#/components/forms/unsaved-changes-guard";
import { baseQueryOptions } from "#/query/query-config";
import { spaceFileQueryKeys } from "#/query/spaces/space-files";
import {
	downloadContent,
	formatFileDateTime,
	formatFileSize,
	resolveSpaceFileErrorMessage,
	utf8ByteLength,
} from "./space-file-utils";

export type SpaceFileLeaveGuard = {
	discard: () => void;
	hasUnsavedChanges: boolean;
	save: () => Promise<boolean>;
};

export function SpaceFileDetail(input: {
	api: SpaceApi;
	canWrite: boolean;
	file: SpaceFileDescriptor;
	initialRevision?: number;
	onLeaveGuardChange?: (guard: SpaceFileLeaveGuard | null) => void;
	onBack: () => void;
	onFileChanged: (file: SpaceFileDescriptor) => void;
	onMove: () => void;
	onRename: () => void;
	onTrash: () => void;
	spaceId: string;
}) {
	const initialHistoricalRevision =
		input.initialRevision !== undefined &&
		input.initialRevision !== input.file.latestRevision.revision
			? input.initialRevision
			: null;
	const [draft, setDraft] = useState("");
	const [savedDraft, setSavedDraft] = useState("");
	const [loadedRevision, setLoadedRevision] = useState<number | null>(null);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [conflict, setConflict] = useState(false);
	const [backConfirmationOpen, setBackConfirmationOpen] = useState(false);
	const [historyOpen, setHistoryOpen] = useState(false);
	const [previewRevision, setPreviewRevision] = useState<number | null>(
		initialHistoricalRevision
	);
	const [restoringRevision, setRestoringRevision] = useState(false);
	const [downloadingRevision, setDownloadingRevision] = useState<number | null>(
		null
	);
	const revisionsQuery = useQuery({
		enabled: historyOpen || previewRevision !== null,
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
	const displayedRevision =
		previewRevision ?? input.file.latestRevision.revision;
	const displayedRevisionDescriptor =
		revisionsQuery.data?.revisions.find(
			(revision) => revision.revision === displayedRevision
		) ??
		(displayedRevision === input.file.latestRevision.revision
			? input.file.latestRevision
			: null);
	const displayedMimeType =
		displayedRevisionDescriptor?.mimeType ?? input.file.latestRevision.mimeType;
	const displayedSizeBytes =
		displayedRevisionDescriptor?.sizeBytes ??
		input.file.latestRevision.sizeBytes;
	const editable = isSpaceFileTextEditable({
		mimeType: displayedMimeType,
		sizeBytes: displayedSizeBytes,
	});
	const markdown =
		displayedMimeType === "text/markdown" ||
		displayedMimeType === "text/x-markdown";
	const imagePreviewable = displayedMimeType.startsWith("image/");
	const contentQuery = useQuery({
		enabled: editable || imagePreviewable || previewRevision !== null,
		queryKey: spaceFileQueryKeys.content(
			input.spaceId,
			input.file.id,
			displayedRevision
		),
		queryFn: async ({ signal }) =>
			await input.api.downloadFileContent({
				spaceId: input.spaceId,
				fileId: input.file.id,
				revision: displayedRevision,
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
		const targetRevision = revision ?? displayedRevision;
		setDownloadingRevision(targetRevision);
		setSaveError(null);
		try {
			const content =
				contentQuery.data?.revision === targetRevision
					? contentQuery.data
					: await input.api.downloadFileContent({
							spaceId: input.spaceId,
							fileId: input.file.id,
							revision: targetRevision,
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
			setPreviewRevision(null);
			input.onFileChanged(file);
		} catch (error) {
			setSaveError(resolveSpaceFileErrorMessage(error));
		}
	};
	const draftSizeBytes = utf8ByteLength(draft);
	const draftOverLimit = draftSizeBytes > SPACE_FILE_MAX_TEXT_EDIT_SIZE_BYTES;
	const hasUnsavedChanges = draft !== savedDraft;
	const save = useCallback(async (): Promise<boolean> => {
		if (
			!input.canWrite ||
			previewRevision !== null ||
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
	}, [
		conflict,
		draft,
		draftOverLimit,
		hasUnsavedChanges,
		input.api,
		input.canWrite,
		input.file.id,
		input.file.latestRevision.mimeType,
		input.file.latestRevision.revision,
		input.onFileChanged,
		input.spaceId,
		previewRevision,
		saving,
	]);
	const restorePreviewedRevision = async (): Promise<boolean> => {
		if (!input.canWrite || previewRevision === null || restoringRevision) {
			return false;
		}
		setRestoringRevision(true);
		setSaveError(null);
		try {
			const restoredFile = await input.api.restoreFileRevision({
				baseRevision: input.file.latestRevision.revision,
				clientMutationId: crypto.randomUUID(),
				fileId: input.file.id,
				revision: previewRevision,
				spaceId: input.spaceId,
			});
			setPreviewRevision(null);
			setLoadedRevision(null);
			setHistoryOpen(false);
			input.onFileChanged(restoredFile);
			await revisionsQuery.refetch();
			toast.success(
				`Version ${previewRevision} restored as the latest version`
			);
			return true;
		} catch (error) {
			setSaveError(resolveSpaceFileErrorMessage(error));
			return false;
		} finally {
			setRestoringRevision(false);
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
	const saveRef = useRef(save);
	const savedDraftRef = useRef(savedDraft);
	useEffect(() => {
		saveRef.current = save;
		savedDraftRef.current = savedDraft;
	}, [save, savedDraft]);
	const leaveGuard = useMemo<SpaceFileLeaveGuard>(
		() => ({
			discard: () => setDraft(savedDraftRef.current),
			hasUnsavedChanges,
			save: async () => await saveRef.current(),
		}),
		[hasUnsavedChanges]
	);
	useEffect(() => {
		input.onLeaveGuardChange?.(leaveGuard);
		return () => input.onLeaveGuardChange?.(null);
	}, [input.onLeaveGuardChange, leaveGuard]);
	const fileContent = (
		<SpaceFileContent
			canWrite={input.canWrite && previewRevision === null}
			contentLimitExceeded={draftOverLimit}
			draft={draft}
			editable={editable}
			editorKey={`${input.file.id}:${loadedRevision ?? "loading"}`}
			fileName={input.file.name}
			hasUnsavedChanges={hasUnsavedChanges}
			imagePreviewable={imagePreviewable}
			imagePreviewUrl={imagePreviewUrl}
			isError={contentQuery.isError}
			isLoading={contentQuery.isPending}
			markdown={markdown}
			onChange={setDraft}
			onDownload={() => downloadRevision()}
			onRetry={() => contentQuery.refetch()}
			onSave={save}
			saveBlockedByConflict={conflict}
			saving={saving}
		/>
	);

	return (
		<section
			aria-label={`File ${input.file.name}`}
			className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
		>
			<SpaceFileDetailHeader
				canWrite={input.canWrite}
				displayedSizeBytes={displayedSizeBytes}
				downloading={downloadingRevision !== null}
				file={input.file}
				onBack={returnToFiles}
				onDownload={() => downloadRevision()}
				onHistory={() => setHistoryOpen(true)}
				onMove={input.onMove}
				onRename={input.onRename}
				onTrash={input.onTrash}
				previewRevision={previewRevision}
			/>
			<SpaceFileDetailNotices
				canWrite={input.canWrite}
				conflict={conflict}
				onBackToCurrent={() => {
					setPreviewRevision(null);
					setLoadedRevision(null);
				}}
				onCopyDraft={() => copyDraft()}
				onReloadLatest={() => reloadLatest()}
				onRestore={() => restorePreviewedRevision()}
				previewRevision={previewRevision}
				restoringRevision={restoringRevision}
				saveError={saveError}
			/>

			<div className="flex min-h-0 flex-1 flex-col overflow-hidden p-5">
				{fileContent}
			</div>
			<SpaceFileHistoryDrawer
				currentRevision={input.file.latestRevision.revision}
				downloadingRevision={downloadingRevision}
				isError={revisionsQuery.isError}
				isPending={revisionsQuery.isPending}
				onDownload={downloadRevision}
				onOpenChange={setHistoryOpen}
				onPreview={(revision) => {
					setPreviewRevision(revision);
					setLoadedRevision(null);
					setHistoryOpen(false);
				}}
				open={historyOpen}
				revisions={revisionsQuery.data?.revisions ?? []}
			/>
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

function SpaceFileDetailHeader(input: {
	canWrite: boolean;
	displayedSizeBytes: number;
	downloading: boolean;
	file: SpaceFileDescriptor;
	onBack: () => void;
	onDownload: () => void;
	onHistory: () => void;
	onMove: () => void;
	onRename: () => void;
	onTrash: () => void;
	previewRevision: number | null;
}) {
	const detail = input.previewRevision
		? `Version ${input.previewRevision} · ${formatFileSize(input.displayedSizeBytes)}`
		: `Saved ${formatFileDateTime(input.file.updatedAt)} by ${input.file.updatedBy.displayName}`;
	return (
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
					<p className="truncate text-muted-foreground text-xs">{detail}</p>
				</div>
			</div>
			<div className="flex items-center gap-2">
				<Button
					onClick={input.onHistory}
					size="sm"
					type="button"
					variant="ghost"
				>
					<ClockCounterClockwiseIcon aria-hidden="true" />
					History
				</Button>
				<Button
					disabled={input.downloading}
					onClick={input.onDownload}
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
	);
}

function SpaceFileDetailNotices(input: {
	canWrite: boolean;
	conflict: boolean;
	onBackToCurrent: () => void;
	onCopyDraft: () => void;
	onReloadLatest: () => void;
	onRestore: () => Promise<boolean>;
	previewRevision: number | null;
	restoringRevision: boolean;
	saveError: string | null;
}) {
	return (
		<>
			{input.conflict ? (
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
							onClick={input.onCopyDraft}
							size="sm"
							type="button"
							variant="outline"
						>
							<CopyIcon aria-hidden="true" />
							Copy your draft
						</Button>
						<Button
							onClick={input.onReloadLatest}
							size="sm"
							type="button"
							variant="outline"
						>
							Reload latest
						</Button>
					</div>
				</div>
			) : null}
			{input.saveError ? (
				<div
					className="border-destructive/30 border-b bg-destructive/5 px-5 py-3 text-destructive text-sm"
					role="alert"
				>
					{input.saveError}
				</div>
			) : null}
			{input.previewRevision !== null ? (
				<div className="flex flex-wrap items-center justify-between gap-3 border-primary/25 border-b bg-primary/5 px-5 py-3 text-sm">
					<div>
						<p className="font-medium">
							Viewing version {input.previewRevision}
						</p>
						<p className="text-muted-foreground text-xs">
							This is a read-only snapshot. The current version hasn’t changed.
						</p>
					</div>
					<div className="flex items-center gap-2">
						<Button
							onClick={input.onBackToCurrent}
							size="sm"
							type="button"
							variant="outline"
						>
							Back to current
						</Button>
						{input.canWrite ? (
							<Button
								disabled={input.restoringRevision}
								onClick={() => {
									input.onRestore().catch(() => undefined);
								}}
								size="sm"
								type="button"
							>
								<ArrowCounterClockwiseIcon aria-hidden="true" />
								{input.restoringRevision
									? "Restoring…"
									: "Restore this version"}
							</Button>
						) : null}
					</div>
				</div>
			) : null}
		</>
	);
}

function SpaceFileContent(input: {
	canWrite: boolean;
	contentLimitExceeded: boolean;
	draft: string;
	editable: boolean;
	editorKey: string;
	fileName: string;
	hasUnsavedChanges: boolean;
	imagePreviewable: boolean;
	imagePreviewUrl: string | null;
	isError: boolean;
	isLoading: boolean;
	markdown: boolean;
	onChange: (value: string) => void;
	onDownload: () => void;
	onRetry: () => void;
	onSave: () => Promise<boolean>;
	saveBlockedByConflict: boolean;
	saving: boolean;
}): ReactNode {
	if (input.editable) {
		return (
			<FileTextEditor
				canWrite={input.canWrite}
				contentLimitExceeded={input.contentLimitExceeded}
				draft={input.draft}
				editorKey={input.editorKey}
				hasUnsavedChanges={input.hasUnsavedChanges}
				isError={input.isError}
				isLoading={input.isLoading}
				markdown={input.markdown}
				onChange={input.onChange}
				onRetry={input.onRetry}
				onSave={input.onSave}
				saveBlockedByConflict={input.saveBlockedByConflict}
				saving={input.saving}
			/>
		);
	}
	if (input.imagePreviewable) {
		return (
			<SpaceFileImagePreview
				fileName={input.fileName}
				isError={input.isError}
				isLoading={input.isLoading}
				onRetry={input.onRetry}
				previewUrl={input.imagePreviewUrl}
			/>
		);
	}
	return (
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
				onClick={input.onDownload}
				size="sm"
				type="button"
			>
				<DownloadSimpleIcon aria-hidden="true" />
				Download file
			</Button>
		</div>
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

function SpaceFileHistoryDrawer(input: {
	currentRevision: number;
	downloadingRevision: number | null;
	isError: boolean;
	isPending: boolean;
	onDownload: (revision?: number) => Promise<void>;
	onOpenChange: (open: boolean) => void;
	onPreview: (revision: number) => void;
	open: boolean;
	revisions: readonly SpaceFileRevision[];
}) {
	return (
		<Drawer.Root
			autoFocus
			direction="right"
			onOpenChange={input.onOpenChange}
			open={input.open}
		>
			<Drawer.Portal>
				<Drawer.Overlay className="fixed inset-0 z-40 bg-background/55 backdrop-blur-[2px] motion-reduce:transition-none" />
				<Drawer.Content
					className="fixed top-0 right-0 bottom-0 z-50 flex border-border border-l bg-background shadow-2xl outline-none motion-reduce:transition-none"
					data-testid="space-file-history-drawer"
					style={
						{
							"--initial-transform": "calc(100% + 1px)",
							width: "min(27rem, 100vw)",
						} as CSSProperties
					}
				>
					<div className="flex min-h-0 w-full flex-col">
						<header className="flex shrink-0 items-center justify-between gap-4 border-border border-b px-5 py-4">
							<div className="min-w-0">
								<Drawer.Title className="font-medium text-base">
									Version history
								</Drawer.Title>
								<Drawer.Description className="mt-1 text-muted-foreground text-xs">
									Preview an older version or download its exact contents.
								</Drawer.Description>
							</div>
							<Drawer.Close asChild>
								<Button
									aria-label="Close version history"
									size="icon-sm"
									type="button"
									variant="ghost"
								>
									<XIcon aria-hidden="true" />
								</Button>
							</Drawer.Close>
						</header>
						<div
							className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
							data-vaul-no-drag
						>
							{renderVersionHistory(input)}
						</div>
					</div>
				</Drawer.Content>
			</Drawer.Portal>
		</Drawer.Root>
	);
}

function renderVersionHistory(input: {
	currentRevision: number;
	downloadingRevision: number | null;
	isError: boolean;
	isPending: boolean;
	onDownload: (revision?: number) => Promise<void>;
	onPreview: (revision: number) => void;
	revisions: readonly SpaceFileRevision[];
}) {
	if (input.isPending) {
		return (
			<div className="space-y-2">
				<Skeleton className="h-16 w-full rounded-md" />
				<Skeleton className="h-16 w-full rounded-md" />
			</div>
		);
	}
	if (input.isError) {
		return (
			<p className="text-destructive text-sm" role="alert">
				Version history couldn’t be loaded.
			</p>
		);
	}
	return (
		<ul className="space-y-2">
			{input.revisions.map((revision) => (
				<li
					className="rounded-lg border border-border/70 p-2"
					key={revision.id}
				>
					<div className="flex items-center gap-2">
						{revision.revision === input.currentRevision ? (
							<div className="min-w-0 flex-1 rounded-md px-2 py-1.5">
								<div className="flex items-center gap-2">
									<span className="font-medium text-sm">
										Version {revision.revision}
									</span>
									<span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-[11px] text-primary">
										Current
									</span>
								</div>
								<p className="mt-1 truncate text-muted-foreground text-xs">
									{revision.createdBy.displayName} ·{" "}
									{formatFileDateTime(revision.createdAt)}
								</p>
							</div>
						) : (
							<button
								aria-label={`Preview version ${revision.revision}`}
								className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								onClick={() => input.onPreview(revision.revision)}
								type="button"
							>
								<span className="font-medium text-sm">
									Version {revision.revision}
								</span>
								<span className="mt-1 block truncate text-muted-foreground text-xs">
									{revision.createdBy.displayName} ·{" "}
									{formatFileDateTime(revision.createdAt)}
								</span>
							</button>
						)}
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
