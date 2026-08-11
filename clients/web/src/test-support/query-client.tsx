import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

export function createTestQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false, retryDelay: 1 },
			mutations: { retry: false },
		},
	});
}

export function TestQueryClientProvider(
	input: PropsWithChildren<{ queryClient?: QueryClient }>
) {
	return (
		<QueryClientProvider client={input.queryClient ?? createTestQueryClient()}>
			{input.children}
		</QueryClientProvider>
	);
}
