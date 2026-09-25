"use client";

import { createFileRootApi, type FileRootLocation } from "@openmeld/api-client";
import type { FileRootEntry } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@openmeld/ui/components/context-menu";
import {
	ArrowCounterClockwiseIcon,
	CaretRightIcon,
	FolderOpenIcon,
	FolderPlusIcon,
	PencilSimpleIcon,
	TrashIcon,
	UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { FileSystemItem } from "#/components/extend/file-system";
import {
	FolderNameDialog,
	MoveEntryDialog,
	RenameEntryDialog,
} from "#/components/spaces/space-file-dialogs";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { useAppOrganization } from "#/lib/organizations/organization-context";

const FileSystem = lazy(() =>
	import("#/components/extend/file-system").then((module) => ({
		default: module.FileSystem,
	}))
);

export function TeamFilesPage() {
	const { currentOrganization } = useAppOrganization();
	return (
		<TeamFilesBrowser
			currentOrganization={currentOrganization}
			key={currentOrganization.id}
		/>
	);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This page coordinates the shared browser with root navigation and file actions.
function TeamFilesBrowser(input: {
	currentOrganization: ReturnType<
		typeof useAppOrganization
	>["currentOrganization"];
}) {
	const { currentOrganization } = input;
	const [location, setLocation] = useState<FileRootLocation>("team");
	const [parentId, setParentId] = useState<string | null>(null);
	const [view, setView] = useState<"active" | "trash">("active");
	const [folderDialogOpen, setFolderDialogOpen] = useState(false);
	const [renamingEntry, setRenamingEntry] = useState<FileRootEntry | null>(
		null
	);
	const [movingEntry, setMovingEntry] = useState<FileRootEntry | null>(null);
	const [busy, setBusy] = useState(false);
	const [uploadProgress, setUploadProgress] = useState<{
		name: string;
		percent: number;
	} | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
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
	const entriesByPath = new Map(
		items.map((item, index) => [item.path, entries[index]])
	);
	const refresh = async () => {
		await queryClient.invalidateQueries({
			queryKey: ["file-root", currentOrganization.id],
		});
	};
	const runAction = async (
		action: () => Promise<unknown>
	): Promise<boolean> => {
		setBusy(true);
		setActionError(null);
		setSelectedId(null);
		try {
			await action();
			await refresh();
			return true;
		} catch (error) {
			setActionError(
				error instanceof Error
					? error.message
					: "Files couldn't save that change."
			);
			return false;
		} finally {
			setBusy(false);
		}
	};
	const changeLocation = (next: FileRootLocation) => {
		setLocation(next);
		setParentId(null);
		setView("active");
		setActionError(null);
	};
	const toolbarStart = (
		<div className="flex min-w-0 flex-wrap items-center gap-1.5">
			{parentId && view === "active" ? (
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
							<Button
								onClick={() => setParentId(crumb.id)}
								size="sm"
								type="button"
								variant="ghost"
							>
								{crumb.name}
							</Button>
						</span>
					))}
				</div>
			) : null}
			{currentOrganization.isPersonal ? null : (
				<>
					<Button
						onClick={() => changeLocation("team")}
						size="sm"
						type="button"
						variant={location === "team" ? "secondary" : "ghost"}
					>
						Team files
					</Button>
					<Button
						onClick={() => changeLocation("my")}
						size="sm"
						type="button"
						variant={location === "my" ? "secondary" : "ghost"}
					>
						My files
					</Button>
				</>
			)}
			{view === "active" ? (
				<>
					<input
						className="hidden"
						multiple
						onChange={(event) => {
							const selected = Array.from(event.currentTarget.files ?? []);
							event.currentTarget.value = "";
							runAction(async () => {
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
							})
								.finally(() => setUploadProgress(null))
								.catch(console.error);
						}}
						ref={inputRef}
						type="file"
					/>
					<Button
						disabled={busy}
						onClick={() => inputRef.current?.click()}
						size="sm"
						type="button"
						variant="outline"
					>
						<UploadSimpleIcon aria-hidden="true" /> Upload
					</Button>
					<Button
						disabled={busy}
						onClick={() => setFolderDialogOpen(true)}
						size="sm"
						type="button"
						variant="outline"
					>
						<FolderPlusIcon aria-hidden="true" /> New folder
					</Button>
					<Button
						onClick={() => {
							setParentId(null);
							setView("trash");
						}}
						size="sm"
						type="button"
						variant="outline"
					>
						<TrashIcon aria-hidden="true" /> Trash
					</Button>
				</>
			) : (
				<Button
					onClick={() => setView("active")}
					size="sm"
					type="button"
					variant="outline"
				>
					<ArrowCounterClockwiseIcon aria-hidden="true" /> Back to files
				</Button>
			)}
		</div>
	);
	return (
		<section
			aria-label="Team files"
			className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
		>
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
			<div className="min-h-0 flex-1 p-5">
				<ContextMenu
					key={`${currentOrganization.id}:${location}:${parentId ?? "root"}:${view}`}
				>
					<ContextMenuTrigger
						className="block h-full"
						onContextMenuCapture={() => setSelectedId(null)}
					>
						<Suspense
							fallback={
								<p className="text-muted-foreground text-sm">Loading Files…</p>
							}
						>
							<FileSystem
								className="h-full min-h-96"
								embedded
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
								key={`${currentOrganization.id}:${location}:${parentId ?? "root"}:${view}`}
								onFolderOpen={(folder) => {
									const entry = entriesByPath.get(folder.path);
									if (entry?.kind === "folder") {
										setParentId(entry.id);
									}
								}}
								onSelectionChange={(item) =>
									setSelectedId(
										item ? (entriesByPath.get(item.path)?.id ?? null) : null
									)
								}
								title={
									files.data?.breadcrumbs.at(-1)?.name ??
									(location === "my" ? "My files" : "Team files")
								}
								toolbarStart={toolbarStart}
							/>
						</Suspense>
					</ContextMenuTrigger>
					{selectedEntry || view === "active" ? (
						<ContextMenuContent className="min-w-40 p-1">
							{selectedEntry ? (
								<>
									{view === "active" ? (
										<ContextMenuItem
											onClick={() => setMovingEntry(selectedEntry)}
										>
											<FolderOpenIcon aria-hidden="true" />
											Move to folder…
										</ContextMenuItem>
									) : null}
									{view === "active" ? (
										<ContextMenuItem
											onClick={() => setRenamingEntry(selectedEntry)}
										>
											<PencilSimpleIcon aria-hidden="true" />
											Rename
										</ContextMenuItem>
									) : null}
									<ContextMenuItem
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
							) : (
								<>
									<ContextMenuItem onClick={() => setFolderDialogOpen(true)}>
										<FolderPlusIcon aria-hidden="true" />
										New folder
									</ContextMenuItem>
									<ContextMenuItem onClick={() => inputRef.current?.click()}>
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
				onOpenChange={setFolderDialogOpen}
				onSubmit={async (name) => {
					const created = await runAction(() =>
						api.createFolder({
							location,
							name,
							parentId,
							clientMutationId: crypto.randomUUID(),
						})
					);
					if (created) {
						setFolderDialogOpen(false);
					}
				}}
				open={folderDialogOpen}
				pending={busy}
			/>
			<RenameEntryDialog
				entry={renamingEntry}
				onOpenChange={(open) => {
					if (!open) {
						setRenamingEntry(null);
					}
				}}
				onSubmit={async (entry, name) => {
					const updated = await runAction(() =>
						api.updateEntry({
							location,
							entryId: entry.id,
							name,
							clientMutationId: crypto.randomUUID(),
						})
					);
					if (updated) {
						setRenamingEntry(null);
					}
				}}
				pending={busy}
			/>
			<MoveEntryDialog
				entry={movingEntry}
				loadDestinations={(excludedFolderId) =>
					loadFileRootMoveDestinations({ api, excludedFolderId, location })
				}
				onOpenChange={(open) => {
					if (!open) {
						setMovingEntry(null);
					}
				}}
				onSubmit={async (entry, destinationId) => {
					const updated = await runAction(() =>
						api.updateEntry({
							location,
							entryId: entry.id,
							parentId: destinationId,
							clientMutationId: crypto.randomUUID(),
						})
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
		</section>
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
