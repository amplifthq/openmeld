import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createDexieQueryCacheStore,
	type DexieQueryCacheStore,
} from "./dexie-query-cache-store";

const stores: DexieQueryCacheStore[] = [];

afterEach(async () => {
	await Promise.all(stores.splice(0).map((store) => store.deleteDatabase()));
	vi.unstubAllGlobals();
});

describe("DexieQueryCacheStore", () => {
	it("isolates the same storage key by account and organization", async () => {
		const store = createTestStore();
		const organizationA = store.createStorage({
			ownerAccountId: "account-a",
			scopeAlias: "organization-a",
			scopeId: "organization-a",
			scopeKind: "organization",
		});
		const organizationB = store.createStorage({
			ownerAccountId: "account-a",
			scopeAlias: "organization-b",
			scopeId: "organization-b",
			scopeKind: "organization",
		});
		const otherAccount = store.createStorage({
			ownerAccountId: "account-b",
			scopeAlias: "organization-a",
			scopeId: "organization-a",
			scopeKind: "organization",
		});

		await organizationA.setItem("query-cache", "organization-a-payload");

		expect(await organizationA.getItem("query-cache")).toBe(
			"organization-a-payload"
		);
		expect(await organizationB.getItem("query-cache")).toBeNull();
		expect(await otherAccount.getItem("query-cache")).toBeNull();
	});

	it("uses the browser IndexedDB globals outside the test injection seam", async () => {
		vi.stubGlobal("indexedDB", indexedDB);
		vi.stubGlobal("IDBKeyRange", IDBKeyRange);
		const store = createDexieQueryCacheStore({
			databaseName: `openmeld-global-query-cache-${crypto.randomUUID()}`,
			retentionMs: 1000,
		});
		stores.push(store);
		const storage = store.createStorage({
			ownerAccountId: "account-a",
			scopeAlias: "account-a",
			scopeId: "account-a",
			scopeKind: "account",
		});

		await storage.setItem("query-cache", "payload");

		expect(await storage.getItem("query-cache")).toBe("payload");
	});

	it("reports unavailable IndexedDB instead of hiding the storage failure", async () => {
		vi.stubGlobal("indexedDB", undefined);
		vi.stubGlobal("IDBKeyRange", undefined);
		const diagnostics = { record: vi.fn() };
		const store = createDexieQueryCacheStore({
			databaseName: `openmeld-unavailable-query-cache-${crypto.randomUUID()}`,
			diagnostics,
			retentionMs: 1000,
		});
		const storage = store.createStorage({
			ownerAccountId: "account-a",
			scopeAlias: "account-a",
			scopeId: "account-a",
			scopeKind: "account",
		});

		await expect(storage.getItem("query-cache")).rejects.toThrow();
		expect(diagnostics.record).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "database_open_failed",
				scopeKind: "all",
			})
		);
		store.close();
	});

	it("deletes an expired record instead of returning it", async () => {
		let now = 1000;
		const store = createTestStore({ now: () => now, retentionMs: 500 });
		const storage = store.createStorage({
			ownerAccountId: "account-a",
			scopeAlias: "account-a",
			scopeId: "account-a",
			scopeKind: "account",
		});

		await storage.setItem("query-cache", "profile-payload");
		now = 1501;

		expect(await storage.getItem("query-cache")).toBeNull();
		expect(await store.countRecords()).toBe(0);
	});

	it("clears one organization without deleting sibling scopes", async () => {
		const store = createTestStore();
		const account = store.createStorage({
			ownerAccountId: "account-a",
			scopeAlias: "account-a",
			scopeId: "account-a",
			scopeKind: "account",
		});
		const organizationA = store.createStorage({
			ownerAccountId: "account-a",
			scopeAlias: "organization-a",
			scopeId: "organization-a",
			scopeKind: "organization",
		});
		const organizationB = store.createStorage({
			ownerAccountId: "account-a",
			scopeAlias: "organization-b",
			scopeId: "organization-b",
			scopeKind: "organization",
		});
		const organizationASpace = store.createStorage({
			organizationId: "organization-a",
			ownerAccountId: "account-a",
			scopeAlias: "organization-a",
			scopeId: "space-a",
			scopeKind: "space",
		});

		await Promise.all([
			account.setItem("query-cache", "account-payload"),
			organizationA.setItem("query-cache", "organization-a-payload"),
			organizationB.setItem("query-cache", "organization-b-payload"),
			organizationASpace.setItem("query-cache", "space-a-payload"),
		]);

		await store.clearOrganization("account-a", "organization-a");

		expect(await account.getItem("query-cache")).toBe("account-payload");
		expect(await organizationA.getItem("query-cache")).toBeNull();
		expect(await organizationASpace.getItem("query-cache")).toBeNull();
		expect(await organizationB.getItem("query-cache")).toBe(
			"organization-b-payload"
		);
	});

	it("uses the immutable organization id while keeping slug cleanup available", async () => {
		const store = createTestStore();
		const beforeRename = store.createStorage({
			ownerAccountId: "account-a",
			scopeAlias: "old-slug",
			scopeId: "organization-stable-id",
			scopeKind: "organization",
		});
		const afterRename = store.createStorage({
			ownerAccountId: "account-a",
			scopeAlias: "new-slug",
			scopeId: "organization-stable-id",
			scopeKind: "organization",
		});
		const spaceAfterRename = store.createStorage({
			organizationId: "organization-stable-id",
			ownerAccountId: "account-a",
			scopeAlias: "new-slug",
			scopeId: "space-a",
			scopeKind: "space",
		});

		await beforeRename.setItem("query-cache", "before-rename");
		await afterRename.setItem("query-cache", "after-rename");
		await spaceAfterRename.setItem("query-cache", "space-after-rename");

		expect(await store.countRecords()).toBe(2);
		expect(await afterRename.getItem("query-cache")).toBe("after-rename");
		await store.clearOrganizationBySlug("account-a", "new-slug");
		expect(await afterRename.getItem("query-cache")).toBeNull();
		expect(await spaceAfterRename.getItem("query-cache")).toBeNull();
	});

	it("clears every record owned by one account", async () => {
		const store = createTestStore();
		const accountA = store.createStorage({
			ownerAccountId: "account-a",
			scopeAlias: "account-a",
			scopeId: "account-a",
			scopeKind: "account",
		});
		const accountB = store.createStorage({
			ownerAccountId: "account-b",
			scopeAlias: "account-b",
			scopeId: "account-b",
			scopeKind: "account",
		});

		await accountA.setItem("query-cache", "account-a-payload");
		await accountB.setItem("query-cache", "account-b-payload");

		await store.clearAccount("account-a");

		expect(await accountA.getItem("query-cache")).toBeNull();
		expect(await accountB.getItem("query-cache")).toBe("account-b-payload");
	});

	it("upgrades existing organization records so organization cleanup stays complete", async () => {
		const databaseName = `openmeld-query-cache-upgrade-${crypto.randomUUID()}`;
		const legacyDatabase = new Dexie(databaseName, { IDBKeyRange, indexedDB });
		legacyDatabase.version(1).stores({
			queryCaches:
				"&cacheKey, ownerAccountId, [ownerAccountId+scopeKind+scopeId], expiresAt",
		});
		legacyDatabase.version(2).stores({
			queryCaches:
				"&cacheKey, ownerAccountId, [ownerAccountId+scopeKind+scopeId], [ownerAccountId+scopeKind+scopeAlias], expiresAt",
		});
		await legacyDatabase.table("queryCaches").put({
			cacheKey: "legacy-organization-record",
			expiresAt: Date.now() + 60_000,
			ownerAccountId: "account-a",
			payload: "legacy-payload",
			scopeAlias: "organization-a",
			scopeId: "organization-a",
			scopeKind: "organization",
			storageKey: "query-cache",
			updatedAt: Date.now(),
		});
		legacyDatabase.close();
		const store = createDexieQueryCacheStore({
			databaseName,
			IDBKeyRange,
			indexedDB,
			retentionMs: 60_000,
		});
		stores.push(store);

		await store.clearOrganization("account-a", "organization-a");

		expect(await store.countRecords()).toBe(0);
	});
});

function createTestStore(input?: {
	now?: () => number;
	retentionMs?: number;
}): DexieQueryCacheStore {
	const store = createDexieQueryCacheStore({
		databaseName: `openmeld-query-cache-${crypto.randomUUID()}`,
		IDBKeyRange,
		indexedDB,
		now: input?.now,
		retentionMs: input?.retentionMs ?? 1000,
	});
	stores.push(store);
	return store;
}
