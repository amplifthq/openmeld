import type { WebApplicationErrorQueryCategory } from "@openmeld/schemas";
import { QueryCache, QueryClient, type QueryKey } from "@tanstack/react-query";
import { reportClientQueryError } from "#/lib/observability/application-error-client";

let browserQueryClient: QueryClient | undefined;

export function createAppQueryClient() {
	return new QueryClient({
		queryCache: new QueryCache({
			onError: (error, query) => {
				const category = resolveApplicationErrorQueryCategory(query.queryKey);
				if (category) {
					reportClientQueryError(error, category);
				}
			},
		}),
	});
}

function resolveApplicationErrorQueryCategory(
	queryKey: QueryKey
): WebApplicationErrorQueryCategory | null {
	if (queryKey[0] === "account-organization-context") {
		return "account_organization_context";
	}
	if (queryKey[0] === "user" && queryKey[1] === "session") {
		return "account_session";
	}
	if (queryKey[0] === "inbox") {
		return "inbox";
	}
	if (queryKey[0] !== "spaces") {
		return null;
	}
	if (queryKey[1] === "account-spaces") {
		return "account_spaces";
	}
	if (queryKey[1] === "members") {
		return "space_members";
	}
	if (queryKey[1] === "updates") {
		return "space_live";
	}
	return null;
}

export function resolveAppQueryClient(options?: { isServer?: boolean }) {
	if (options?.isServer ?? import.meta.env.SSR) {
		return createAppQueryClient();
	}

	browserQueryClient ??= createAppQueryClient();
	return browserQueryClient;
}

export function resetBrowserQueryClientForTests() {
	browserQueryClient = undefined;
}
