const COMPOSER_FILE_DRAFT_DATABASE_NAME = "openmeld-composer-files";
const COMPOSER_FILE_DRAFT_DATABASE_VERSION = 1;
const COMPOSER_FILE_DRAFT_STORE_NAME = "files";

export const COMPOSER_FILE_DRAFT_OPEN_TIMEOUT_MS = 5000;

type OpeningEntry = {
	kind: "opening";
	promise: Promise<IDBDatabase>;
	reject: (error: unknown) => void;
	request: IDBOpenDBRequest | null;
	timedOut: boolean;
	timer: ReturnType<typeof setTimeout> | null;
};

type ReadyEntry = {
	kind: "ready";
	database: IDBDatabase;
};

type DatabaseEntry = OpeningEntry | ReadyEntry;

let currentEntry: DatabaseEntry | undefined;

export class ComposerFileDraftDatabaseError extends Error {
	readonly phase: "open" | "open-timeout" | "transaction";

	constructor(
		message: string,
		phase: ComposerFileDraftDatabaseError["phase"],
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = "ComposerFileDraftDatabaseError";
		this.phase = phase;
	}
}

function toDatabaseError(
	message: string,
	phase: ComposerFileDraftDatabaseError["phase"],
	cause: unknown
) {
	return new ComposerFileDraftDatabaseError(message, phase, { cause });
}

function clearOpeningTimer(entry: OpeningEntry) {
	if (entry.timer !== null) {
		clearTimeout(entry.timer);
		entry.timer = null;
	}
}

function invalidateReadyEntry(entry: ReadyEntry, close: boolean) {
	if (currentEntry === entry) {
		currentEntry = undefined;
	}
	if (close) {
		entry.database.close();
	}
}

function installReadyEntry(database: IDBDatabase): ReadyEntry {
	const entry: ReadyEntry = { kind: "ready", database };
	database.addEventListener("close", () => invalidateReadyEntry(entry, false));
	database.addEventListener("versionchange", () =>
		invalidateReadyEntry(entry, true)
	);
	return entry;
}

function openComposerFileDraftDatabase(): Promise<IDBDatabase> {
	if (currentEntry?.kind === "ready") {
		return Promise.resolve(currentEntry.database);
	}
	if (currentEntry?.kind === "opening") {
		return currentEntry.promise;
	}

	let resolveOpening!: (database: IDBDatabase) => void;
	let rejectOpening!: (error: unknown) => void;
	const promise = new Promise<IDBDatabase>((resolve, reject) => {
		resolveOpening = resolve;
		rejectOpening = reject;
	});
	const entry: OpeningEntry = {
		kind: "opening",
		promise,
		reject: rejectOpening,
		request: null,
		timedOut: false,
		timer: null,
	};
	currentEntry = entry;

	let request: IDBOpenDBRequest;
	try {
		request = indexedDB.open(
			COMPOSER_FILE_DRAFT_DATABASE_NAME,
			COMPOSER_FILE_DRAFT_DATABASE_VERSION
		);
		entry.request = request;
	} catch (error) {
		if (currentEntry === entry) {
			currentEntry = undefined;
		}
		rejectOpening(
			toDatabaseError("Could not open attachment draft storage.", "open", error)
		);
		return promise;
	}

	entry.timer = setTimeout(() => {
		if (currentEntry !== entry || entry.timedOut) {
			return;
		}
		entry.timedOut = true;
		entry.reject(
			new ComposerFileDraftDatabaseError(
				"Attachment draft storage took too long to open.",
				"open-timeout"
			)
		);
	}, COMPOSER_FILE_DRAFT_OPEN_TIMEOUT_MS);

	request.onblocked = () => {
		// The shared deadline owns the user-visible outcome. The native request
		// remains the single in-flight request until it eventually settles.
	};
	request.onupgradeneeded = () => {
		if (entry.timedOut || currentEntry !== entry) {
			request.transaction?.abort();
			return;
		}
		request.result
			.createObjectStore(COMPOSER_FILE_DRAFT_STORE_NAME, { keyPath: "id" })
			.createIndex("scope", "scope");
	};
	request.onsuccess = () => {
		clearOpeningTimer(entry);
		if (entry.timedOut || currentEntry !== entry) {
			request.result.close();
			if (currentEntry === entry) {
				currentEntry = undefined;
			}
			return;
		}
		const readyEntry = installReadyEntry(request.result);
		currentEntry = readyEntry;
		resolveOpening(request.result);
	};
	request.onerror = () => {
		clearOpeningTimer(entry);
		if (currentEntry === entry) {
			currentEntry = undefined;
		}
		if (!entry.timedOut) {
			rejectOpening(
				toDatabaseError(
					"Could not open attachment draft storage.",
					"open",
					request.error
				)
			);
		}
	};

	return promise;
}

function isInvalidConnectionState(error: unknown): boolean {
	return error instanceof DOMException && error.name === "InvalidStateError";
}

function createTransaction(
	database: IDBDatabase,
	mode: IDBTransactionMode
): IDBTransaction {
	return database.transaction(COMPOSER_FILE_DRAFT_STORE_NAME, mode);
}

export async function runComposerFileDraftTransaction<T>(
	mode: "readonly" | "readwrite",
	enqueue: (store: IDBObjectStore, result: { set(value: T): void }) => void
): Promise<T> {
	let transaction: IDBTransaction | undefined;
	for (let attempt = 0; attempt < 2; attempt++) {
		const database = await openComposerFileDraftDatabase();
		try {
			transaction = createTransaction(database, mode);
			break;
		} catch (error) {
			if (attempt === 0 && isInvalidConnectionState(error)) {
				if (
					currentEntry?.kind === "ready" &&
					currentEntry.database === database
				) {
					invalidateReadyEntry(currentEntry, true);
				}
				continue;
			}
			throw toDatabaseError(
				"Could not start an attachment draft transaction.",
				"transaction",
				error
			);
		}
	}
	if (!transaction) {
		throw new ComposerFileDraftDatabaseError(
			"Could not start an attachment draft transaction.",
			"transaction"
		);
	}

	return await new Promise<T>((resolve, reject) => {
		let result: T;
		let operationError: unknown;
		transaction.oncomplete = () => resolve(result);
		transaction.onabort = () =>
			reject(
				toDatabaseError(
					"Attachment draft transaction was aborted.",
					"transaction",
					transaction.error ?? operationError
				)
			);
		transaction.onerror = () => {
			operationError ??= transaction.error;
		};
		try {
			enqueue(transaction.objectStore(COMPOSER_FILE_DRAFT_STORE_NAME), {
				set(value) {
					result = value;
				},
			});
		} catch (error) {
			operationError = error;
			try {
				transaction.abort();
			} catch {
				reject(
					toDatabaseError(
						"Could not enqueue an attachment draft operation.",
						"transaction",
						error
					)
				);
			}
		}
	});
}
