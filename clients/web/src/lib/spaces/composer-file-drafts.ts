import type { SpaceComposerUploadDescriptor } from "@openmeld/schemas/types";
import { registerClientVersionRecoveryBlocker } from "#/client-version-recovery";
import { runComposerFileDraftTransaction } from "./composer-file-draft-database";

const COMPOSER_FILE_DRAFT_LIFETIME_MS = 24 * 60 * 60 * 1000;

type MutationKind = "draft" | "upload" | "delete";
type WriteFailure = { error: unknown; revision: number };
type FirstAdmission = { createdAt: number; expiresAt: number };
type Retirement = { expiresAt: number; revision: number };

export type ComposerFileDraftCleanupReason = "removed" | "sent" | "expired";
export type ComposerFileDraftCleanup = {
	error: unknown | null;
	fileName: string;
	id: string;
	reason: ComposerFileDraftCleanupReason;
	revision: number;
	scope: string;
	status: "pending" | "failed";
};

export type ComposerFileDraft = {
	id: string;
	scope: string;
	file: File;
	publishMutationId: string;
	expiresAt: number;
	createdAt?: number;
	upload?: SpaceComposerUploadDescriptor;
};

export type ComposerFileSelection = Pick<
	ComposerFileDraft,
	"id" | "file" | "publishMutationId" | "upload"
>;

let pendingWrites = 0;
let nextOperationRevision = 0;
// File batches can be added within one millisecond; preserve selection order.
let lastCreatedAt = 0;
const failedWrites = new Map<string, Map<MutationKind, WriteFailure>>();
const mutationTails = new Map<string, Promise<void>>();
const firstAdmissions = new Map<string, FirstAdmission>();
const retirements = new Map<string, Retirement>();
const cleanupById = new Map<string, ComposerFileDraftCleanup>();
export type ComposerFileDraftChangeKind = "cleanup" | "draft";
const draftListeners = new Set<
	(scope: string, kind: ComposerFileDraftChangeKind) => void
>();

registerClientVersionRecoveryBlocker(
	() => pendingWrites > 0 || failedWrites.size > 0 || cleanupById.size > 0
);

export function subscribeComposerFileDrafts(
	listener: (scope: string, kind: ComposerFileDraftChangeKind) => void
) {
	draftListeners.add(listener);
	return () => {
		draftListeners.delete(listener);
	};
}

function notifyDraftListeners(
	scope: string,
	kind: ComposerFileDraftChangeKind
) {
	for (const listener of draftListeners) {
		try {
			listener(scope, kind);
		} catch (error) {
			console.error("Could not notify an attachment draft subscriber", {
				error,
				scope,
			});
		}
	}
}

function pruneRetirements() {
	const now = Date.now();
	for (const [id, retirement] of retirements) {
		if (
			retirement.expiresAt <= now &&
			!mutationTails.has(id) &&
			!cleanupById.has(id)
		) {
			retirements.delete(id);
		}
	}
}

function setWriteFailure(
	id: string,
	kind: MutationKind,
	revision: number,
	error: unknown
) {
	let reasons = failedWrites.get(id);
	if (!reasons) {
		reasons = new Map();
		failedWrites.set(id, reasons);
	}
	reasons.set(kind, { error, revision });
}

function resolveWriteFailure(id: string, kind: MutationKind, revision: number) {
	const reasons = failedWrites.get(id);
	const reason = reasons?.get(kind);
	if (!reason || reason.revision > revision) {
		return;
	}
	reasons?.delete(kind);
	if (reasons?.size === 0) {
		failedWrites.delete(id);
	}
}

