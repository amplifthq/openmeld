import type { BrowserQueryPersistenceController } from "./browser-query-persistence";
import {
	BROWSER_QUERY_CACHE_MAX_AGE_MS,
	createBrowserQueryPersistenceController,
	mergePersistedBrowserViews,
} from "./browser-query-persistence";
import {
	createDexieQueryCacheStore,
	type DexieQueryCacheStore,
} from "./dexie-query-cache-store";
import { defaultQueryPersistenceDiagnostics } from "./query-persistence-diagnostics";

const RESTORE_BUDGET_MS = 100;
const SAVE_THROTTLE_MS = 1000;

type BrowserPersistenceState = {
	controller: BrowserQueryPersistenceController;
	store: DexieQueryCacheStore;
};

let browserPersistenceState: BrowserPersistenceState | undefined;

const serverQueryPersistenceController: BrowserQueryPersistenceController = {
	activateAuthorizedScope: async () => undefined,
	activateSpaceConversation: async () => undefined,
	clearActiveAccount: async () => undefined,
	clearSpaceConversation: async () => undefined,
	clearOrganization: async () => undefined,
	clearOrganizationBySlug: async () => undefined,
	deactivate: () => undefined,
};

export function resolveAppQueryPersistenceController(options?: {
	isServer?: boolean;
}): BrowserQueryPersistenceController {
	if (options?.isServer ?? import.meta.env.SSR) {
		return serverQueryPersistenceController;
	}

	if (!browserPersistenceState) {
		const store = createDexieQueryCacheStore({
			mergePayload: mergePersistedBrowserViews,
			diagnostics: defaultQueryPersistenceDiagnostics,
			retentionMs: BROWSER_QUERY_CACHE_MAX_AGE_MS,
		});
		browserPersistenceState = {
			controller: createBrowserQueryPersistenceController({
				diagnostics: defaultQueryPersistenceDiagnostics,
				restoreBudgetMs: RESTORE_BUDGET_MS,
				store,
				throttleTimeMs: SAVE_THROTTLE_MS,
			}),
			store,
		};
	}

	return browserPersistenceState.controller;
}

export function resetAppQueryPersistenceControllerForTests(): void {
	browserPersistenceState?.controller.deactivate();
	browserPersistenceState?.store.close();
	browserPersistenceState = undefined;
}
