import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	openCurrentCenterAgentDirectMessageSpace,
	readCurrentCenterAgentDirectMessageSpaceProjection,
} from "#/lib/organizations/center-agent";
import { resolveOrganizationScope } from "#/lib/organizations/organization-scope";
import { listStartProfiles } from "#/lib/profiles/existing-profiles";
import { organizationScopeQueryKeys } from "#/query/organizations/organization-scope";
import { Route } from "../../routes/o/$orgSlug/_center-agent/chats.center-agent";
import {
	loadCenterAgentDirectMessageRouteData,
	loadCenterAgentRouteData,
	readCachedCenterAgentDirectMessageRouteData,
} from "./center-agent-route-loader";

vi.mock("#/lib/organizations/organization-scope", () => ({
	resolveOrganizationScope: vi.fn(),
}));

vi.mock("#/lib/profiles/existing-profiles", () => ({
	listStartProfiles: vi.fn(),
}));

vi.mock("#/lib/organizations/center-agent", async () => {
	const actual = await vi.importActual<
		typeof import("#/lib/organizations/center-agent")
	>("#/lib/organizations/center-agent");
	return {
		...actual,
		openCurrentCenterAgentDirectMessageSpace: vi.fn(),
		readCurrentCenterAgentDirectMessageSpaceProjection: vi.fn(),
	};
});

const authorizedScope = {
	access: "authorized" as const,
	account: {
		email: "felix@example.com",
		image: null,
		name: "Felix",
	},
	activeOrganization: {
		id: "org-acme",
		name: "Acme",
		slug: "acme",
	},
	currentOrganization: {
		id: "org-acme",
		name: "Acme",
		slug: "acme",
	},
	organizations: [
		{
			id: "org-acme",
			name: "Acme",
			slug: "acme",
		},
	],
	currentUserId: "user-1",
	storageScope: "user-1",
};

const directMessage = {
	centerAgentProfileId: "agt-center-agent",
	created: false,
	memberProfileId: "human-1",
	organizationId: "org-acme",
	spaceId: "space-ca-dm",
};