function enqueueFileMutation<T>(input: {
	id: string;
	kind: MutationKind;
	run: (revision: number) => Promise<T>;
	onCommitted?: (result: T, revision: number) => void;
	onFailed?: (error: unknown, revision: number) => void;
}): Promise<T> {
	const revision = ++nextOperationRevision;
	pendingWrites++;
	const previous = mutationTails.get(input.id) ?? Promise.resolve();
	const operation = previous
		.catch(() => undefined)
		.then(async () => {
			try {
				const result = await input.run(revision);
				input.onCommitted?.(result, revision);
				return result;
			} catch (error) {
				setWriteFailure(input.id, input.kind, revision, error);
				input.onFailed?.(error, revision);
				throw error;
			}
		});
	const settledTail = operation.then(
		() => undefined,
		() => undefined
	);
	mutationTails.set(input.id, settledTail);
	const finish = () => {
		pendingWrites--;
		if (mutationTails.get(input.id) === settledTail) {
			mutationTails.delete(input.id);
		}
		pruneRetirements();
	};
	operation.then(finish, finish);
	return operation;
}

function getFirstAdmission(id: string): FirstAdmission {
	let admission = firstAdmissions.get(id);
	if (!admission) {
		const createdAt = Math.max(Date.now(), lastCreatedAt + 1);
		lastCreatedAt = createdAt;
		admission = {
			createdAt,
			expiresAt: Date.now() + COMPOSER_FILE_DRAFT_LIFETIME_MS,
		};
		firstAdmissions.set(id, admission);
	}
	return admission;
}

async function writeDraft(
	input: Omit<ComposerFileDraft, "expiresAt" | "createdAt">,
	admission: FirstAdmission
) {
	await runComposerFileDraftTransaction<void>("readwrite", (store) => {
		const existing = store.get(input.id);
		existing.onsuccess = () => {
			store.put({
				...input,
				createdAt: existing.result?.createdAt ?? admission.createdAt,
				expiresAt: existing.result?.expiresAt ?? admission.expiresAt,
			});
		};
	});
}

async function writeUpload(
	id: string,
	upload: SpaceComposerUploadDescriptor
): Promise<"written" | "missing"> {
	return await runComposerFileDraftTransaction<"written" | "missing">(
		"readwrite",
		(store, result) => {
			const request = store.get(id);
			request.onsuccess = () => {
				if (!request.result) {
					result.set("missing");
					return;
				}
				store.put({ ...request.result, upload });
				result.set("written");
			};
		}
	);
}

async function deleteDraft(id: string) {
	await runComposerFileDraftTransaction<void>("readwrite", (store) => {
		store.delete(id);
	});
}

export async function readComposerFileDrafts(
	scope: string
): Promise<ComposerFileDraft[]> {
	pruneRetirements();
	const drafts = await runComposerFileDraftTransaction<ComposerFileDraft[]>(
		"readonly",
		(store, result) => {
			const request = store.index("scope").getAll(scope);
			request.onsuccess = () => result.set(request.result);
		}
	);
	return retainCurrentDrafts(
		drafts.filter((draft) => !retirements.has(draft.id))
	);
}

// An in-flight send keeps attachment IDs while its route hands storage ownership
// to the ready conversation. Read those same files even after their scope moves.
export async function readComposerFileDraftsByIds(
	ids: readonly string[]
): Promise<ComposerFileDraft[]> {
	pruneRetirements();
	const readableIds = ids.filter((id) => !retirements.has(id));
	const drafts = await runComposerFileDraftTransaction<ComposerFileDraft[]>(
		"readonly",
		(store, result) => {
			const selected: (ComposerFileDraft | undefined)[] = new Array(
				readableIds.length
			);
			let remaining = readableIds.length;
			if (remaining === 0) {
				result.set([]);
				return;
			}
			readableIds.forEach((id, index) => {
				const request = store.get(id);
				request.onsuccess = () => {
					selected[index] = request.result;
					remaining--;
					if (remaining === 0) {
						result.set(selected.filter((draft) => draft !== undefined));
					}
				};
			});
		}
	);
	return retainCurrentDrafts(drafts);
}

