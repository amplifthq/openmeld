import Dexie, { type DexieOptions, type Table } from "dexie";
import {
	defaultQueryPersistenceDiagnostics,
	type QueryPersistenceDiagnostics,
	resolvePersistenceErrorName,
} from "./query-persistence-diagnostics";

export const OPENMELD_QUERY_CACHE_DATABASE_NAME = "openmeld-web-query-cache";

export type QueryCacheScopeKind = "account" | "organization" | "space";

export type QueryCacheScope = {
	organizationId?: string;
	ownerAccountId: string;
	scopeAlias: string;
	scopeId: string;
	scopeKind: QueryCacheScopeKind;
};

export type AsyncStringStorage = {
	getItem: (key: string) => Promise<string | null>;
	removeItem: (key: string) => Promise<void>;
	setItem: (key: string, value: string) => Promise<void>;
};

export type DexieQueryCacheStore = {
	subscribe: (listener: (cleared: boolean) => void) => () => void;
	clearAccount: (ownerAccountId: string) => Promise<void>;
	clearAll: () => Promise<void>;
	clearOrganization: (
		ownerAccountId: string,
		organizationId: string
	) => Promise<void>;
	clearOrganizationBySlug: (
		ownerAccountId: string,
		organizationSlug: string
	) => Promise<void>;
	close: () => void;
	countRecords: () => Promise<number>;
	createStorage: (scope: QueryCacheScope) => AsyncStringStorage;
	deleteDatabase: () => Promise<void>;
};

type NormalizedQueryCacheScope = Omit<QueryCacheScope, "organizationId"> & {
	organizationId: string;
};

type QueryCacheRecord = NormalizedQueryCacheScope & {
	cacheKey: string;
	expiresAt: number;
	payload: string;
	storageKey: string;
	updatedAt: number;
};

type CreateDexieQueryCacheStoreInput = {
	mergePayload?: (existing: string, incoming: string) => string;
	databaseName?: string;
	diagnostics?: QueryPersistenceDiagnostics;
	IDBKeyRange?: DexieOptions["IDBKeyRange"];
	indexedDB?: DexieOptions["indexedDB"];
	now?: () => number;
	retentionMs: number;
};

class OpenMeldQueryCacheDatabase extends Dexie {
	queryCaches!: Table<QueryCacheRecord, string>;
	cacheSizes!: Table<
		{
			key: string;
			bytes: number;
			updatedAt: number;
			expiresAt: number;
			scopeKind: QueryCacheScopeKind;
		},
		string
	>;
	cacheGenerations!: Table<{ key: string; generation: number }, string>;

	constructor(
		databaseName: string,
		options: Pick<DexieOptions, "IDBKeyRange" | "indexedDB">,
		diagnostics: QueryPersistenceDiagnostics,
		onVersionChange: () => void
	) {
		super(databaseName, options);
		this.version(1).stores({
			queryCaches:
				"&cacheKey, ownerAccountId, [ownerAccountId+scopeKind+scopeId], expiresAt",
		});
		this.version(2).stores({
			queryCaches:
				"&cacheKey, ownerAccountId, [ownerAccountId+scopeKind+scopeId], [ownerAccountId+scopeKind+scopeAlias], expiresAt",
		});
		this.version(3)
			.stores({
				queryCaches:
					"&cacheKey, ownerAccountId, [ownerAccountId+scopeKind+scopeId], [ownerAccountId+scopeKind+scopeAlias], [ownerAccountId+organizationId], [ownerAccountId+scopeAlias], expiresAt",
			})
			.upgrade(async (transaction) => {
				await transaction
					.table<QueryCacheRecord, string>("queryCaches")
					.toCollection()
					.modify((record) => {
						record.organizationId =
							record.scopeKind === "organization" ? record.scopeId : "";
					});
			});
		this.version(4)
			.stores({ cacheGenerations: "&key", cacheSizes: "&key, expiresAt" })
			.upgrade(async (transaction) => {
				const records = await transaction
					.table<QueryCacheRecord, string>("queryCaches")
					.toArray();
				await transaction.table("cacheSizes").bulkPut(
					records.map((record) => ({
						key: record.cacheKey,
						bytes: new TextEncoder().encode(record.payload).byteLength,
						updatedAt: record.updatedAt,
						expiresAt: record.expiresAt,
						scopeKind: record.scopeKind,
					}))
				);
			});
		this.on("versionchange", () => {
			onVersionChange();
			diagnostics.record({
				event: "database_version_changed",
				scopeKind: "all",
			});
			this.close();
		});
		this.on("blocked", () => {
			diagnostics.record({ event: "database_blocked", scopeKind: "all" });
		});
	}
}

