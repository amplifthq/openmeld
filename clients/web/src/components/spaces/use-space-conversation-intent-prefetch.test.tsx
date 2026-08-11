import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSpaceConversationIntentPrefetch } from "./use-space-conversation-intent-prefetch";

const prefetchKnownSpaceConversationDataMock = vi.hoisted(() => vi.fn());
const resolveAppQueryPersistenceControllerMock = vi.hoisted(() => vi.fn());
const queryPersistence = { activateSpaceConversation: vi.fn() };

vi.mock("#/lib/organizations/app-route-prefetch", () => ({
	prefetchKnownSpaceConversationData: prefetchKnownSpaceConversationDataMock,
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

describe("useSpaceConversationIntentPrefetch", () => {
	beforeEach(() => {
		prefetchKnownSpaceConversationDataMock
			.mockReset()
			.mockResolvedValue(undefined);
		resolveAppQueryPersistenceControllerMock
			.mockReset()
			.mockReturnValue(queryPersistence);
	});

	it("uses the already authorized app context without resolving the route again", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const wrapper = ({ children }: PropsWithChildren) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);
		const { result } = renderHook(() => useSpaceConversationIntentPrefetch(), {
			wrapper,
		});

		await act(async () => {
			await result.current({
				spaceId: "space-a",
				openMeldProfileId: "profile-a",
			});
		});

		expect(prefetchKnownSpaceConversationDataMock).toHaveBeenCalledWith({
			organizationId: "organization-a",
			organizationSlug: "acme",
			ownerAccountId: "account-a",
			queryClient,
			queryPersistence,
			spaceId: "space-a",
			openMeldProfileId: "profile-a",
		});
	});
});
