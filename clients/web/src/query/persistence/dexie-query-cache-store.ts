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
	databaseName?: string;
	diagnostics?: QueryPersistenceDiagnostics;
	IDBKeyRange?: DexieOptions["IDBKeyRange"];
	indexedDB?: DexieOptions["indexedDB"];
	now?: () => number;
	retentionMs: number;
};

class OpenMeldQueryCacheDatabase extends Dexie {
	queryCaches!: Table<QueryCacheRecord, string>;

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

	return {
		clearAccount: async (ownerAccountId) => {
			await ensureOpen();
			await database.queryCaches
				.where("ownerAccountId")
				.equals(normalizeScopePart(ownerAccountId, "owner account id"))
				.delete();
		},
		clearAll: async () => {
			await ensureOpen();
			await database.queryCaches.clear();
		},
		clearOrganization: async (ownerAccountId, organizationId) => {
			await ensureOpen();
			await database.queryCaches
				.where("[ownerAccountId+organizationId]")
				.equals([
					normalizeScopePart(ownerAccountId, "owner account id"),
					normalizeScopePart(organizationId, "organization id"),
				])
				.delete();
		},
		clearOrganizationBySlug: async (ownerAccountId, organizationSlug) => {
			await ensureOpen();
			await database.queryCaches
				.where("[ownerAccountId+scopeAlias]")
				.equals([
					normalizeScopePart(ownerAccountId, "owner account id"),
					normalizeScopePart(organizationSlug, "organization slug"),
				])
				.filter((record) => record.scopeKind !== "account")
				.delete();
		},
		close: () => {
			database.close();
		},
		countRecords: async () => {
			await ensureOpen();
			return await database.queryCaches.count();
		},
		createStorage: (rawScope) => {
			const scope = normalizeScope(rawScope);
			return {
				getItem: async (storageKey) => {
					await ensureOpen();
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
					await ensureOpen();
					await database.queryCaches.delete(buildCacheKey(scope, storageKey));
				},
				setItem: async (storageKey, payload) => {
					await ensureOpen();
					const updatedAt = now();
					try {
						await database.queryCaches.put({
							...scope,
							cacheKey: buildCacheKey(scope, storageKey),
							expiresAt: updatedAt + input.retentionMs,
							payload,
							storageKey: normalizeScopePart(storageKey, "storage key"),
							updatedAt,
						});
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
