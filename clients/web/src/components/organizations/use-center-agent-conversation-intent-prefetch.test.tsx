import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCenterAgentConversationIntentPrefetch } from "./use-center-agent-conversation-intent-prefetch";

const prefetchCenterAgentConversationDataMock = vi.hoisted(() => vi.fn());
const resolveAppQueryPersistenceControllerMock = vi.hoisted(() => vi.fn());
const queryPersistence = { activateSpaceConversation: vi.fn() };

vi.mock("#/lib/organizations/app-route-prefetch", () => ({
	prefetchCenterAgentConversationData: prefetchCenterAgentConversationDataMock,
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: { id: "organization-a", slug: "acme" },
		storageScope: "account-a",
	}),
}));

vi.mock("#/query/persistence/app-query-persistence", () => ({
	resolveAppQueryPersistenceController:
		resolveAppQueryPersistenceControllerMock,
}));

describe("useCenterAgentConversationIntentPrefetch", () => {
	beforeEach(() => {
		prefetchCenterAgentConversationDataMock
			.mockReset()
			.mockResolvedValue(undefined);
		resolveAppQueryPersistenceControllerMock
			.mockReset()
			.mockReturnValue(queryPersistence);
	});

	it("uses the authorized app scope for read-only Center Agent warming", () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const wrapper = ({ children }: PropsWithChildren) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);
		const { result } = renderHook(
			() => useCenterAgentConversationIntentPrefetch(),
			{ wrapper }
		);

		act(() => result.current());

		expect(prefetchCenterAgentConversationDataMock).toHaveBeenCalledWith({
			organizationId: "organization-a",
			organizationSlug: "acme",
			ownerAccountId: "account-a",
			queryClient,
			queryPersistence,
		});
	});
});
