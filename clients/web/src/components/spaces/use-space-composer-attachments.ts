import { toStructuredApiClientFailure } from "@openmeld/api-client";
import {
	resolveSpaceFileMimeType,
	SPACE_FILE_MAX_SIZE_BYTES,
	SPACE_MESSAGE_FILE_MAX_COUNT,
} from "@openmeld/schemas";
import type { SpaceMessageFileReference } from "@openmeld/schemas/types";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createOrganizationScopedWebSpaceApi } from "#/lib/spaces/api";
import type { SpaceComposerFile } from "#/lib/spaces/composer-attachment";
import { runSpaceComposerIdempotentRequestWithRetry } from "#/lib/spaces/errors";

export function useSpaceComposerFiles(input: {
	organizationSlug: string;
	profileId: string;
	spaceId: string;
}) {
	const [files, setFiles] = useState<SpaceComposerFile[]>([]);
	const filesRef = useRef<SpaceComposerFile[]>([]);
	const activeFileIdsRef = useRef(new Set<string>());
	const previewUrlsByLocalIdRef = useRef(new Map<string, string>());
	const scopeKey = `${input.organizationSlug}:${input.profileId}:${input.spaceId}`;
	const previousScopeKeyRef = useRef(scopeKey);
	const activeScopeRef = useRef({
		organizationSlug: input.organizationSlug,
		profileId: input.profileId,
		spaceId: input.spaceId,
	});

	const updateFiles = useCallback(
		(update: SetStateAction<SpaceComposerFile[]>) => {
			const next =
				typeof update === "function" ? update(filesRef.current) : update;
			filesRef.current = next;
			setFiles(next);
		},
		[]
	);

	const clearFiles = useCallback(() => {
		discardStagedFiles({
			files: filesRef.current,
			...activeScopeRef.current,
		});
		releasePreviewUrls(previewUrlsByLocalIdRef.current);
		activeFileIdsRef.current.clear();
		updateFiles([]);
	}, [updateFiles]);

	useEffect(() => {
		if (previousScopeKeyRef.current !== scopeKey) {
			discardStagedFiles({
				files: filesRef.current,
				...activeScopeRef.current,
			});
			releasePreviewUrls(previewUrlsByLocalIdRef.current);
			activeFileIdsRef.current.clear();
			updateFiles([]);
			previousScopeKeyRef.current = scopeKey;
			activeScopeRef.current = {
				organizationSlug: input.organizationSlug,
				profileId: input.profileId,
				spaceId: input.spaceId,
			};
		}
	}, [
		input.organizationSlug,
		input.profileId,
		input.spaceId,
		scopeKey,
		updateFiles,
	]);

	useEffect(() => {
		return () => {
			discardStagedFiles({
				files: filesRef.current,
				...activeScopeRef.current,
			});
			releasePreviewUrls(previewUrlsByLocalIdRef.current);
			activeFileIdsRef.current.clear();
		};
	}, []);

	const removeFile = useCallback(
		(localId: string) => {
			const file = filesRef.current.find((item) => item.localId === localId);
			if (file?.upload) {
				discardStagedFiles({
					files: [file],
					...activeScopeRef.current,
				});
			}
			activeFileIdsRef.current.delete(localId);
			const previewUrl = previewUrlsByLocalIdRef.current.get(localId);
			if (previewUrl) {
				URL.revokeObjectURL(previewUrl);
				previewUrlsByLocalIdRef.current.delete(localId);
			}
			updateFiles((current) =>
				current.filter((currentFile) => currentFile.localId !== localId)
			);
		},
		[updateFiles]
	);

	const addFiles = useCallback(
		async (selectedFiles: readonly File[]) => {
			const availableSlots = Math.max(
				0,
				SPACE_MESSAGE_FILE_MAX_COUNT - activeFileIdsRef.current.size
			);
			const acceptedFiles = selectedFiles.slice(0, availableSlots);
			if (acceptedFiles.length === 0) {
				return;
			}

			const pending = acceptedFiles.map((file) => {
				const localId = `composer-file:${crypto.randomUUID()}`;
				const mimeType = resolveSpaceFileMimeType({
					declaredMimeType: file.type,
					fileName: file.name,
				});
				const previewUrl = mimeType.startsWith("image/")
					? URL.createObjectURL(file)
					: null;
				activeFileIdsRef.current.add(localId);
				if (previewUrl) {
					previewUrlsByLocalIdRef.current.set(localId, previewUrl);
				}
				return {
					file,
					item: {
						errorMessage: null,
						errorRequestId: null,
						fileName: file.name || "Untitled file",
						localId,
						mimeType,
						previewUrl,
						progress: 20,
						publishMutationId: crypto.randomUUID(),
						status: "uploading",
						upload: null,
					} satisfies SpaceComposerFile,
				};
			});
			updateFiles((current) => [
				...current,
				...pending.map(({ item }) => item),
			]);

			await Promise.all(
				pending.map(({ file, item }) =>
					uploadPendingFile({
						activeFileIds: activeFileIdsRef.current,
						file,
						item,
						organizationSlug: input.organizationSlug,
						profileId: input.profileId,
						setFiles: updateFiles,
						spaceId: input.spaceId,
					})
				)
			);
		},
		[input.organizationSlug, input.profileId, input.spaceId, updateFiles]
	);

	const publishReadyFiles = useCallback(async () => {
		const readyFiles = filesRef.current.filter(
			(file) => file.status === "ready" && file.upload !== null
		);
		const published = await Promise.all(
			readyFiles.map(
				async (file) =>
					await publishPendingFile({
						file,
						organizationSlug: input.organizationSlug,
						profileId: input.profileId,
						setFiles: updateFiles,
						spaceId: input.spaceId,
					})
			)
		);
		const messageFiles: SpaceMessageFileReference[] = [];
		const previewUrlsByFileId = new Map<string, string>();
		for (const result of published) {
			if (!result) {
				continue;
			}
			messageFiles.push(result.file);
			if (result.previewUrl) {
				previewUrlsByFileId.set(result.file.fileId, result.previewUrl);
			}
		}
		return { messageFiles, previewUrlsByFileId };
	}, [input.organizationSlug, input.profileId, input.spaceId, updateFiles]);

	return {
		addFiles,
		clearFiles,
		files,
		isAtLimit: files.length >= SPACE_MESSAGE_FILE_MAX_COUNT,
		publishReadyFiles,
		removeFile,
	};
}

