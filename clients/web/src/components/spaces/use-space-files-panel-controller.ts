"use client";

import {
	resolveSpaceFileMimeType,
	SPACE_FILE_MAX_SIZE_BYTES,
} from "@openmeld/schemas";
import type {
	SpaceFileDescriptor,
	SpaceFileEntry,
} from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	createOrganizationScopedWebSpaceApi,
	createUnscopedWebSpaceApi,
} from "#/lib/spaces/api";
import { baseQueryOptions } from "#/query/query-config";
import { spaceFileQueryKeys } from "#/query/spaces/space-files";
import type { SpaceFileEntryDialogState } from "./space-file-dialogs";
import { resolveSpaceFileErrorMessage } from "./space-file-utils";

export type SpaceFilesPanelProps = {
	fileToOpen?: { fileId: string; requestId: string } | null;
	openMeldProfileId?: string;
	organizationSlug?: string;
	readOnly?: boolean;
	spaceId: string;
};

const ROOT_FOLDER_ID: null = null;

export function useSpaceFilesPanelController(input: SpaceFilesPanelProps) {
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
	const [markdownFileDialogOpen, setMarkdownFileDialogOpen] = useState(false);
	const [entryDialog, setEntryDialog] = useState<SpaceFileEntryDialogState>({
		kind: "closed",
	});
	const [pendingAction, setPendingAction] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	useEffect(() => {
		if (!input.fileToOpen) {
			return;
		}
		let cancelled = false;
		api
			.getFile({ fileId: input.fileToOpen.fileId, spaceId: input.spaceId })
			.then(({ file }) => {
				if (cancelled) {
					return;
				}
				setParentId(file.parentId);
				setSelectedFile(file);
				setActionError(null);
			})
			.catch((error: unknown) => {
				if (cancelled) {
					return;
				}
				const message = resolveSpaceFileErrorMessage(error);
				setActionError(message);
				toast.error(message);
			});
		return () => {
			cancelled = true;
		};
	}, [api, input.fileToOpen, input.spaceId]);
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
	const runAction = async <T>(
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
			}
			await Promise.all(
				files.map((file) =>
					api.uploadFile({
						spaceId: input.spaceId,
						name: file.name,
						parentId,
						clientMutationId: crypto.randomUUID(),
						mimeType: resolveSpaceFileMimeType({
							declaredMimeType: file.type,
							fileName: file.name,
						}),
						bytes: file,
					})
				)
			);
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

	return {
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
	};
}
