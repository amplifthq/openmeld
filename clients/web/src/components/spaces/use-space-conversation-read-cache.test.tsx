import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BrowserQueryPersistenceController } from "#/query/persistence/browser-query-persistence";
import { useSpaceConversationReadCache } from "./use-space-conversation-read-cache";

const useOptionalAppOrganizationMock = vi.hoisted(() => vi.fn());
const resolveAppQueryPersistenceControllerMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: useOptionalAppOrganizationMock,
}));

vi.mock("#/query/persistence/app-query-persistence", () => ({
	resolveAppQueryPersistenceController:
		resolveAppQueryPersistenceControllerMock,
}));

describe("useSpaceConversationReadCache", () => {
	it("activates the same per-Space cache for route and compact conversation surfaces", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const queryPersistence = createQueryPersistenceMock();
		resolveAppQueryPersistenceControllerMock.mockReturnValue(queryPersistence);
		useOptionalAppOrganizationMock.mockReturnValue({
			currentOrganization: { id: "organization-a", slug: "acme" },
			storageScope: "account-a",
		});
		const wrapper = ({ children }: PropsWithChildren) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);

		renderHook(
			() =>
				useSpaceConversationReadCache({
					spaceId: "space-a",
					openMeldProfileId: "profile-a",
				}),
			{ wrapper }
		);

		await waitFor(() => {
			expect(queryPersistence.activateSpaceConversation).toHaveBeenCalledWith({
				organizationId: "organization-a",
				organizationSlug: "acme",
				ownerAccountId: "account-a",
				queryClient,
				spaceId: "space-a",
				openMeldProfileId: "profile-a",
			});
		});
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
