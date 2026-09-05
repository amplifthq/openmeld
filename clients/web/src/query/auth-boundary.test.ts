import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createComposerDraftRecord,
	EMPTY_COMPOSER_DRAFT_CONTENT,
	readComposerDraft,
	writeComposerDraft,
} from "#/lib/composer-draft-storage";
import {
	ACCOUNT_AUTH_CHANGE_STORAGE_KEY,
	completeAccountAuthChange,
	resetAccountScopedQueriesAfterAuthChange,
	subscribeToAccountAuthChanges,
} from "./auth-boundary";
import type { BrowserQueryPersistenceController } from "./persistence/browser-query-persistence";

describe("resetAccountScopedQueriesAfterAuthChange", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("removes cached account data after an auth boundary change", async () => {
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
			},
		});

		queryClient.setQueryData(["agents", "execution-readiness", "user-a"], {
			displayState: "checking",
		});
		queryClient.setQueryData(["spaces", "list", "user-a"], {
			spaces: [],
		});

		const queryPersistence = createQueryPersistenceMock();

		await resetAccountScopedQueriesAfterAuthChange(queryClient, {
			queryPersistence,
		});

		expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
		expect(queryPersistence.clearActiveAccount).toHaveBeenCalledTimes(1);
	});

	it("clears private Composer drafts at an auth boundary change", async () => {
		const scope = {
			kind: "space" as const,
			ownerAccountId: "account-1",
			profileId: "human-1",
			spaceId: "space-1",
		};
		writeComposerDraft(
			scope,
			createComposerDraftRecord({
				...EMPTY_COMPOSER_DRAFT_CONTENT,
				text: "Private draft",
			})
		);

		await resetAccountScopedQueriesAfterAuthChange(new QueryClient(), {
			queryPersistence: createQueryPersistenceMock(),
		});

		expect(readComposerDraft(scope)).toBeNull();
	});

	it("still removes memory data when browser storage cleanup fails", async () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(["spaces", "list", "user-a"], { spaces: [] });
		const queryPersistence = createQueryPersistenceMock();
		vi.mocked(queryPersistence.clearActiveAccount).mockRejectedValue(
			new Error("IndexedDB unavailable")
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		await expect(
			resetAccountScopedQueriesAfterAuthChange(queryClient, {
				queryPersistence,
			})
		).resolves.toBeUndefined();

		expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
		expect(consoleError).toHaveBeenCalledWith(
			expect.objectContaining({
				errorName: "Error",
				event: "web.openmeld.browser_query_persistence.auth_cleanup_failed",
			})
		);
	});

	it("notifies other tabs only after local account data is cleared", async () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(["spaces", "list", "user-a"], { spaces: [] });
		const setItem = vi.spyOn(Storage.prototype, "setItem");

		await completeAccountAuthChange(queryClient, "account-switched");

		expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
		expect(setItem).toHaveBeenCalledWith(
			ACCOUNT_AUTH_CHANGE_STORAGE_KEY,
			expect.stringContaining('"reason":"account-switched"')
		);
	});

	it("subscribes to account changes from another tab", () => {
		const listener = vi.fn();
		const unsubscribe = subscribeToAccountAuthChanges(listener);

		window.dispatchEvent(
			new StorageEvent("storage", {
				key: ACCOUNT_AUTH_CHANGE_STORAGE_KEY,
				newValue: JSON.stringify({
					id: "event-1",
					reason: "session-created",
				}),
			})
		);

		expect(listener).toHaveBeenCalledTimes(1);
		unsubscribe();
	});
});

function createQueryPersistenceMock(): BrowserQueryPersistenceController {
	return {
		activateAuthorizedScope: vi.fn(async () => undefined),
		activateSpaceConversation: vi.fn(async () => undefined),
		clearActiveAccount: vi.fn(async () => undefined),
		clearSpaceConversation: vi.fn(async () => undefined),
		clearOrganization: vi.fn(async () => undefined),
		clearOrganizationBySlug: vi.fn(async () => undefined),
		deactivate: vi.fn(),
	};
}