async function uploadPendingFile(input: {
	activeFileIds: Set<string>;
	file: File;
	item: SpaceComposerFile;
	organizationSlug: string;
	profileId: string;
	setFiles: Dispatch<SetStateAction<SpaceComposerFile[]>>;
	spaceId: string;
}): Promise<void> {
	try {
		if (input.file.size > SPACE_FILE_MAX_SIZE_BYTES) {
			throw new Error(`${input.item.fileName} is larger than 10 MiB.`);
		}
		updateFile(input.setFiles, input.item.localId, (current) => ({
			...current,
			progress: 55,
		}));
		const upload = await createOrganizationScopedWebSpaceApi({
			organizationSlug: input.organizationSlug,
			openMeldProfileId: input.profileId,
		}).stageComposerUpload({
			bytes: input.file,
			mimeType: input.item.mimeType,
			name: input.item.fileName,
			spaceId: input.spaceId,
			uploadId: input.item.localId.replace("composer-file:", ""),
		});
		if (!input.activeFileIds.has(input.item.localId)) {
			discardComposerUploadIds({
				organizationSlug: input.organizationSlug,
				profileId: input.profileId,
				spaceId: input.spaceId,
				uploadIds: [upload.id],
			});
			return;
		}
		updateFile(input.setFiles, input.item.localId, (current) => ({
			...current,
			errorMessage: null,
			errorRequestId: null,
			fileName: upload.name,
			mimeType: upload.mimeType,
			progress: 100,
			status: "ready",
			upload,
		}));
	} catch (error) {
		if (!input.activeFileIds.has(input.item.localId)) {
			return;
		}
		console.error("[openmeld.web.space.composer_file_failed]", {
			error,
			fileName: input.item.fileName,
			spaceId: input.spaceId,
		});
		const failure = resolveUploadFailure(error);
		updateFile(input.setFiles, input.item.localId, (current) => ({
			...current,
			errorMessage: failure.message,
			errorRequestId: failure.requestId,
			progress: 100,
			status: "failed",
			upload: null,
		}));
	}
}

