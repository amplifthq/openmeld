type FileDraft = {
	id: string;
	scope: string;
	file: File;
	publishMutationId: string;
	expiresAt: number;
};

let database: Promise<IDBDatabase> | undefined;
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
	input: Omit<FileDraft, "expiresAt">
) {
	const db = await openDatabase();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction("files", "readwrite");
		tx.objectStore("files").put({
			...input,
			expiresAt: Date.now() + 24 * 60 * 60 * 1000,
		});
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
): Promise<FileDraft[]> {
	const db = await openDatabase();
	const drafts = await new Promise<FileDraft[]>((resolve, reject) => {
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
	return drafts.filter((d) => d.expiresAt > Date.now());
}
