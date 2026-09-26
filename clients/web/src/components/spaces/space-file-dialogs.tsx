"use client";

import type { SpaceApi } from "@openmeld/api-client";
import { SPACE_FILE_MAX_TEXT_EDIT_SIZE_BYTES } from "@openmeld/schemas";
import type { SpaceFileEntry } from "@openmeld/schemas/types";
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
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { Textarea } from "@openmeld/ui/components/textarea";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { MarkdownEditor } from "#/components/editor/markdown-editor";
import { baseQueryOptions } from "#/query/query-config";
import {
	resolveSpaceFileErrorMessage,
	utf8ByteLength,
} from "./space-file-utils";

const ROOT_FOLDER_ID: null = null;
const NEW_TEXT_FILE_DETAILS = {
	markdown: { defaultName: "untitled.md", title: "New Markdown file" },
	text: { defaultName: "untitled.txt", title: "New text file" },
	csv: { defaultName: "untitled.csv", title: "New CSV file" },
} as const;

export type SpaceFileEntryDialogState =
	| { kind: "closed" }
	| { entry: SpaceFileEntry; kind: "move" }
	| { entry: SpaceFileEntry; kind: "rename" }
	| { entry: SpaceFileEntry; kind: "trash" };

export function SpaceFileEntryDialogs(input: {
	api: SpaceApi;
	dialog: SpaceFileEntryDialogState;
	onClose: () => void;
	onMove: (
		entry: SpaceFileEntry,
		destinationId: string | null
	) => Promise<void>;
	onRename: (entry: SpaceFileEntry, name: string) => Promise<void>;
	onTrash: (entry: SpaceFileEntry) => Promise<void>;
	pendingAction: string | null;
	spaceId: string;
}) {
	return (
		<>
			<RenameEntryDialog
				entry={input.dialog.kind === "rename" ? input.dialog.entry : null}
				onOpenChange={(open) => {
					if (!open) {
						input.onClose();
					}
				}}
				onSubmit={input.onRename}
				pending={input.pendingAction === "rename-entry"}
			/>
			<MoveEntryDialog
				entry={input.dialog.kind === "move" ? input.dialog.entry : null}
				loadDestinations={(excludedFolderId) =>
					loadMoveDestinations({
						api: input.api,
						excludedFolderId,
						spaceId: input.spaceId,
					})
				}
				onOpenChange={(open) => {
					if (!open) {
						input.onClose();
					}
				}}
				onSubmit={input.onMove}
				pending={input.pendingAction === "move-entry"}
				queryKey={["space-files", input.spaceId, "move-destinations"]}
			/>
			<TrashEntryDialog
				entry={input.dialog.kind === "trash" ? input.dialog.entry : null}
				onConfirm={input.onTrash}
				onOpenChange={(open) => {
					if (!open) {
						input.onClose();
					}
				}}
				pending={input.pendingAction === "trash-entry"}
			/>
		</>
	);
}

export function FolderNameDialog(input: {
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

export function NewTextFileDialog(input: {
	kind: "markdown" | "text" | "csv";
	onOpenChange: (open: boolean) => void;
	onSubmit: (input: { content: string; name: string }) => Promise<void>;
	open: boolean;
	pending: boolean;
}) {
	const [name, setName] = useState("");
	const [content, setContent] = useState("");
	const contentOverLimit =
		utf8ByteLength(content) > SPACE_FILE_MAX_TEXT_EDIT_SIZE_BYTES;
	useEffect(() => {
		if (input.open) {
			setName(NEW_TEXT_FILE_DETAILS[input.kind].defaultName);
			setContent("");
		}
	}, [input.kind, input.open]);
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
						<DialogTitle>{NEW_TEXT_FILE_DETAILS[input.kind].title}</DialogTitle>
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
							<Label>Contents</Label>
							{input.kind === "markdown" ? (
								<MarkdownEditor
									ariaLabel="File contents"
									disabled={input.pending}
									maxBytes={SPACE_FILE_MAX_TEXT_EDIT_SIZE_BYTES}
									onChange={setContent}
									placeholder="Start writing, or press '/' for commands…"
									value={content}
								/>
							) : (
								<Textarea
									aria-label="File contents"
									disabled={input.pending}
									onChange={(event) => setContent(event.currentTarget.value)}
									placeholder={
										input.kind === "csv" ? "Column,Value" : "Start writing…"
									}
									rows={10}
									value={content}
								/>
							)}
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
							disabled={
								input.pending || name.trim().length === 0 || contentOverLimit
							}
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

export function RenameEntryDialog<
	Entry extends { kind: "file" | "folder"; name: string },
>(input: {
	entry: Entry | null;
	onOpenChange: (open: boolean) => void;
	onSubmit: (entry: Entry, name: string) => Promise<void>;
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

export function MoveEntryDialog<
	Entry extends {
		id: string;
		kind: "file" | "folder";
		name: string;
		parentId: string | null;
	},
>(input: {
	entry: Entry | null;
	loadDestinations: (
		excludedFolderId?: string
	) => Promise<readonly { id: string; path: string }[]>;
	onOpenChange: (open: boolean) => void;
	onSubmit: (entry: Entry, destinationId: string | null) => Promise<void>;
	pending: boolean;
	queryKey: readonly string[];
	rootLabel?: string;
}) {
	const [destinationValue, setDestinationValue] = useState(
		ROOT_DESTINATION_VALUE
	);
	useEffect(() => {
		setDestinationValue(input.entry?.parentId ?? ROOT_DESTINATION_VALUE);
	}, [input.entry]);
	const destinationsQuery = useQuery({
		enabled: input.entry !== null,
		queryKey: [...input.queryKey, input.entry?.id],
		queryFn: async () =>
			await input.loadDestinations(
				input.entry?.kind === "folder" ? input.entry.id : undefined
			),
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
							<option value={ROOT_DESTINATION_VALUE}>
								{input.rootLabel ?? "Files"} (root)
							</option>
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

/**
 * Walks every folder to build the "Move to folder…" destination list. This
 * only ever collects `entry.kind === "folder"` results, and folders carry no
 * origin classification — the repository's origin filter already always
 * includes folders regardless of `origin`. Passing `origin: "all"` here is
 * presentation-only insurance against a future change to that exemption; it
 * is not an authorization or visibility decision, and it must never be
 * read as one. This function does not, and must not, decide which files a
 * caller may read or write — that stays owned by the server-side access
 * checks on each move request.
 */
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
			query: { parentId, view: "active", origin: "all" },
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

export function TrashEntryDialog(input: {
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