function toMessageFileReference(descriptor: {
	id: string;
	latestRevision: { mimeType: string; revision: number; sizeBytes: number };
	name: string;
}): SpaceMessageFileReference {
	return {
		fileId: descriptor.id,
		mimeType: descriptor.latestRevision.mimeType,
		name: descriptor.name,
		revision: descriptor.latestRevision.revision,
		sizeBytes: descriptor.latestRevision.sizeBytes,
	};
}

async function publishPendingFile(input: {
	file: SpaceComposerFile;
	organizationSlug: string;
	profileId: string;
	setFiles: Dispatch<SetStateAction<SpaceComposerFile[]>>;
	spaceId: string;
}): Promise<{
	file: SpaceMessageFileReference;
	previewUrl: string | null;
} | null> {
	const upload = input.file.upload;
	if (!upload) {
		return null;
	}
	try {
		const api = createOrganizationScopedWebSpaceApi({
			organizationSlug: input.organizationSlug,
			openMeldProfileId: input.profileId,
		});
		const descriptor = await runSpaceComposerIdempotentRequestWithRetry(
			async () =>
				await api.publishComposerUpload({
					clientMutationId: input.file.publishMutationId,
					spaceId: input.spaceId,
					uploadId: upload.id,
				})
		);
		return {
			file: toMessageFileReference(descriptor),
			previewUrl: input.file.previewUrl,
		};
	} catch (error) {
		console.error("[openmeld.web.space.composer_file_publish_failed]", {
			error,
			fileName: input.file.fileName,
			spaceId: input.spaceId,
			uploadId: upload.id,
		});
		const failure = resolveUploadFailure(error);
		updateFile(input.setFiles, input.file.localId, (current) => ({
			...current,
			errorMessage: failure.message,
			errorRequestId: failure.requestId,
			progress: 100,
			status: "failed",
		}));
		return null;
	}
}

function discardStagedFiles(input: {
	files: readonly SpaceComposerFile[];
	organizationSlug: string;
	profileId: string;
	spaceId: string;
}): void {
	discardComposerUploadIds({
		organizationSlug: input.organizationSlug,
		profileId: input.profileId,
		spaceId: input.spaceId,
		uploadIds: input.files.flatMap((file) =>
			file.upload ? [file.upload.id] : []
		),
	});
}

function discardComposerUploadIds(input: {
	organizationSlug: string;
	profileId: string;
	spaceId: string;
	uploadIds: readonly string[];
}): void {
	if (input.uploadIds.length === 0) {
		return;
	}
	const api = createOrganizationScopedWebSpaceApi({
		organizationSlug: input.organizationSlug,
		openMeldProfileId: input.profileId,
	});
	Promise.allSettled(
		input.uploadIds.map(
			async (uploadId) =>
				await api.discardComposerUpload({ spaceId: input.spaceId, uploadId })
		)
	).then((results) => {
		const failed = results.filter((result) => result.status === "rejected");
		if (failed.length > 0) {
			console.warn("[openmeld.web.space.composer_upload_discard_failed]", {
				failedCount: failed.length,
				spaceId: input.spaceId,
			});
		}
	});
}

function resolveUploadFailure(error: unknown): {
	message: string;
	requestId: string | null;
} {
	const failure = toStructuredApiClientFailure(error);
	if (failure.code === "space_file.too_large") {
		return {
			message: "Files must be 10 MiB or smaller.",
			requestId: failure.requestId,
		};
	}
	return {
		message: failure.message || "OpenMeld couldn't add this file. Try again.",
		requestId: failure.requestId,
	};
}

function releasePreviewUrls(previewUrlsByLocalId: Map<string, string>): void {
	for (const previewUrl of previewUrlsByLocalId.values()) {
		URL.revokeObjectURL(previewUrl);
	}
	previewUrlsByLocalId.clear();
}

function updateFile(
	setFiles: Dispatch<SetStateAction<SpaceComposerFile[]>>,
	localId: string,
	update: (file: SpaceComposerFile) => SpaceComposerFile
): void {
	setFiles((current) =>
		current.map((file) => (file.localId === localId ? update(file) : file))
	);
}
