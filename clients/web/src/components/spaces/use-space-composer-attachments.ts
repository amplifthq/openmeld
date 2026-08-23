import { toStructuredApiClientFailure } from "@openmeld/api-client";
import {
	resolveSpaceFileMimeType,
	SPACE_FILE_MAX_SIZE_BYTES,
	SPACE_MESSAGE_FILE_MAX_COUNT,
} from "@openmeld/schemas";
import type {
	SpaceFileDescriptor,
	SpaceMessageFileReference,
} from "@openmeld/schemas/types";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createOrganizationScopedWebSpaceApi } from "#/lib/spaces/api";
import type { SpaceComposerFile } from "#/lib/spaces/composer-attachment";

export function useSpaceComposerFiles(input: {
	organizationSlug: string;
	profileId: string;
	spaceId: string;
}) {
	const [files, setFiles] = useState<SpaceComposerFile[]>([]);
	const activeFileIdsRef = useRef(new Set<string>());
	const previewUrlsByLocalIdRef = useRef(new Map<string, string>());
	const scopeKey = `${input.organizationSlug}:${input.profileId}:${input.spaceId}`;
	const previousScopeKeyRef = useRef(scopeKey);

	const clearFiles = useCallback(() => {
		releasePreviewUrls(previewUrlsByLocalIdRef.current);
		activeFileIdsRef.current.clear();
		setFiles([]);
	}, []);

	useEffect(() => {
		if (previousScopeKeyRef.current !== scopeKey) {
			releasePreviewUrls(previewUrlsByLocalIdRef.current);
			activeFileIdsRef.current.clear();
			setFiles([]);
			previousScopeKeyRef.current = scopeKey;
		}
		return () => {
			releasePreviewUrls(previewUrlsByLocalIdRef.current);
			activeFileIdsRef.current.clear();
		};
	}, [scopeKey]);

	const removeFile = useCallback((localId: string) => {
		activeFileIdsRef.current.delete(localId);
		const previewUrl = previewUrlsByLocalIdRef.current.get(localId);
		if (previewUrl) {
			URL.revokeObjectURL(previewUrl);
			previewUrlsByLocalIdRef.current.delete(localId);
		}
		setFiles((current) => current.filter((file) => file.localId !== localId));
	}, []);

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
						descriptor: null,
						errorMessage: null,
						errorRequestId: null,
						fileName: file.name || "Untitled file",
						localId,
						mimeType,
						previewUrl,
						progress: 20,
						status: "uploading",
					} satisfies SpaceComposerFile,
				};
			});
			setFiles((current) => [...current, ...pending.map(({ item }) => item)]);

			await Promise.all(
				pending.map(({ file, item }) =>
					uploadPendingFile({
						activeFileIds: activeFileIdsRef.current,
						file,
						item,
						organizationSlug: input.organizationSlug,
						profileId: input.profileId,
						setFiles,
						spaceId: input.spaceId,
					})
				)
			);
		},
		[input.organizationSlug, input.profileId, input.spaceId]
	);

	return {
		addFiles,
		clearFiles,
		files,
		isAtLimit: files.length >= SPACE_MESSAGE_FILE_MAX_COUNT,
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
		const descriptor = await createOrganizationScopedWebSpaceApi({
			organizationSlug: input.organizationSlug,
			openMeldProfileId: input.profileId,
		}).uploadFile({
			bytes: input.file,
			clientMutationId: crypto.randomUUID(),
			mimeType: input.item.mimeType,
			name: input.item.fileName,
			parentId: null,
			spaceId: input.spaceId,
		});
		if (!input.activeFileIds.has(input.item.localId)) {
			return;
		}
		updateFile(input.setFiles, input.item.localId, (current) => ({
			...current,
			descriptor: toMessageFileReference(descriptor),
			errorMessage: null,
			errorRequestId: null,
			fileName: descriptor.name,
			mimeType: descriptor.latestRevision.mimeType,
			progress: 100,
			status: "ready",
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
			descriptor: null,
			errorMessage: failure.message,
			errorRequestId: failure.requestId,
			progress: 100,
			status: "failed",
		}));
	}
}

function toMessageFileReference(
	descriptor: SpaceFileDescriptor
): SpaceMessageFileReference {
	return {
		fileId: descriptor.id,
		mimeType: descriptor.latestRevision.mimeType,
		name: descriptor.name,
		revision: descriptor.latestRevision.revision,
		sizeBytes: descriptor.latestRevision.sizeBytes,
	};
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
