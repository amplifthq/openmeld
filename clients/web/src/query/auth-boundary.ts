import type { QueryClient } from "@tanstack/react-query";
import { clearAllComposerDrafts } from "#/lib/composer-draft-storage";
import { resolveAppQueryPersistenceController } from "#/query/persistence/app-query-persistence";
import type { BrowserQueryPersistenceController } from "#/query/persistence/browser-query-persistence";

export async function resetAccountScopedQueriesAfterAuthChange(
	queryClient: QueryClient,
	options?: { queryPersistence?: BrowserQueryPersistenceController }
): Promise<void> {
	clearAllComposerDrafts();
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
