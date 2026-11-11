import {
	listAgentDirectMessageSessionsResponseSchema,
	updateAgentDirectMessageSessionBodySchema,
	updateAgentDirectMessageSessionResponseSchema,
} from "@openmeld/schemas";
import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { agentDirectMessageSessionsQueryOptions } from "#/query/organizations/agent-direct-message-sessions";
import { useMemberAgentSessionArchive } from "./member-agent-chat-history";

const { navigate } = vi.hoisted(() => ({
	navigate: vi.fn(async () => undefined),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("#/lib/member-agents/member-agents-feature", () => ({
	isMemberAgentsEnabled: () => true,
}));
vi.mock("#/lib/organizations/organization-context", () => {
	const value = {
		currentOrganization: { id: "org-test", slug: "test", name: "Test" },
		currentUserId: "human-user",
	};
	return {
		useAppOrganization: () => value,
		useOptionalAppOrganization: () => value,
	};
});
vi.mock("#/components/app/use-sidebar-preferences", () => ({
	useSidebarPreferences: () => ({ preferences: null }),
}));

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

it("archives and restores a colleague Session through the shared Active and Archived queries without an owner index", async () => {
	const agentProfileId = "agt_22222222-2222-4222-8222-222222222222";
	const memberProfileId = "11111111-1111-4111-8111-111111111111";
	const spaceId = "colleague-session";
	const createdAt = "2026-10-21T10:00:00.000Z";
	let archivedAt: string | null = null;
	const operations: string[] = [];
	const sessionPath = "/v1/organizations/current/direct-message-sessions";
	vi.stubGlobal(
		"fetch",
		vi.fn<typeof fetch>(async (resource, init) => {
			const request = new Request(resource, init);
			const url = new URL(request.url);
			if (url.pathname === sessionPath && request.method === "GET") {
				expect(url.searchParams.get("agentProfileId")).toBe(agentProfileId);
				const archived = url.searchParams.get("archived") === "true";
				return Response.json(
					listAgentDirectMessageSessionsResponseSchema.parse({
						generatedAt: createdAt,
						organizationId: "org-test",
						agentProfileId,
						memberProfileId,
						nextCursor: null,
						sessions:
							archived === (archivedAt !== null)
								? [
										{
											spaceId,
											organizationId: "org-test",
											agentProfileId,
											memberProfileId,
											name: "Review the change",
											createdAt,
											archivedAt,
											messagePreview: null,
										},
									]
								: [],
					})
				);
			}
			if (
				url.pathname === `${sessionPath}/${spaceId}` &&
				request.method === "PATCH"
			) {
				const update = updateAgentDirectMessageSessionBodySchema.parse(
					await request.json()
				);
				operations.push(update.operation);
				archivedAt = update.operation === "archive" ? createdAt : null;
				return Response.json(
					updateAgentDirectMessageSessionResponseSchema.parse({
						spaceId,
						organizationId: "org-test",
						name: "Review the change",
						archivedAt,
					})
				);
			}
			throw new Error(
				`Unexpected API request: ${request.method} ${url.pathname}`
			);
		})
	);
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const { result, unmount } = renderHook(
		() => ({
			archive: useMemberAgentSessionArchive(spaceId, agentProfileId),
			active: useQuery(
				agentDirectMessageSessionsQueryOptions({
					organizationId: "org-test",
					agentProfileId,
					archived: false,
					enabled: true,
				})
			),
			archived: useQuery(
				agentDirectMessageSessionsQueryOptions({
					organizationId: "org-test",
					agentProfileId,
					archived: true,
					enabled: true,
				})
			),
		}),
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={queryClient}>
					{children}
				</QueryClientProvider>
			),
		}
	);
	try {
		await waitFor(() => {
			expect(result.current.archive.disabled).toBe(false);
			expect(
				result.current.active.data?.sessions.map((session) => session.spaceId)
			).toEqual([spaceId]);
			expect(result.current.archived.data?.sessions).toEqual([]);
		});
		expect(result.current.archive.label).toBe("Archive conversation");
		await act(async () => {
			expect(await result.current.archive.toggle()).toBe(true);
		});
		await waitFor(() => {
			expect(result.current.archive.label).toBe("Unarchive conversation");
			expect(result.current.active.data?.sessions).toEqual([]);
			expect(
				result.current.archived.data?.sessions.map((session) => session.spaceId)
			).toEqual([spaceId]);
		});
		await act(async () => {
			expect(await result.current.archive.toggle()).toBe(true);
		});
		await waitFor(() => {
			expect(result.current.archive.label).toBe("Archive conversation");
			expect(
				result.current.active.data?.sessions.map((session) => session.spaceId)
			).toEqual([spaceId]);
			expect(result.current.archived.data?.sessions).toEqual([]);
		});
		expect(operations).toEqual(["archive", "unarchive"]);
		expect(navigate).toHaveBeenCalledTimes(1);
	} finally {
		unmount();
		queryClient.clear();
	}
});
