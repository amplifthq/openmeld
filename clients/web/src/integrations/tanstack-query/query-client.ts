import { QueryClient } from "@tanstack/react-query";

let browserQueryClient: QueryClient | undefined;

export function createAppQueryClient() {
	return new QueryClient();
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