export function createDexieQueryCacheStore(
	input: CreateDexieQueryCacheStoreInput
): DexieQueryCacheStore {
	if (!Number.isSafeInteger(input.retentionMs) || input.retentionMs <= 0) {
		throw new Error("Query cache retention must be a positive safe integer.");
	}

	const now = input.now ?? Date.now;
	const diagnostics = input.diagnostics ?? defaultQueryPersistenceDiagnostics;
	const listeners = new Set<(cleared: boolean) => void>();
	const channel =
		typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
			? new BroadcastChannel(
					`${input.databaseName ?? OPENMELD_QUERY_CACHE_DATABASE_NAME}:changes`
				)
			: null;
	if (channel) {
		channel.onmessage = (event: MessageEvent<unknown>) => {
			if (event.data === "refresh" || event.data === "clear") {
				for (const listener of listeners) {
					listener(event.data === "clear");
				}
			}
		};
	}
	const notify = (cleared = false) =>
		channel?.postMessage(cleared ? "clear" : "refresh");
	let openPromise: Promise<void> | undefined;
	const database = new OpenMeldQueryCacheDatabase(
		input.databaseName ?? OPENMELD_QUERY_CACHE_DATABASE_NAME,
		{
			IDBKeyRange: input.IDBKeyRange ?? globalThis.IDBKeyRange,
			indexedDB: input.indexedDB ?? globalThis.indexedDB,
		},
		diagnostics,
		() => {
			openPromise = undefined;
		}
	);
	const ensureOpen = async () => {
		if (!openPromise) {
			openPromise = database
				.open()
				.then(() => {
					diagnostics.record({
						event: "database_open_succeeded",
						scopeKind: "all",
					});
				})
				.catch((error: unknown) => {
					openPromise = undefined;
					diagnostics.record({
						errorName: resolvePersistenceErrorName(error),
						event: "database_open_failed",
						scopeKind: "all",
					});
					throw error;
				});
		}
		await openPromise;
	};

	const clearWithFence = async (key: string, clear: () => Promise<unknown>) => {
		await ensureOpen();
		await database.transaction(
			"rw",
			database.queryCaches,
			database.cacheGenerations,
			database.cacheSizes,
			async () => {
				const generation =
					(await database.cacheGenerations.get(key))?.generation ?? 0;
				await database.cacheGenerations.put({
					key,
					generation: generation + 1,
				});
				await clear();
				const remaining = new Set(
					await database.queryCaches.toCollection().primaryKeys()
				);
				const sizeKeys = await database.cacheSizes.toCollection().primaryKeys();
				await database.cacheSizes.bulkDelete(
					sizeKeys.filter((entry) => !remaining.has(entry))
				);
			}
		);
		notify(true);
	};
	return {
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		clearAccount: async (ownerAccountId) => {
			await clearWithFence(JSON.stringify([ownerAccountId]), () =>
				database.queryCaches
					.where("ownerAccountId")
					.equals(normalizeScopePart(ownerAccountId, "owner account id"))
					.delete()
			);
		},
		clearAll: async () => {
			await clearWithFence("all", () => database.queryCaches.clear());
		},
		clearOrganization: async (ownerAccountId, organizationId) => {
			await clearWithFence(
				JSON.stringify([ownerAccountId, organizationId]),
				() =>
					database.queryCaches
						.where("[ownerAccountId+organizationId]")
						.equals([
							normalizeScopePart(ownerAccountId, "owner account id"),
							normalizeScopePart(organizationId, "organization id"),
						])
						.delete()
			);
		},
		clearOrganizationBySlug: async (ownerAccountId, organizationSlug) => {
			await clearWithFence(
				JSON.stringify([ownerAccountId, "slug", organizationSlug]),
				() =>
					database.queryCaches
						.where("[ownerAccountId+scopeAlias]")
						.equals([
							normalizeScopePart(ownerAccountId, "owner account id"),
							normalizeScopePart(organizationSlug, "organization slug"),
						])
						.filter((record) => record.scopeKind !== "account")
						.delete()
			);
		},
		close: () => {
			channel?.close();
			listeners.clear();
			database.close();
		},
		countRecords: async () => {
			await ensureOpen();
			return await database.queryCaches.count();
		},
		createStorage: (rawScope) => {
			const scope = normalizeScope(rawScope);
			const fenceKeys = [
				"all",
				JSON.stringify([scope.ownerAccountId]),
				JSON.stringify([scope.ownerAccountId, scope.organizationId]),
				JSON.stringify([scope.ownerAccountId, "slug", scope.scopeAlias]),
				JSON.stringify([scope.ownerAccountId, scope.scopeKind, scope.scopeId]),
			];
			let generations: number[] | undefined;
			const readGenerations = async () =>
				(await database.cacheGenerations.bulkGet(fenceKeys)).map(
					(record) => record?.generation ?? 0
				);
			return {
				getItem: async (storageKey) => {
					await ensureOpen();
					generations ??= await readGenerations();
					const cacheKey = buildCacheKey(scope, storageKey);
					const record = await database.queryCaches.get(cacheKey);
					if (!record) {
						return null;
					}
					if (record.expiresAt <= now()) {
						await database.queryCaches.delete(cacheKey);
						return null;
					}
					return record.payload;
				},
				removeItem: async (storageKey) => {
					await clearWithFence(fenceKeys[4], () =>
						database.queryCaches.delete(buildCacheKey(scope, storageKey))
					);
				},
				setItem: async (storageKey, payload) => {
					let savedPayload = payload;
					await ensureOpen();
					const updatedAt = now();
					try {
						await database.transaction(
							"rw",
							database.queryCaches,
							database.cacheGenerations,
							database.cacheSizes,
							async () => {
								const current = await readGenerations();
								generations ??= current;
								if (
									current.some((value, index) => value !== generations?.[index])
								) {
									return;
								}
								const existing = await database.queryCaches.get(
									buildCacheKey(scope, storageKey)
								);
								// A delayed old tab must not replace a newer query snapshot.
								if (existing && input.mergePayload) {
									savedPayload = input.mergePayload(existing.payload, payload);
								} else if (
									existing &&
									newestQueryUpdate(existing.payload) >
										newestQueryUpdate(payload)
								) {
									return;
								}
								await database.queryCaches.put({
									...scope,
									cacheKey: buildCacheKey(scope, storageKey),
									expiresAt: updatedAt + input.retentionMs,
									payload: savedPayload,
									storageKey: normalizeScopePart(storageKey, "storage key"),
									updatedAt,
								});
								await database.cacheSizes.put({
									key: buildCacheKey(scope, storageKey),
									bytes: new TextEncoder().encode(savedPayload).byteLength,
									updatedAt,
									expiresAt: updatedAt + input.retentionMs,
									scopeKind: scope.scopeKind,
								});
								await evictSavedViews(database, now());
							}
						);
						notify();
					} catch (error) {
						if (resolvePersistenceErrorName(error) === "QuotaExceededError") {
							diagnostics.record({
								errorName: "QuotaExceededError",
								event: "quota_failed",
								scopeKind: scope.scopeKind,
							});
						}
						throw error;
					}
				},
			};
		},
		deleteDatabase: async () => {
			channel?.close();
			listeners.clear();
			database.close();
			await database.delete();
		},
	};
}

