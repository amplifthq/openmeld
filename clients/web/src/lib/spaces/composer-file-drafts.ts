import type { SpaceComposerUploadDescriptor } from "@openmeld/schemas/types";
import { registerClientVersionRecoveryBlocker } from "#/client-version-recovery";

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

let database: Promise<IDBDatabase> | undefined;
// File batches can be added within one millisecond; preserve selection order.
let lastCreatedAt = 0;
const draftListeners = new Set<(scope: string) => void>();
export function subscribeComposerFileDrafts(listener: (scope: string) => void) {
	draftListeners.add(listener);
	return () => {
		draftListeners.delete(listener);
	};
}
function openDatabase() {
	database ??= new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open("openmeld-composer-files", 1);
		request.onupgradeneeded = () => {
			request.result
				.createObjectStore("files", { keyPath: "id" })
				.createIndex("scope", "scope");
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	return database;
}

async function writeComposerFileDraft(
	input: Omit<ComposerFileDraft, "expiresAt" | "createdAt">
) {
	const createdAt = Math.max(Date.now(), lastCreatedAt + 1);
	lastCreatedAt = createdAt;
	const db = await openDatabase();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction("files", "readwrite");
		const store = tx.objectStore("files");
		const existing = store.get(input.id);
		existing.onsuccess = () => {
			store.put({
				...input,
				createdAt: existing.result?.createdAt ?? createdAt,
				expiresAt:
					existing.result?.expiresAt ?? Date.now() + 24 * 60 * 60 * 1000,
			});
		};
		tx.oncomplete = () => resolve();
		tx.onabort = () => reject(tx.error);
		tx.onerror = () => reject(tx.error);
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
	const db = await openDatabase();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction("files", "readwrite");
		const store = tx.objectStore("files");
		const request = store.get(id);
		request.onsuccess = () => {
			if (request.result) {
				store.put({ ...request.result, upload });
			}
		};
		tx.oncomplete = () => resolve();
		tx.onabort = () => reject(tx.error);
		tx.onerror = () => reject(tx.error);
	});
}

async function deleteComposerFileDraft(id: string) {
	const db = await openDatabase();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction("files", "readwrite");
		tx.objectStore("files").delete(id);
		tx.oncomplete = () => resolve();
		tx.onabort = () => reject(tx.error);
		tx.onerror = () => reject(tx.error);
	});
}

export async function readComposerFileDrafts(
	scope: string
): Promise<ComposerFileDraft[]> {
	const db = await openDatabase();
	const drafts = await new Promise<ComposerFileDraft[]>((resolve, reject) => {
		const request = db
			.transaction("files")
			.objectStore("files")
			.index("scope")
			.getAll(scope);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	return retainCurrentDrafts(drafts);
}

// An in-flight send keeps attachment IDs while its route hands storage ownership
// to the ready conversation. Read those same files even after their scope moves.
export async function readComposerFileDraftsByIds(
	ids: readonly string[]
): Promise<ComposerFileDraft[]> {
	const db = await openDatabase();
	const store = db.transaction("files").objectStore("files");
	const drafts = await Promise.all(
		ids.map(
			(id) =>
				new Promise<ComposerFileDraft | undefined>((resolve, reject) => {
					const request = store.get(id);
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				})
		)
	);
	return retainCurrentDrafts(drafts.filter((draft) => draft !== undefined));
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
