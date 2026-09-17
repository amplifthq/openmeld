import "fake-indexeddb/auto";
import {
	forceCloseDatabase,
	IDBFactory,
	IDBVersionChangeEvent,
} from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("composer file draft database lifecycle", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.resetModules();
		Object.defineProperty(globalThis, "indexedDB", {
			configurable: true,
			value: new IDBFactory(),
		});
	});

	it.each([
		"synchronous",
		"asynchronous",
	] as const)("does not cache a %s open failure", async (failureKind) => {
		const factory = new IDBFactory();
		Object.defineProperty(globalThis, "indexedDB", {
			configurable: true,
			value: factory,
		});
		const originalOpen = factory.open.bind(factory);
		const open = vi.spyOn(factory, "open");
		if (failureKind === "synchronous") {
			open.mockImplementationOnce(() => {
				throw new DOMException("Storage unavailable", "UnknownError");
			});
		} else {
			open.mockImplementationOnce(() => {
				const request = {
					error: new DOMException("Storage unavailable", "UnknownError"),
					onblocked: null,
					onerror: null,
					onsuccess: null,
					onupgradeneeded: null,
				} as unknown as IDBOpenDBRequest;
				queueMicrotask(() => request.onerror?.(new Event("error")));
				return request;
			});
		}
		open.mockImplementation(originalOpen);
		const { runComposerFileDraftTransaction } = await import(
			"./composer-file-draft-database"
		);

		await expect(
			runComposerFileDraftTransaction("readonly", () => undefined)
		).rejects.toMatchObject({ phase: "open" });
		await expect(
			runComposerFileDraftTransaction("readonly", (_store, result) => {
				result.set("healthy");
			})
		).resolves.toBe("healthy");
		expect(open).toHaveBeenCalledTimes(2);
	});

	it.each([
		"abnormal close",
		"version change",
	] as const)("replaces the current handle after %s", async (eventKind) => {
		const factory = new IDBFactory();
		Object.defineProperty(globalThis, "indexedDB", {
			configurable: true,
			value: factory,
		});
		let database: IDBDatabase | undefined;
		const originalOpen = factory.open.bind(factory);
		const open = vi.spyOn(factory, "open").mockImplementation((...args) => {
			const request = originalOpen(...args);
			request.addEventListener("success", () => {
				database = request.result;
			});
			return request;
		});
		const { runComposerFileDraftTransaction } = await import(
			"./composer-file-draft-database"
		);
		await runComposerFileDraftTransaction("readonly", (_store, result) =>
			result.set("before")
		);
		expect(database).toBeDefined();
		if (eventKind === "abnormal close") {
			forceCloseDatabase(database as IDBDatabase);
		} else {
			database?.dispatchEvent(new IDBVersionChangeEvent("versionchange"));
		}

		await expect(
			runComposerFileDraftTransaction("readonly", (_store, result) =>
				result.set("after")
			)
		).resolves.toBe("after");
		expect(open).toHaveBeenCalledTimes(2);
	});

	it("shares one replacement open and retries only transaction creation", async () => {
		const factory = new IDBFactory();
		Object.defineProperty(globalThis, "indexedDB", {
			configurable: true,
			value: factory,
		});
		const { runComposerFileDraftTransaction } = await import(
			"./composer-file-draft-database"
		);
		await runComposerFileDraftTransaction("readonly", (_store, result) =>
			result.set("primed")
		);
		const open = vi.spyOn(factory, "open");
		const originalTransaction = IDBDatabase.prototype.transaction;
		const transaction = vi
			.spyOn(IDBDatabase.prototype, "transaction")
			.mockImplementationOnce(() => {
				throw new DOMException("Connection closing", "InvalidStateError");
			})
			.mockImplementation(function transactionAfterRecovery(
				this: IDBDatabase,
				...args: Parameters<IDBDatabase["transaction"]>
			) {
				return originalTransaction.call(this, ...args);
			});
		const operations = await Promise.all([
			runComposerFileDraftTransaction("readonly", (_store, result) =>
				result.set("one")
			),
			runComposerFileDraftTransaction("readonly", (_store, result) =>
				result.set("two")
			),
		]);
		expect(operations).toEqual(["one", "two"]);
		expect(open).toHaveBeenCalledTimes(1);
		expect(transaction).toHaveBeenCalledTimes(4);
	});

	it("stops after one replacement transaction-start retry", async () => {
		const { runComposerFileDraftTransaction } = await import(
			"./composer-file-draft-database"
		);
		await runComposerFileDraftTransaction("readonly", (_store, result) =>
			result.set("primed")
		);
		const transaction = vi
			.spyOn(IDBDatabase.prototype, "transaction")
			.mockImplementation(() => {
				throw new DOMException("Connection closing", "InvalidStateError");
			});
		await expect(
			runComposerFileDraftTransaction("readwrite", () => undefined)
		).rejects.toMatchObject({ phase: "transaction" });
		expect(transaction).toHaveBeenCalledTimes(2);
	});

	it("times out one native open and closes its late result before reopening", async () => {
		const factory = new IDBFactory();
		Object.defineProperty(globalThis, "indexedDB", {
			configurable: true,
			value: factory,
		});
		const originalOpen = factory.open.bind(factory);
		const opened = originalOpen("openmeld-composer-files", 1);
		opened.onupgradeneeded = () => {
			opened.result
				.createObjectStore("files", { keyPath: "id" })
				.createIndex("scope", "scope");
		};
		const lateDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
			opened.onsuccess = () => resolve(opened.result);
			opened.onerror = () => reject(opened.error);
		});
		vi.useFakeTimers();
		const lateRequest = {
			error: null,
			onblocked: null,
			onerror: null,
			onsuccess: null,
			onupgradeneeded: null,
			result: lateDatabase,
			transaction: null,
		} as unknown as IDBOpenDBRequest;
		const open = vi
			.spyOn(factory, "open")
			.mockImplementationOnce(() => lateRequest);
		const { runComposerFileDraftTransaction } = await import(
			"./composer-file-draft-database"
		);
		const waiting = runComposerFileDraftTransaction(
			"readonly",
			(_store, result) => result.set("late")
		);
		const timedOut = expect(waiting).rejects.toMatchObject({
			phase: "open-timeout",
		});
		await vi.advanceTimersByTimeAsync(5000);
		await timedOut;
		await expect(
			runComposerFileDraftTransaction("readonly", () => undefined)
		).rejects.toMatchObject({ phase: "open-timeout" });
		expect(open).toHaveBeenCalledTimes(1);

		lateRequest.onsuccess?.(new Event("success"));
		open.mockImplementation(originalOpen);
		vi.useRealTimers();
		await expect(
			runComposerFileDraftTransaction("readonly", (_store, result) =>
				result.set("fresh")
			)
		).resolves.toBe("fresh");
		expect(open).toHaveBeenCalledTimes(2);
	});
});
