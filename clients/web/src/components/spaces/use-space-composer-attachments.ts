import { toStructuredApiClientFailure } from "@openmeld/api-client";
import {
	resolveSpaceFileMimeType,
	SPACE_FILE_MAX_SIZE_BYTES,
	SPACE_MESSAGE_FILE_MAX_COUNT,
} from "@openmeld/schemas";
import type {
	SpaceComposerUploadDescriptor,
	SpaceFileImageDimensions,
	SpaceMessageFileReference,
} from "@openmeld/schemas/types";
import { readDisplayImageDimensions } from "@openmeld/utils";
import { useQueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { registerClientVersionRecoveryBlocker } from "#/client-version-recovery";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import type {
	ComposerFileFailurePhase,
	SpaceComposerFile,
} from "#/lib/spaces/composer-attachment";
import {
	type ComposerFileDraft,
	type ComposerFileSelection,
	isComposerFileDraftRetired,
	readComposerFileDraftCleanup,
	readComposerFileDrafts,
	readComposerFileDraftsByIds,
	removeComposerFileDraft,
	retryComposerFileDraftCleanup,
	saveComposerFileDraft,
	saveComposerFileDraftUpload,
	subscribeComposerFileDrafts,
} from "#/lib/spaces/composer-file-drafts";
import { runSpaceComposerIdempotentRequestWithRetry } from "#/lib/spaces/errors";
import { SPACE_COMPOSER_FILE_PUBLISH_TIMEOUT_MS } from "#/lib/spaces/request-timeouts";
import { spaceFileMediaResources } from "#/query/spaces/space-file-media-resource";
import {
	cacheSpaceComposerMedia,
	seedPublishedSpaceFileMedia,
	spaceFileQueryKeys,
} from "#/query/spaces/space-files";
import { formatSpaceFileSizeLimitError } from "./space-file-utils";

type ComposerFileScope = {
	organizationSlug?: string;
	profileId: string;
	spaceId: string;
	draftScope?: string;
	deferUpload?: boolean;
	storageKey?: string;
	restoreFromScopes?: readonly string[];
};

type ComposerFileDiscoveryResult =
	| { status: "ready" }
	| { error: unknown; status: "failed" }
	| { status: "superseded" };

type ComposerFileDiscoveryState =
	| { generation: number; status: "not_started" }
	| {
			generation: number;
			status: "loading";
			task: Promise<ComposerFileDiscoveryResult>;
	  }
	| { generation: number; status: "ready" }
	| { error: unknown; generation: number; status: "failed" };

export class ComposerFileDiscoveryError extends Error {
	readonly cause: unknown;

	constructor(cause: unknown) {
		super("Couldn't restore your attachment drafts. Retry to continue.");
		this.name = "ComposerFileDiscoveryError";
		this.cause = cause;
	}
}

function assertComposerFileDiscoveryReady(state: ComposerFileDiscoveryState) {
	if (state.status === "failed") {
		throw new ComposerFileDiscoveryError(state.error);
	}
	if (state.status !== "ready") {
		throw new ComposerFileDiscoveryError(null);
	}
}

function createFileSession(input: ComposerFileScope) {
	return {
		submittingIds: new Set<string>(),
		uploadTasks: new Map<string, Promise<void>>(),
		uploadControllers: new Map<string, AbortController>(),
		sourceFiles: new Map<string, File>(),
		files: [] as SpaceComposerFile[],
		activeFileIds: new Set<string>(),
		// An older draft read must not undo removal or successful consumption.
		retiredFileIds: new Set<string>(),
		previewUrlsByLocalId: new Map<string, string>(),
		discovery: {
			generation: 0,
			status: "not_started",
		} as ComposerFileDiscoveryState,
		retryRestoration: null as
			| (() => Promise<ComposerFileDiscoveryResult>)
			| null,
		cleanupTasks: new Map<string, Promise<void>>(),
		scope: input,
	};
}

export type SpaceComposerFilesController = ReturnType<
	typeof useSpaceComposerFiles
>;

export function useSpaceComposerFiles(input: ComposerFileScope) {
	const queryClient = useQueryClient();
	const [, refresh] = useReducer((version: number) => version + 1, 0);
	const sessions = useRef(
		new Map<string, ReturnType<typeof createFileSession>>()
	);
	useEffect(
		() =>
			registerClientVersionRecoveryBlocker(() =>
				[...sessions.current.values()].some(
					(entry) =>
						entry.uploadTasks.size > 0 ||
						entry.submittingIds.size > 0 ||
						entry.files.some((file) => file.status !== "ready")
				)
			),
		[]
	);
	const scopeKey =
		input.storageKey ??
		`${input.organizationSlug}:${input.profileId}:${input.spaceId}${input.draftScope ? `:${input.draftScope}` : ""}`;
	// Async uploads and sends keep their original conversation's session even
	// while the hook renders another Space or thread. Navigation never discards it.
	const session = useMemo(() => {
		let session = sessions.current.get(scopeKey);
		if (!session) {
			session = createFileSession({
				organizationSlug: input.organizationSlug,
				profileId: input.profileId,
				spaceId: input.spaceId,
				draftScope: input.draftScope,
				storageKey: scopeKey,
			});
			sessions.current.set(scopeKey, session);
		}
		return session;
	}, [
		scopeKey,
		input.organizationSlug,
		input.profileId,
		input.spaceId,
		input.draftScope,
	]);

	const updateFiles = useCallback(
		(update: SetStateAction<SpaceComposerFile[]>) => {
			const next =
				typeof update === "function" ? update(session.files) : update;
			session.files = next;
			refresh();
		},
		[session]
	);

	const clearFiles = useCallback(() => {
		discardStagedFiles({
			files: session.files.filter(
				(file) => !session.submittingIds.has(file.localId)
			),
			...session.scope,
		});
		for (const [localId, url] of session.previewUrlsByLocalId) {
			if (!session.submittingIds.has(localId)) {
				queryClient.removeQueries({
					queryKey: spaceFileQueryKeys.content(
						session.scope.spaceId,
						localId,
						1
					),
					exact: true,
				});
				spaceFileMediaResources(queryClient).find(url)?.release();
				session.previewUrlsByLocalId.delete(localId);
			}
		}
		for (const localId of session.activeFileIds) {
			if (!session.submittingIds.has(localId)) {
				session.retiredFileIds.add(localId);
				session.uploadControllers.get(localId)?.abort();
				session.uploadControllers.delete(localId);
				session.activeFileIds.delete(localId);
				removeFileDraft(localId, session, "removed");
				session.sourceFiles.delete(localId);
			}
		}
		updateFiles((current) =>
			current.filter((file) => session.submittingIds.has(file.localId))
		);
	}, [queryClient, updateFiles, session]);

	const consumePublishedFiles = useCallback(
		(publishedLocalIds: readonly string[]) => {
			if (publishedLocalIds.length === 0) {
				return;
			}
			const publishedLocalIdSet = new Set(publishedLocalIds);
			for (const localId of publishedLocalIdSet) {
				queryClient.removeQueries({
					queryKey: spaceFileQueryKeys.content(
						session.scope.spaceId,
						localId,
						1
					),
					exact: true,
				});
				session.retiredFileIds.add(localId);
				removeFileDraft(localId, session, "sent");
				session.activeFileIds.delete(localId);
				session.sourceFiles.delete(localId);
				const previewUrl = session.previewUrlsByLocalId.get(localId);
				if (previewUrl) {
					spaceFileMediaResources(queryClient).find(previewUrl)?.release();
					session.previewUrlsByLocalId.delete(localId);
				}
			}
			updateFiles((current) =>
				current.filter((file) => !publishedLocalIdSet.has(file.localId))
			);
		},
		[queryClient, updateFiles, session]
	);

	const mounted = useRef(false);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			// StrictMode replays setup immediately. This is an effect-replay fence,
			// not a handoff timeout; cache/viewer leases own delivered previews.
			queueMicrotask(() => {
				if (mounted.current) {
					return;
				}
				for (const session of sessions.current.values()) {
					for (const url of session.previewUrlsByLocalId.values()) {
						spaceFileMediaResources(queryClient).find(url)?.release();
					}
				}
			});
		};
	}, [queryClient]);

	const removeFile = useCallback(
		(localId: string) => {
			queryClient.removeQueries({
				queryKey: spaceFileQueryKeys.content(session.scope.spaceId, localId, 1),
				exact: true,
			});
			session.retiredFileIds.add(localId);
			session.uploadControllers.get(localId)?.abort();
			session.uploadControllers.delete(localId);
			removeFileDraft(localId, session, "removed");
			const file = session.files.find((item) => item.localId === localId);
			if (file?.upload) {
				discardStagedFiles({
					files: [file],
					...session.scope,
				});
			}
			session.activeFileIds.delete(localId);
			session.sourceFiles.delete(localId);
			const previewUrl = session.previewUrlsByLocalId.get(localId);
			if (previewUrl) {
				spaceFileMediaResources(queryClient).find(previewUrl)?.release();
				session.previewUrlsByLocalId.delete(localId);
			}
			updateFiles((current) =>
				current.filter((currentFile) => currentFile.localId !== localId)
			);
		},
		[queryClient, updateFiles, session]
	);

	const startOrJoinFilePreparation = useCallback(
		(localId: string, allowSubmitted = false): Promise<void> => {
			const existingTask = session.uploadTasks.get(localId);
			if (existingTask) {
				return existingTask;
			}
			if (
				!session.activeFileIds.has(localId) ||
				session.retiredFileIds.has(localId) ||
				isComposerFileDraftRetired(localId) ||
				(!allowSubmitted && session.submittingIds.has(localId))
			) {
				return Promise.resolve();
			}
			const source = session.sourceFiles.get(localId);
			const item = session.files.find((file) => file.localId === localId);
			if (!(source && item)) {
				return Promise.resolve();
			}
			const capturedScope = session.scope;
			const task = Promise.resolve().then(async () => {
				await preparePendingFile({
					activeFileIds: session.activeFileIds,
					controllers: session.uploadControllers,
					deferUpload: input.deferUpload,
					draftScopeKey: scopeKey,
					file: source,
					item,
					organizationSlug: capturedScope.organizationSlug,
					profileId: capturedScope.profileId,
					retiredFileIds: session.retiredFileIds,
					setFiles: updateFiles,
					spaceId: capturedScope.spaceId,
				});
			});
			session.uploadTasks.set(localId, task);
			const finishTask = () => {
				if (session.uploadTasks.get(localId) === task) {
					session.uploadTasks.delete(localId);
					refresh();
				}
			};
			task.then(finishTask, finishTask);
			return task;
		},
		[input.deferUpload, scopeKey, session, updateFiles]
	);

	const addFiles = useCallback(
		async (
			selectedFiles: readonly File[],
			restored?: ComposerFileSelection[]
		) => {
			const availableSlots = Math.max(
				0,
				SPACE_MESSAGE_FILE_MAX_COUNT -
					session.files.filter(
						(file) => !session.submittingIds.has(file.localId)
					).length
			);
			const selected = selectedFiles
				.map((file, index) => ({ file, draft: restored?.[index] }))
				.filter(
					({ draft }) =>
						!(
							draft &&
							(session.activeFileIds.has(draft.id) ||
								session.retiredFileIds.has(draft.id))
						)
				)
				.slice(0, availableSlots);
			const acceptedFiles = selected.map(({ file }) => file);
			if (acceptedFiles.length === 0) {
				return;
			}

			// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: selection restoration keeps identity, validation, and preview ownership together.
			const pending = acceptedFiles.map((file, index) => {
				const restoredDraft = selected[index]?.draft;
				const savedUpload = restoredDraft?.upload;
				const localId =
					restoredDraft?.id ?? `composer-file:${crypto.randomUUID()}`;
				const uploadIsValid = savedUpload
					? isComposerUploadDescriptorValid(savedUpload, localId)
					: false;
				let status: SpaceComposerFile["status"] = "uploading";
				if (savedUpload) {
					status = uploadIsValid ? "ready" : "failed";
				}
				const mimeType = resolveSpaceFileMimeType({
					declaredMimeType: file.type,
					fileName: file.name,
				});
				const previewUrl = cacheSpaceComposerMedia({
					queryClient,
					bytes: file,
					mimeType,
					localId,
					spaceId: session.scope.spaceId,
				});
				session.activeFileIds.add(localId);
				session.sourceFiles.set(localId, file);
				if (previewUrl) {
					session.previewUrlsByLocalId.set(localId, previewUrl);
				}
				return {
					file,
					item: {
						errorMessage:
							savedUpload && !uploadIsValid
								? "This attachment upload expired. Retry to prepare it again."
								: null,
						errorRequestId: null,
						failurePhase:
							savedUpload && !uploadIsValid ? "persist-upload" : null,
						fileName: file.name || "Untitled file",
						localId,
						mimeType,
						previewUrl,
						progress: savedUpload ? 100 : 0,
						publishMutationId:
							restoredDraft?.publishMutationId ?? crypto.randomUUID(),
						status,
						upload: savedUpload ?? null,
					} satisfies SpaceComposerFile,
				};
			});
			updateFiles((current) => [
				...current,
				...pending.map(({ item }) => item),
			]);

			await Promise.all(
				pending.map(({ item }) => {
					if (item.status !== "uploading") {
						return Promise.resolve();
					}
					return startOrJoinFilePreparation(item.localId);
				})
			);
		},
		[queryClient, updateFiles, session, startOrJoinFilePreparation]
	);

	const migrationScopesKey = JSON.stringify(input.restoreFromScopes ?? []);
	useEffect(() => {
		let disposed = false;
		const scopes: string[] = [scopeKey, ...JSON.parse(migrationScopesKey)];
		const restore = () => {
			const generation = session.discovery.generation + 1;
			const task = Promise.all(scopes.map(readComposerFileDrafts))
				.then((batches) => batches.flat())
				.then((drafts) => {
					if (disposed || session.discovery.generation !== generation) {
						return { status: "superseded" } as const;
					}
					if (drafts.length) {
						addFiles(
							drafts.map((d) => d.file),
							drafts
						).catch((error) =>
							console.error(
								"Could not prepare restored attachment drafts",
								error
							)
						);
					}
					session.discovery = { generation, status: "ready" };
					refresh();
					return { status: "ready" } as const;
				})
				.catch((error) => {
					if (disposed || session.discovery.generation !== generation) {
						return { status: "superseded" } as const;
					}
					session.discovery = { error, generation, status: "failed" };
					refresh();
					console.error("Could not restore attachment drafts", error);
					return { error, status: "failed" } as const;
				});
			session.discovery = { generation, status: "loading", task };
			refresh();
			return task;
		};
		session.retryRestoration = restore;
		restore();
		// A drop can finish saving after the loading composer unmounts. The ready
		// owner must adopt that draft too, using the same file/publication identity.
		const unsubscribe = subscribeComposerFileDrafts((scope, kind) => {
			if (scopes.includes(scope)) {
				if (kind === "cleanup") {
					refresh();
				} else {
					restore();
				}
			}
		});
		return () => {
			disposed = true;
			session.discovery = {
				generation: session.discovery.generation + 1,
				status: "not_started",
			};
			if (session.retryRestoration === restore) {
				session.retryRestoration = null;
			}
			unsubscribe();
		};
	}, [scopeKey, migrationScopesKey, addFiles, session]);

	const beginSubmission = useCallback(
		(ids?: readonly string[]) => {
			assertComposerFileDiscoveryReady(session.discovery);
			const submitted = session.files.filter((file) =>
				ids
					? ids.includes(file.localId)
					: !session.submittingIds.has(file.localId)
			);
			for (const file of submitted) {
				session.submittingIds.add(file.localId);
			}
			refresh();
			return submitted;
		},
		[session]
	);
	const finishSubmission = useCallback(
		(submitted: readonly SpaceComposerFile[]) => {
			for (const file of submitted) {
				session.submittingIds.delete(file.localId);
				session.uploadTasks.delete(file.localId);
			}
			refresh();
		},
		[session]
	);

	const publishReadyFiles = useCallback(
		async (submitted: readonly SpaceComposerFile[]) => {
			await Promise.all(
				submitted.map((file) => session.uploadTasks.get(file.localId))
			);
			await Promise.all(
				submitted.map((file) => {
					const current = session.files.find(
						(item) => item.localId === file.localId
					);
					if (current?.status === "failed") {
						return startOrJoinFilePreparation(file.localId, true);
					}
					return Promise.resolve();
				})
			);
			const readyFiles = submitted.map((submittedFile) =>
				session.files.find((file) => file.localId === submittedFile.localId)
			);
			if (
				readyFiles.some(
					(file) =>
						file?.status !== "ready" ||
						file.failurePhase !== null ||
						!file.upload ||
						!session.activeFileIds.has(file.localId) ||
						session.retiredFileIds.has(file.localId) ||
						isComposerFileDraftRetired(file.localId)
				)
			) {
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
				const bytes = session.sourceFiles.get(result.localId);
				if (bytes) {
					seedPublishedSpaceFileMedia({
						...result.file,
						bytes,
						localId: result.localId,
						previewUrl: result.previewUrl,
						queryClient,
						spaceId: session.scope.spaceId,
					});
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
			queryClient,
			session,
			startOrJoinFilePreparation,
			updateFiles,
		]
	);

	const retryFile = useCallback(
		async (localId: string) => {
			const file = session.files.find((item) => item.localId === localId);
			if (!file || file.failurePhase === "validation") {
				return;
			}
			await startOrJoinFilePreparation(localId);
		},
		[session, startOrJoinFilePreparation]
	);

	const assertDiscoveryReady = useCallback(() => {
		assertComposerFileDiscoveryReady(session.discovery);
	}, [session]);
	const waitForDiscovery = useCallback(async () => {
		const discovery = session.discovery;
		if (discovery.status === "loading") {
			await discovery.task;
		}
		assertComposerFileDiscoveryReady(session.discovery);
	}, [session]);
	const preflightSubmission = useCallback(
		(ids?: readonly string[]) => {
			assertDiscoveryReady();
			const candidates = session.files.filter((file) =>
				ids
					? ids.includes(file.localId)
					: !session.submittingIds.has(file.localId)
			);
			const unavailable = candidates.find(
				(item) =>
					item.status === "failed" ||
					item.failurePhase !== null ||
					!session.sourceFiles.has(item.localId)
			);
			if (unavailable) {
				throw new Error(
					"Couldn't save your attachments. Retry or remove them to continue."
				);
			}
			return candidates;
		},
		[assertDiscoveryReady, session]
	);
	const claimSubmissionFiles = useCallback(() => {
		const candidates = preflightSubmission();
		beginSubmission(candidates.map((item) => item.localId));
		return candidates;
	}, [beginSubmission, preflightSubmission]);

	const retryCleanup = useCallback(
		async (localId: string) => {
			if (
				!readComposerFileDraftCleanup(scopeKey).some(
					(item) => item.id === localId
				)
			) {
				return;
			}
			const existing = session.cleanupTasks.get(localId);
			if (existing) {
				await existing;
				return;
			}
			const task = retryComposerFileDraftCleanup(localId).catch((error) => {
				console.error("Could not retry attachment cleanup", { error, localId });
			});
			session.cleanupTasks.set(localId, task);
			try {
				await task;
			} finally {
				if (session.cleanupTasks.get(localId) === task) {
					session.cleanupTasks.delete(localId);
				}
			}
		},
		[scopeKey, session]
	);

	return {
		addFiles,
		claimSubmissionDrafts: (): ComposerFileSelection[] => {
			const candidates = preflightSubmission();
			const selections = candidates.map((item) => {
				const file = session.sourceFiles.get(item.localId);
				if (!file) {
					throw new Error("The selected attachment is no longer available.");
				}
				return {
					id: item.localId,
					file,
					publishMutationId: item.publishMutationId,
					upload: item.upload ?? undefined,
				};
			});
			beginSubmission(candidates.map((item) => item.localId));
			return selections;
		},
		getSubmissionFiles: (input: {
			ids?: readonly string[];
			sources?: readonly File[];
		}) =>
			session.files.filter((file) =>
				input.ids
					? input.ids.includes(file.localId)
					: input.sources?.some(
							(source) => source === session.sourceFiles.get(file.localId)
						)
			),
		getSourceFiles: () =>
			session.files.flatMap((file) => {
				const source = session.sourceFiles.get(file.localId);
				return source ? [source] : [];
			}),
		readFileDrafts: async () => {
			const discovery = session.discovery;
			if (discovery.status === "loading") {
				await discovery.task;
			}
			assertDiscoveryReady();
			const selectedIds = [...session.activeFileIds];
			if (selectedIds.length === 0) {
				return [];
			}
			await Promise.all(selectedIds.map((id) => session.uploadTasks.get(id)));
			let drafts: ComposerFileDraft[];
			try {
				drafts = await readComposerFileDraftsByIds(selectedIds);
			} catch (error) {
				throw new ComposerFileDiscoveryError(error);
			}
			const selected = drafts.filter((draft) =>
				session.activeFileIds.has(draft.id)
			);
			if (selected.length !== selectedIds.length) {
				throw new Error(
					"Couldn't save your attachments. Remove them and add them again."
				);
			}
			return selected;
		},
		beginSubmission,
		// Fresh mutation callers claim the current session batch after discovery.
		// Captured send retries continue to use their already-owned snapshot.
		claimSubmissionFiles,
		preflightSubmission,
		waitForDiscovery,
		finishSubmission,
		clearFiles,
		consumePublishedFiles,
		files: session.files.filter(
			(file) => !session.submittingIds.has(file.localId)
		),
		isAtLimit:
			session.files.filter((file) => !session.submittingIds.has(file.localId))
				.length >= SPACE_MESSAGE_FILE_MAX_COUNT,
		publishReadyFiles,
		cleanup: readComposerFileDraftCleanup(scopeKey),
		restorationError:
			session.discovery.status === "failed" ? session.discovery.error : null,
		removeFile,
		retryCleanup,
		retryFile,
		retryRestoration: () => session.retryRestoration?.(),
	};
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: preparation is one ordered persistence/staging transaction with phase-specific recovery.
async function preparePendingFile(input: {
	deferUpload?: boolean;
	draftScopeKey: string;
	controllers: Map<string, AbortController>;
	activeFileIds: Set<string>;
	file: File;
	item: SpaceComposerFile;
	organizationSlug?: string;
	profileId: string;
	retiredFileIds: Set<string>;
	setFiles: Dispatch<SetStateAction<SpaceComposerFile[]>>;
	spaceId: string;
}): Promise<void> {
	const controller = new AbortController();
	input.controllers.set(input.item.localId, controller);
	let phase: ComposerFileFailurePhase = "validation";
	try {
		updateFile(input.setFiles, input.item.localId, (current) => ({
			...current,
			errorMessage: null,
			errorRequestId: null,
			status: "uploading",
		}));
		if (input.file.size > SPACE_FILE_MAX_SIZE_BYTES) {
			throw new Error(formatSpaceFileSizeLimitError(input.item.fileName));
		}
		if (
			input.item.mimeType.startsWith("image/") &&
			!input.item.imageDimensions
		) {
			const imageDimensions = await readDisplayImageDimensions({
				size: input.file.size,
				read: async (offset, length) => {
					controller.signal.throwIfAborted();
					return new Uint8Array(
						await input.file.slice(offset, offset + length).arrayBuffer()
					);
				},
			});
			if (imageDimensions) {
				updateFile(input.setFiles, input.item.localId, (current) => ({
					...current,
					imageDimensions,
				}));
			}
		}
		const currentBeforePersistence = input.item;
		if (currentBeforePersistence.failurePhase !== "persist-upload") {
			phase = "persist-draft";
			await saveComposerFileDraft({
				id: input.item.localId,
				scope: input.draftScopeKey,
				file: input.file,
				publishMutationId: input.item.publishMutationId,
			});
		}
		if (
			!input.activeFileIds.has(input.item.localId) ||
			input.retiredFileIds.has(input.item.localId) ||
			isComposerFileDraftRetired(input.item.localId)
		) {
			return;
		}
		if (input.deferUpload) {
			updateFile(input.setFiles, input.item.localId, (current) => ({
				...current,
				errorMessage: null,
				errorRequestId: null,
				failurePhase: null,
				status: "ready",
				progress: 100,
			}));
			return;
		}
		let upload = currentBeforePersistence.upload;
		if (
			upload &&
			!currentBeforePersistence.publicationAttempted &&
			!isComposerUploadDescriptorValid(upload, input.item.localId)
		) {
			phase = "stage";
			const api = createUnscopedWebSpaceApi({
				openMeldProfileId: input.profileId,
			});
			await api.discardComposerUpload({
				spaceId: input.spaceId,
				uploadId: upload.id,
			});
			upload = null;
			updateFile(input.setFiles, input.item.localId, (current) => ({
				...current,
				upload: null,
			}));
		}
		if (!upload) {
			phase = "stage";
			const api = createUnscopedWebSpaceApi({
				openMeldProfileId: input.profileId,
			});
			upload = await runSpaceComposerIdempotentRequestWithRetry(
				async () =>
					await api.stageComposerUpload({
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
					})
			);
			updateFile(input.setFiles, input.item.localId, (current) => ({
				...current,
				upload,
			}));
			if (!isComposerUploadDescriptorValid(upload, input.item.localId)) {
				throw new Error(
					"The attachment upload is still expired. Try again later."
				);
			}
		}
		if (!input.activeFileIds.has(input.item.localId)) {
			discardComposerUploadIds({
				organizationSlug: input.organizationSlug,
				profileId: input.profileId,
				spaceId: input.spaceId,
				uploadIds: [upload.id],
			});
			return;
		}
		phase = "persist-upload";
		await saveComposerFileDraftUpload(input.item.localId, upload);
		if (
			!input.activeFileIds.has(input.item.localId) ||
			input.retiredFileIds.has(input.item.localId) ||
			isComposerFileDraftRetired(input.item.localId)
		) {
			return;
		}
		updateFile(input.setFiles, input.item.localId, (current) => ({
			...current,
			errorMessage: null,
			errorRequestId: null,
			failurePhase: null,
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
		const failure =
			phase === "persist-draft" || phase === "persist-upload"
				? {
						message: "Couldn't save this attachment on this device. Try again.",
						requestId: null,
					}
				: resolveUploadFailure(error);
		updateFile(input.setFiles, input.item.localId, (current) => ({
			...current,
			errorMessage: failure.message,
			errorRequestId: failure.requestId,
			failurePhase: phase,
			progress: 100,
			status: "failed",
			upload: current.upload,
		}));
	} finally {
		if (input.controllers.get(input.item.localId) === controller) {
			input.controllers.delete(input.item.localId);
		}
	}
}

function removeFileDraft(
	id: string,
	session: ReturnType<typeof createFileSession>,
	reason: "removed" | "sent"
) {
	const file = session.files.find((item) => item.localId === id);
	removeComposerFileDraft(id, {
		fileName: file?.fileName ?? "Untitled file",
		reason,
		scope:
			session.scope.storageKey ??
			`${session.scope.organizationSlug}:${session.scope.profileId}:${session.scope.spaceId}${session.scope.draftScope ? `:${session.scope.draftScope}` : ""}`,
	}).catch((error) =>
		console.error("Could not remove attachment draft", { id, error })
	);
}

function toMessageFileReference(descriptor: {
	id: string;
	latestRevision: {
		mimeType: string;
		revision: number;
		sizeBytes: number;
		imageDimensions?: SpaceFileImageDimensions;
	};
	name: string;
}): SpaceMessageFileReference {
	return {
		fileId: descriptor.id,
		mimeType: descriptor.latestRevision.mimeType,
		name: descriptor.name,
		revision: descriptor.latestRevision.revision,
		sizeBytes: descriptor.latestRevision.sizeBytes,
		...(descriptor.latestRevision.imageDimensions
			? { imageDimensions: descriptor.latestRevision.imageDimensions }
			: {}),
	};
}

async function publishPendingFile(input: {
	file: SpaceComposerFile;
	organizationSlug?: string;
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
		if (
			!(
				input.file.publicationAttempted ||
				isComposerUploadDescriptorValid(upload, input.file.localId)
			)
		) {
			throw new Error(
				"This attachment upload expired. Retry to prepare it again."
			);
		}
		updateFile(input.setFiles, input.file.localId, (current) => ({
			...current,
			publicationAttempted: true,
		}));
		const api = createUnscopedWebSpaceApi({
			openMeldProfileId: input.profileId,
		});
		const descriptor = await runSpaceComposerIdempotentRequestWithRetry(
			async () =>
				await api.publishComposerUpload({
					clientMutationId: input.file.publishMutationId,
					spaceId: input.spaceId,
					timeoutMs: SPACE_COMPOSER_FILE_PUBLISH_TIMEOUT_MS,
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
		const uploadUnavailable = isAuthoritativeComposerUploadUnavailable(error);
		updateFile(input.setFiles, input.file.localId, (current) => ({
			...current,
			errorMessage: failure.message,
			errorRequestId: failure.requestId,
			failurePhase: "publish",
			progress: 100,
			status: "failed",
			publicationAttempted: uploadUnavailable
				? false
				: current.publicationAttempted,
			upload: uploadUnavailable ? null : current.upload,
		}));
		return null;
	}
}

function isComposerUploadDescriptorValid(
	upload: SpaceComposerUploadDescriptor,
	localId: string
): boolean {
	const expiresAtMs = Date.parse(upload.expiresAt);
	return (
		upload.id === localId.replace("composer-file:", "") &&
		Number.isFinite(expiresAtMs) &&
		expiresAtMs > Date.now()
	);
}

function isAuthoritativeComposerUploadUnavailable(error: unknown): boolean {
	const failure = toStructuredApiClientFailure(error);
	return (
		failure.status === 404 && failure.upstreamCode === "space_file.not_found"
	);
}

function discardStagedFiles(input: {
	files: readonly SpaceComposerFile[];
	organizationSlug?: string;
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
	organizationSlug?: string;
	profileId: string;
	spaceId: string;
	uploadIds: readonly string[];
}): void {
	if (input.uploadIds.length === 0) {
		return;
	}
	const api = createUnscopedWebSpaceApi({
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
