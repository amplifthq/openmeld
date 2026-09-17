import type { SpaceComposerUploadDescriptor } from "@openmeld/schemas/types";
import { registerClientVersionRecoveryBlocker } from "#/client-version-recovery";
import { runComposerFileDraftTransaction } from "./composer-file-draft-database";

let pendingWrites = 0;
const failedWrites = new Set<string>();
registerClientVersionRecoveryBlocker(
	() => pendingWrites > 0 || failedWrites.size > 0
);
async function persistFileDraft(id: string, write: () => Promise<void>) {
	pendingWrites++;
	try {
		await write();
		failedWrites.delete(id);
	} catch (error) {
		failedWrites.add(id);
		throw error;
	} finally {
		pendingWrites--;
	}
}

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

// File batches can be added within one millisecond; preserve selection order.
let lastCreatedAt = 0;
const draftListeners = new Set<(scope: string) => void>();
export function subscribeComposerFileDrafts(listener: (scope: string) => void) {
	draftListeners.add(listener);
	return () => {
		draftListeners.delete(listener);
	};
}
async function writeComposerFileDraft(
	input: Omit<ComposerFileDraft, "expiresAt" | "createdAt">
) {
	const createdAt = Math.max(Date.now(), lastCreatedAt + 1);
	lastCreatedAt = createdAt;
	await runComposerFileDraftTransaction<void>("readwrite", (store) => {
		const existing = store.get(input.id);
		existing.onsuccess = () => {
			store.put({
				...input,
				createdAt: existing.result?.createdAt ?? createdAt,
				expiresAt:
					existing.result?.expiresAt ?? Date.now() + 24 * 60 * 60 * 1000,
			});
		};
	});
	for (const listener of draftListeners) {
		listener(input.scope);
	}
}

// Update only an existing draft: a late upload completion must never recreate
// a file the user removed or already sent.
async function writeComposerFileDraftUpload(
	id: string,
	upload: SpaceComposerUploadDescriptor
) {
	await runComposerFileDraftTransaction<void>("readwrite", (store) => {
		const request = store.get(id);
		request.onsuccess = () => {
			if (request.result) {
				store.put({ ...request.result, upload });
			}
		};
	});
}

async function deleteComposerFileDraft(id: string) {
	await runComposerFileDraftTransaction<void>("readwrite", (store) => {
		store.delete(id);
	});
}

export async function readComposerFileDrafts(
	scope: string
): Promise<ComposerFileDraft[]> {
	const drafts = await runComposerFileDraftTransaction<ComposerFileDraft[]>(
		"readonly",
		(store, result) => {
			const request = store.index("scope").getAll(scope);
			request.onsuccess = () => result.set(request.result);
		}
	);
	return retainCurrentDrafts(drafts);
}

// An in-flight send keeps attachment IDs while its route hands storage ownership
// to the ready conversation. Read those same files even after their scope moves.
export async function readComposerFileDraftsByIds(
	ids: readonly string[]
): Promise<ComposerFileDraft[]> {
	const drafts = await runComposerFileDraftTransaction<ComposerFileDraft[]>(
		"readonly",
		(store, result) => {
			const selected: (ComposerFileDraft | undefined)[] = new Array(ids.length);
			let remaining = ids.length;
			if (remaining === 0) {
				result.set([]);
				return;
			}
			ids.forEach((id, index) => {
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

async function retainCurrentDrafts(drafts: ComposerFileDraft[]) {
	await Promise.all(
		drafts
			.filter((d) => d.expiresAt <= Date.now())
			.map((d) => removeComposerFileDraft(d.id))
	);
	return drafts
		.filter((d) => d.expiresAt > Date.now())
		.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export function saveComposerFileDraft(
	input: Omit<ComposerFileDraft, "expiresAt" | "createdAt">
) {
	return persistFileDraft(input.id, () => writeComposerFileDraft(input));
}
export function saveComposerFileDraftUpload(
	id: string,
	upload: SpaceComposerUploadDescriptor
) {
	return persistFileDraft(id, () => writeComposerFileDraftUpload(id, upload));
}
export function removeComposerFileDraft(id: string) {
	return persistFileDraft(id, () => deleteComposerFileDraft(id));
}
