import type { SpaceComposerUploadDescriptor } from "@openmeld/schemas/types";

export type ComposerFileDraft = {
	id: string;
	scope: string;
	file: File;
	publishMutationId: string;
	expiresAt: number;
	createdAt?: number;
	upload?: SpaceComposerUploadDescriptor;
};

let database: Promise<IDBDatabase> | undefined;
// File batches can be added within one millisecond; preserve selection order.
let lastCreatedAt = 0;
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

export async function saveComposerFileDraft(
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
}

// Update only an existing draft: a late upload completion must never recreate
// a file the user removed or already sent.
export async function saveComposerFileDraftUpload(
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

export async function removeComposerFileDraft(id: string) {
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
	await Promise.all(
		drafts
			.filter((d) => d.expiresAt <= Date.now())
			.map((d) => removeComposerFileDraft(d.id))
	);
	return drafts
		.filter((d) => d.expiresAt > Date.now())
		.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}