describe("loadCenterAgentRouteData", () => {
	beforeEach(() => {
		vi.mocked(resolveOrganizationScope)
			.mockReset()
			.mockResolvedValue(authorizedScope);
		vi.mocked(openCurrentCenterAgentDirectMessageSpace)
			.mockReset()
			.mockResolvedValue(directMessage);
		vi.mocked(readCurrentCenterAgentDirectMessageSpaceProjection)
			.mockReset()
			.mockResolvedValue({
				generatedAt: "2026-07-16T03:20:00.000Z",
				organizationId: "org-acme",
				projection: {
					centerAgentProfileId: directMessage.centerAgentProfileId,
					isCenterAgentDirectMessageSpace: true,
					kind: "center_agent_direct_message_space",
					memberProfileId: directMessage.memberProfileId,
					organizationId: directMessage.organizationId,
					spaceId: directMessage.spaceId,
				},
			});
		vi.mocked(listStartProfiles).mockReset().mockResolvedValue([]);
	});

	it("resolves an existing Center Agent DM through the safe projection", async () => {
		const queryClient = createQueryClient();

		const first = await loadCenterAgentRouteData({
			organizationSlug: "acme",
			queryClient,
			routeFamily: "/o/acme",
			shouldOpenDirectMessage: true,
		});
		const second = await loadCenterAgentRouteData({
			organizationSlug: "acme",
			queryClient,
			routeFamily: "/o/acme",
			shouldOpenDirectMessage: true,
		});

		expect(first).toEqual({ directMessage, status: "ready" });
		expect(second).toEqual(first);
		expect(
			readCachedCenterAgentDirectMessageRouteData({
				organizationId: "org-acme",
				queryClient,
			})
		).toEqual(first);
		expect(
			readCurrentCenterAgentDirectMessageSpaceProjection
		).toHaveBeenCalledTimes(1);
		expect(openCurrentCenterAgentDirectMessageSpace).not.toHaveBeenCalled();
	});

	it("does not reuse the default chat cache for an exact session", async () => {
		const queryClient = createQueryClient();
		await loadCenterAgentDirectMessageRouteData({
			organizationId: "org-acme",
			queryClient,
		});
		vi.mocked(
			readCurrentCenterAgentDirectMessageSpaceProjection
		).mockResolvedValueOnce({
			generatedAt: "2026-07-16T03:20:00.000Z",
			organizationId: "org-acme",
			projection: {
				centerAgentProfileId: "agt-center-agent",
				memberProfileId: "human-1",
				organizationId: "org-acme",
				spaceId: "second-session",
				kind: "center_agent_direct_message_space",
				isCenterAgentDirectMessageSpace: true,
			},
		});
		const result = await loadCenterAgentDirectMessageRouteData({
			organizationId: "org-acme",
			queryClient,
			sessionId: "second-session",
		});
		expect(result).toMatchObject({
			status: "ready",
			directMessage: { spaceId: "second-session" },
		});
		expect(
			readCurrentCenterAgentDirectMessageSpaceProjection
		).toHaveBeenLastCalledWith(
			expect.objectContaining({ spaceId: "second-session" })
		);
		expect(openCurrentCenterAgentDirectMessageSpace).not.toHaveBeenCalled();
	});

	it.each([
		null,
		"wrong-session",
	])("fails an unavailable or mismatched selected session without opening another chat (%s)", async (returnedId) => {
		vi.mocked(
			readCurrentCenterAgentDirectMessageSpaceProjection
		).mockResolvedValueOnce({
			generatedAt: "2026-07-16T03:20:00.000Z",
			organizationId: "org-acme",
			projection:
				returnedId === null
					? null
					: {
							centerAgentProfileId: "agt-center-agent",
							memberProfileId: "human-1",
							organizationId: "org-acme",
							spaceId: returnedId,
							kind: "center_agent_direct_message_space",
							isCenterAgentDirectMessageSpace: true,
						},
		});
		const result = await loadCenterAgentDirectMessageRouteData({
			organizationId: "org-acme",
			queryClient: createQueryClient(),
			sessionId: "selected-session",
		});
		expect(result?.status).toBe("error");
		expect(openCurrentCenterAgentDirectMessageSpace).not.toHaveBeenCalled();
	});

	it("falls back to the idempotent open only when no projection exists", async () => {
		vi.mocked(
			readCurrentCenterAgentDirectMessageSpaceProjection
		).mockResolvedValueOnce({
			generatedAt: "2026-07-16T03:20:00.000Z",
			organizationId: "org-acme",
			projection: null,
		});

		const result = await loadCenterAgentRouteData({
			organizationSlug: "acme",
			queryClient: createQueryClient(),
			routeFamily: "/o/acme",
			shouldOpenDirectMessage: true,
		});

		expect(result).toEqual({ directMessage, status: "ready" });
		expect(openCurrentCenterAgentDirectMessageSpace).toHaveBeenCalledOnce();
	});

	it("keeps route preload disabled so read-only preload data cannot render as the page", () => {
		expect(Route.options.preload).toBe(false);
	});

	it("does not resolve or create a DM before an OAuth callback redirects", async () => {
		const queryClient = createQueryClient();

		const result = await loadCenterAgentRouteData({
			organizationSlug: "acme",
			queryClient,
			routeFamily: "/o/acme/center-agent?slack_oauth=connected",
			shouldOpenDirectMessage: false,
		});

		expect(result).toBeNull();
		expect(resolveOrganizationScope).not.toHaveBeenCalled();
		expect(openCurrentCenterAgentDirectMessageSpace).not.toHaveBeenCalled();
	});

	it("opens the URL organization's DM when the Session default differs", async () => {
		const queryClient = createQueryClient();
		vi.mocked(resolveOrganizationScope).mockResolvedValueOnce({
			...authorizedScope,
			activeOrganization: {
				id: "org-beta",
				name: "Beta",
				slug: "beta",
			},
		});

		const result = await loadCenterAgentRouteData({
			organizationSlug: "acme",
			queryClient,
			routeFamily: "/o/acme",
			shouldOpenDirectMessage: true,
		});

		expect(result).toEqual({ directMessage, status: "ready" });
		expect(
			readCurrentCenterAgentDirectMessageSpaceProjection
		).toHaveBeenCalledOnce();
	});

	it("reuses the route-verified URL scope without a Session mutation", async () => {
		const queryClient = createQueryClient();
		queryClient.setQueryData(organizationScopeQueryKeys.bySlug("acme"), {
			...authorizedScope,
			activeOrganization: {
				id: "org-beta",
				name: "Beta",
				slug: "beta",
			},
		});

		const result = await loadCenterAgentRouteData({
			organizationSlug: "acme",
			queryClient,
			routeFamily: "/o/acme",
			shouldOpenDirectMessage: true,
		});

		expect(resolveOrganizationScope).not.toHaveBeenCalled();
		expect(result).toEqual({ directMessage, status: "ready" });
	});

	it("fails closed when the resolved DM belongs to another organization", async () => {
		vi.mocked(
			readCurrentCenterAgentDirectMessageSpaceProjection
		).mockResolvedValueOnce({
			generatedAt: "2026-07-16T03:20:00.000Z",
			organizationId: "org-acme",
			projection: null,
		});
		vi.mocked(openCurrentCenterAgentDirectMessageSpace).mockResolvedValueOnce({
			...directMessage,
			organizationId: "org-other",
		});

		const result = await loadCenterAgentRouteData({
			organizationSlug: "acme",
			queryClient: createQueryClient(),
			routeFamily: "/o/acme",
			shouldOpenDirectMessage: true,
		});

		expect(result).toEqual({
			error: expect.objectContaining({ code: "gateway.invalid_response" }),
			status: "error",
		});
	});
});

function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	});
}