function normalizeScope(scope: QueryCacheScope): NormalizedQueryCacheScope {
	const scopeId = normalizeScopePart(scope.scopeId, "scope id");
	const organizationId = resolveOrganizationId({
		organizationId: scope.organizationId,
		scopeId,
		scopeKind: scope.scopeKind,
	});
	return {
		organizationId,
		ownerAccountId: normalizeScopePart(
			scope.ownerAccountId,
			"owner account id"
		),
		scopeAlias: normalizeScopePart(scope.scopeAlias, "scope alias"),
		scopeId,
		scopeKind: scope.scopeKind,
	};
}

function newestQueryUpdate(payload: string): number {
	try {
		const client = JSON.parse(payload) as {
			clientState?: { queries?: Array<{ state: { dataUpdatedAt: number } }> };
		};
		return Math.max(
			0,
			...(client.clientState?.queries ?? []).map(
				(query) => query.state.dataUpdatedAt
			)
		);
	} catch {
		return 0;
	}
}

// Bound the browser's saved read views, not the live Query cache. Expired data
// leaves first, then the least recently written conversation records.
async function evictSavedViews(
	database: OpenMeldQueryCacheDatabase,
	now: number
): Promise<void> {
	await database.queryCaches.where("expiresAt").belowOrEqual(now).delete();
	await database.cacheSizes.where("expiresAt").belowOrEqual(now).delete();
	const records = await database.cacheSizes.toArray();
	let bytes = records.reduce((total, record) => total + record.bytes, 0);
	const evictedKeys: string[] = [];
	for (const record of records
		.filter((item) => item.scopeKind === "space")
		.sort((a, b) => a.updatedAt - b.updatedAt)) {
		if (bytes <= 32 * 1024 * 1024) {
			break;
		}
		evictedKeys.push(record.key);
		bytes -= record.bytes;
	}
	await database.queryCaches.bulkDelete(evictedKeys);
	await database.cacheSizes.bulkDelete(evictedKeys);
}

function resolveOrganizationId(input: {
	organizationId?: string;
	scopeId: string;
	scopeKind: QueryCacheScopeKind;
}): string {
	if (input.scopeKind === "account") {
		return "";
	}
	if (input.scopeKind === "organization") {
		return input.scopeId;
	}
	if (input.organizationId === undefined) {
		throw new Error("Space query cache scope requires an organization id.");
	}
	return normalizeScopePart(input.organizationId, "organization id");
}

function normalizeScopePart(value: string, label: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new Error(`Query cache ${label} must not be empty.`);
	}
	return normalized;
}

function buildCacheKey(
	scope: NormalizedQueryCacheScope,
	storageKey: string
): string {
	return JSON.stringify([
		"openmeld-query-cache-v1",
		scope.ownerAccountId,
		scope.scopeKind,
		scope.scopeId,
		normalizeScopePart(storageKey, "storage key"),
	]);
}