function retainCurrentDrafts(drafts: ComposerFileDraft[]) {
	for (const draft of drafts.filter((item) => item.expiresAt <= Date.now())) {
		removeComposerFileDraft(draft.id, {
			fileName: draft.file.name || "Untitled file",
			reason: "expired",
			scope: draft.scope,
		}).catch((error) =>
			console.error("Could not remove expired attachment draft", {
				error,
				id: draft.id,
			})
		);
	}
	return drafts
		.filter(
			(draft) => draft.expiresAt > Date.now() && !retirements.has(draft.id)
		)
		.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export function saveComposerFileDraft(
	input: Omit<ComposerFileDraft, "expiresAt" | "createdAt">
) {
	if (retirements.has(input.id)) {
		return Promise.resolve();
	}
	const admission = getFirstAdmission(input.id);
	return enqueueFileMutation({
		id: input.id,
		kind: "draft",
		run: async () => await writeDraft(input, admission),
		onCommitted: (_result, revision) => {
			resolveWriteFailure(input.id, "draft", revision);
			firstAdmissions.delete(input.id);
			notifyDraftListeners(input.scope, "draft");
		},
	});
}

export function saveComposerFileDraftUpload(
	id: string,
	upload: SpaceComposerUploadDescriptor
): Promise<void> {
	if (retirements.has(id)) {
		return Promise.resolve();
	}
	return enqueueFileMutation({
		id,
		kind: "upload",
		run: async () => await writeUpload(id, upload),
		onCommitted: (outcome, revision) => {
			if (outcome === "missing") {
				throw new Error("The attachment draft no longer exists.");
			}
			resolveWriteFailure(id, "upload", revision);
		},
	}).then(() => undefined);
}

export function removeComposerFileDraft(
	id: string,
	cleanup?: {
		fileName: string;
		reason: ComposerFileDraftCleanupReason;
		scope: string;
	}
): Promise<void> {
	const revision = nextOperationRevision + 1;
	const admission = firstAdmissions.get(id);
	retirements.set(id, {
		expiresAt:
			admission?.expiresAt ?? Date.now() + COMPOSER_FILE_DRAFT_LIFETIME_MS,
		revision,
	});
	if (cleanup) {
		cleanupById.set(id, {
			...cleanup,
			error: null,
			id,
			revision,
			status: "pending",
		});
		notifyDraftListeners(cleanup.scope, "cleanup");
	}
	return enqueueFileMutation({
		id,
		kind: "delete",
		run: async () => await deleteDraft(id),
		onCommitted: (_result, committedRevision) => {
			failedWrites.delete(id);
			firstAdmissions.delete(id);
			const cleanupState = cleanupById.get(id);
			if (cleanupState && cleanupState.revision <= committedRevision) {
				cleanupById.delete(id);
				notifyDraftListeners(cleanupState.scope, "cleanup");
			}
		},
		onFailed: (error, failedRevision) => {
			const cleanupState = cleanupById.get(id);
			if (cleanupState && cleanupState.revision <= failedRevision) {
				cleanupById.set(id, {
					...cleanupState,
					error,
					revision: failedRevision,
					status: "failed",
				});
				notifyDraftListeners(cleanupState.scope, "cleanup");
			}
		},
	});
}

export function readComposerFileDraftCleanup(
	scope: string
): ComposerFileDraftCleanup[] {
	pruneRetirements();
	return [...cleanupById.values()]
		.filter((cleanup) => cleanup.scope === scope)
		.sort((a, b) => a.revision - b.revision);
}

export function retryComposerFileDraftCleanup(id: string): Promise<void> {
	const cleanup = cleanupById.get(id);
	if (!cleanup) {
		return Promise.resolve();
	}
	return removeComposerFileDraft(id, {
		fileName: cleanup.fileName,
		reason: cleanup.reason,
		scope: cleanup.scope,
	});
}

export function isComposerFileDraftRetired(id: string): boolean {
	pruneRetirements();
	return retirements.has(id);
}
