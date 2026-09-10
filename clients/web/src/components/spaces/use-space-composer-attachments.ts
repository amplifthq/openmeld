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
import {
	readComposerFileDrafts,
	removeComposerFileDraft,
	saveComposerFileDraft,
} from "#/lib/spaces/composer-file-drafts";
import { runSpaceComposerIdempotentRequestWithRetry } from "#/lib/spaces/errors";
import { formatSpaceFileSizeLimitError } from "./space-file-utils";

export function useSpaceComposerFiles(input: {
	organizationSlug: string;
	profileId: string;
	spaceId: string;
	draftScope?: string;
}) {
	const [files, setFiles] = useState<SpaceComposerFile[]>([]);
	const [submittingIds, setSubmittingIds] = useState<ReadonlySet<string>>(
		new Set()
	);
	const submittingIdsRef = useRef(new Set<string>());
	const uploadTasksRef = useRef(new Map<string, Promise<void>>());
	const uploadControllersRef = useRef(new Map<string, AbortController>());
	const sourceFilesRef = useRef(new Map<string, File>());
	const filesRef = useRef<SpaceComposerFile[]>([]);
	const activeFileIdsRef = useRef(new Set<string>());
	const previewUrlsByLocalIdRef = useRef(new Map<string, string>());
	const scopeKey = `${input.organizationSlug}:${input.profileId}:${input.spaceId}${input.draftScope ? `:${input.draftScope}` : ""}`;
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
			files: filesRef.current.filter(
				(file) => !submittingIdsRef.current.has(file.localId)
			),
			...activeScopeRef.current,
		});
		for (const [localId, url] of previewUrlsByLocalIdRef.current) {
			if (!submittingIdsRef.current.has(localId)) {
				URL.revokeObjectURL(url);
				previewUrlsByLocalIdRef.current.delete(localId);
			}
		}
		for (const localId of activeFileIdsRef.current) {
			if (!submittingIdsRef.current.has(localId)) {
				uploadControllersRef.current.get(localId)?.abort();
				uploadControllersRef.current.delete(localId);
				activeFileIdsRef.current.delete(localId);
				removeFileDraft(localId);
				sourceFilesRef.current.delete(localId);
			}
		}
		updateFiles((current) =>
			current.filter((file) => submittingIdsRef.current.has(file.localId))
		);
	}, [updateFiles]);

	const consumePublishedFiles = useCallback(
		(publishedLocalIds: readonly string[]) => {
			if (publishedLocalIds.length === 0) {
				return;
			}
			const publishedLocalIdSet = new Set(publishedLocalIds);
			for (const localId of publishedLocalIdSet) {
				removeFileDraft(localId);
				activeFileIdsRef.current.delete(localId);
				sourceFilesRef.current.delete(localId);
				const previewUrl = previewUrlsByLocalIdRef.current.get(localId);
				if (previewUrl) {
					URL.revokeObjectURL(previewUrl);
					previewUrlsByLocalIdRef.current.delete(localId);
				}
			}
			updateFiles((current) =>
				current.filter((file) => !publishedLocalIdSet.has(file.localId))
			);
		},
		[updateFiles]
	);

	useEffect(() => {
		if (previousScopeKeyRef.current !== scopeKey) {
			clearFiles();
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
		clearFiles,
	]);

	useEffect(
		() => () => {
			for (const url of previewUrlsByLocalIdRef.current.values()) {
				URL.revokeObjectURL(url);
			}
		},
		[]
	);

	const removeFile = useCallback(
		(localId: string) => {
			uploadControllersRef.current.get(localId)?.abort();
			uploadControllersRef.current.delete(localId);
			removeFileDraft(localId);
			const file = filesRef.current.find((item) => item.localId === localId);
			if (file?.upload) {
				discardStagedFiles({
					files: [file],
					...activeScopeRef.current,
				});
			}
			activeFileIdsRef.current.delete(localId);
			sourceFilesRef.current.delete(localId);
			uploadTasksRef.current.delete(localId);
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
		async (
			selectedFiles: readonly File[],
			restored?: { id: string; publishMutationId: string }[]
		) => {
			const availableSlots = Math.max(
				0,
				SPACE_MESSAGE_FILE_MAX_COUNT -
					filesRef.current.filter(
						(file) => !submittingIdsRef.current.has(file.localId)
					).length
			);
			const acceptedFiles = selectedFiles.slice(0, availableSlots);
			if (acceptedFiles.length === 0) {
				return;
			}

			const pending = acceptedFiles.map((file, index) => {
				const localId =
					restored?.[index]?.id ?? `composer-file:${crypto.randomUUID()}`;
				const mimeType = resolveSpaceFileMimeType({
					declaredMimeType: file.type,
					fileName: file.name,
				});
				const previewUrl = mimeType.startsWith("image/")
					? URL.createObjectURL(file)
					: null;
				activeFileIdsRef.current.add(localId);
				sourceFilesRef.current.set(localId, file);
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
						progress: 0,
						publishMutationId:
							restored?.[index]?.publishMutationId ?? crypto.randomUUID(),
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
				pending.map(({ file, item }) => {
					const task = uploadPendingFile({
						controllers: uploadControllersRef.current,
						activeFileIds: activeFileIdsRef.current,
						file,
						item,
						organizationSlug: input.organizationSlug,
						profileId: input.profileId,
						setFiles: updateFiles,
						spaceId: input.spaceId,
						draftScopeKey: scopeKey,
					});
					uploadTasksRef.current.set(item.localId, task);
					return task;
				})
			);
		},
		[
			input.organizationSlug,
			input.profileId,
			input.spaceId,
			scopeKey,
			updateFiles,
		]
	);

	useEffect(() => {
		let disposed = false;
		readComposerFileDrafts(scopeKey)
			.then((drafts) => {
				const pending = drafts.filter(
					(d) => !activeFileIdsRef.current.has(d.id)
				);
				if (!disposed && pending.length) {
					return addFiles(
						pending.map((d) => d.file),
						pending
					);
				}
			})
			.catch((error) =>
				console.error("Could not restore attachment drafts", error)
			);
		return () => {
			disposed = true;
		};
	}, [scopeKey, addFiles]);

	const beginSubmission = useCallback(() => {
		const submitted = filesRef.current.filter(
			(file) => !submittingIdsRef.current.has(file.localId)
		);
		for (const file of submitted) {
			submittingIdsRef.current.add(file.localId);
		}
		setSubmittingIds(new Set(submittingIdsRef.current));
		return submitted;
	}, []);
	const finishSubmission = useCallback(
		(submitted: readonly SpaceComposerFile[]) => {
			for (const file of submitted) {
				submittingIdsRef.current.delete(file.localId);
				uploadTasksRef.current.delete(file.localId);
			}
			setSubmittingIds(new Set(submittingIdsRef.current));
		},
		[]
	);

	const publishReadyFiles = useCallback(
		async (submitted: readonly SpaceComposerFile[]) => {
			await Promise.all(
				submitted.map((file) => uploadTasksRef.current.get(file.localId))
			);
			// A user retry re-stages failed uploads with the same idempotency key.
			await Promise.all(
				submitted.map(async (file) => {
					const current = filesRef.current.find(
						(item) => item.localId === file.localId
					);
					const source = sourceFilesRef.current.get(file.localId);
					if (current?.status === "failed" && !current.upload && source) {
						await uploadPendingFile({
							draftScopeKey: scopeKey,
							controllers: uploadControllersRef.current,
							activeFileIds: activeFileIdsRef.current,
							file: source,
							item: current,
							organizationSlug: input.organizationSlug,
							profileId: input.profileId,
							spaceId: input.spaceId,
							setFiles: updateFiles,
						});
					}
				})
			);
			const readyFiles = submitted.map((submittedFile) =>
				filesRef.current.find((file) => file.localId === submittedFile.localId)
			);
			if (readyFiles.some((file) => !file?.upload)) {
				throw new Error(
					"A file couldn't be uploaded. Your message wasn't sent."
				);
			}
			const published = await Promise.all(
				readyFiles.map(
					async (file) =>
						file &&
						publishPendingFile({
							file,
							organizationSlug: input.organizationSlug,
							profileId: input.profileId,
							setFiles: updateFiles,
							spaceId: input.spaceId,
						})
				)
			);
			if (published.some((result) => !result)) {
				throw new Error(
					"A file couldn't be attached. Your message wasn't sent."
				);
			}
			const messageFiles: SpaceMessageFileReference[] = [];
			const publishedLocalIds: string[] = [];
			const previewUrlsByFileId = new Map<string, string>();
			for (const result of published) {
				if (!result) {
					continue;
				}
				messageFiles.push(result.file);
				publishedLocalIds.push(result.localId);
				if (result.previewUrl) {
					previewUrlsByFileId.set(result.file.fileId, result.previewUrl);
				}
			}
			return { messageFiles, previewUrlsByFileId, publishedLocalIds };
		},
		[
			input.organizationSlug,
			input.profileId,
			input.spaceId,
			scopeKey,
			updateFiles,
		]
	);

	return {
		addFiles,
		beginSubmission,
		finishSubmission,
		clearFiles,
		consumePublishedFiles,
		files: files.filter((file) => !submittingIds.has(file.localId)),
		isAtLimit:
			files.filter((file) => !submittingIds.has(file.localId)).length >=
			SPACE_MESSAGE_FILE_MAX_COUNT,
		publishReadyFiles,
		removeFile,
	};
}

async function uploadPendingFile(input: {
	draftScopeKey: string;
	controllers: Map<string, AbortController>;
	activeFileIds: Set<string>;
	file: File;
	item: SpaceComposerFile;
	organizationSlug: string;
	profileId: string;
	setFiles: Dispatch<SetStateAction<SpaceComposerFile[]>>;
	spaceId: string;
}): Promise<void> {
	const controller = new AbortController();
	input.controllers.set(input.item.localId, controller);
	try {
		if (input.file.size > SPACE_FILE_MAX_SIZE_BYTES) {
			throw new Error(formatSpaceFileSizeLimitError(input.item.fileName));
		}
		await saveComposerFileDraft({
			id: input.item.localId,
			scope: input.draftScopeKey,
			file: input.file,
			publishMutationId: input.item.publishMutationId,
		});
		const api = createOrganizationScopedWebSpaceApi({
			organizationSlug: input.organizationSlug,
			openMeldProfileId: input.profileId,
		});
		const stageInput = {
			signal: controller.signal,
			bytes: input.file,
			mimeType: input.item.mimeType,
			name: input.item.fileName,
			spaceId: input.spaceId,
			uploadId: input.item.localId.replace("composer-file:", ""),
			onProgress: (uploaded: number, total: number) =>
				updateFile(input.setFiles, input.item.localId, (current) => ({
					...current,
					progress: Math.round((uploaded / total) * 100),
				})),
		};
		const upload = await runSpaceComposerIdempotentRequestWithRetry(
			async () => await api.stageComposerUpload(stageInput)
		);
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
	} finally {
		if (input.controllers.get(input.item.localId) === controller) {
			input.controllers.delete(input.item.localId);
		}
	}
}

function removeFileDraft(id: string) {
	removeComposerFileDraft(id).catch((error) =>
		console.error("Could not remove attachment draft", { id, error })
	);
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
	localId: string;
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
			localId: input.file.localId,
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
			message: formatSpaceFileSizeLimitError(),
			requestId: failure.requestId,
		};
	}
	return {
		message: failure.message || "OpenMeld couldn't add this file. Try again.",
		requestId: failure.requestId,
	};
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
