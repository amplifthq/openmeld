import type { AccountSession } from "@openmeld/schemas";
import type { QueryClient } from "@tanstack/react-query";
import { clearAllComposerDrafts } from "#/lib/composer-draft-storage";
import { clearSpaceConversationPositions } from "#/lib/space-conversation-position";
import { resolveAppQueryPersistenceController } from "#/query/persistence/app-query-persistence";
import type { BrowserQueryPersistenceController } from "#/query/persistence/browser-query-persistence";
import { userQueryKeys } from "#/query/query-keys";
import { clearSpaceFileMediaResources } from "#/query/spaces/space-file-media-resource";

export const ACCOUNT_AUTH_CHANGE_STORAGE_KEY =
	"openmeld.auth.account-change.v1";

export type AccountAuthChangeReason =
	| "account-switched"
	| "session-created"
	| "session-revoked"
	| "signed-out";

export async function resetAccountScopedQueriesAfterAuthChange(
	queryClient: QueryClient,
	options?: {
		preserveComposerDrafts?: boolean;
		queryPersistence?: BrowserQueryPersistenceController;
	}
): Promise<void> {
	clearSpaceFileMediaResources(queryClient);
	if (!options?.preserveComposerDrafts) {
		clearAllComposerDrafts();
	}
	clearSpaceConversationPositions();
	const queryPersistence =
		options?.queryPersistence ?? resolveAppQueryPersistenceController();
	try {
		await queryPersistence.clearActiveAccount();
	} catch (error) {
		console.error({
			errorName: error instanceof Error ? error.name : typeof error,
			event: "web.openmeld.browser_query_persistence.auth_cleanup_failed",
			message: error instanceof Error ? error.message : String(error),
		});
	}
	await queryClient.cancelQueries({});
	queryClient.removeQueries({});
}

export function readKnownAccountIdBeforeSessionRevalidation(
	queryClient: QueryClient
): string | undefined {
	return queryClient.getQueryData<AccountSession>(userQueryKeys.session)?.user
		.id;
}

export function sessionReadConfirmsPrivateCleanup(input: {
	previousAccountId: string | null | undefined;
	nextAccountId: string | null;
}): boolean {
	return (
		input.nextAccountId === null ||
		(typeof input.previousAccountId === "string" &&
			input.previousAccountId !== input.nextAccountId)
	);
}

export async function clearPrivateAccountStateAfterSessionRead(
	queryClient: QueryClient,
	input: {
		previousAccountId: string | null | undefined;
		nextAccountId: string | null;
	}
): Promise<void> {
	if (sessionReadConfirmsPrivateCleanup(input)) {
		await resetAccountScopedQueriesAfterAuthChange(queryClient);
	}
}

export async function completeAccountAuthChange(
	queryClient: QueryClient,
	reason: AccountAuthChangeReason
): Promise<void> {
	await resetAccountScopedQueriesAfterAuthChange(queryClient);
	notifyOtherTabsOfAccountAuthChange(reason);
}

export function notifyOtherTabsOfAccountAuthChange(
	reason: AccountAuthChangeReason
): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.setItem(
			ACCOUNT_AUTH_CHANGE_STORAGE_KEY,
			JSON.stringify({
				id: crypto.randomUUID(),
				reason,
			})
		);
	} catch (error) {
		console.warn("Account change could not be shared with other tabs.", {
			errorName: error instanceof Error ? error.name : typeof error,
		});
	}
}

export function subscribeToAccountAuthChanges(
	listener: () => void
): () => void {
	if (typeof window === "undefined") {
		return () => undefined;
	}

	const onStorage = (event: StorageEvent) => {
		if (event.key === ACCOUNT_AUTH_CHANGE_STORAGE_KEY && event.newValue) {
			listener();
		}
	};
	window.addEventListener("storage", onStorage);
	return () => window.removeEventListener("storage", onStorage);
}
