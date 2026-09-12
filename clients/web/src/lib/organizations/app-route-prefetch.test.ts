import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import type { BrowserQueryPersistenceController } from "#/query/persistence/browser-query-persistence";
import { startQueryKeys } from "#/query/query-keys";
import { spaceQueryKeys } from "#/query/spaces/status";
import {
	prefetchAgentsRouteIdentityData,
	prefetchCenterAgentConversationData,
	prefetchKnownSpaceConversationData,
	prefetchSpaceConversationRouteData,
	prefetchSpacesRouteData,
	restoreSpaceConversationRouteData,
} from "./app-route-prefetch";

const resolveOrganizationScopeMock = vi.hoisted(() => vi.fn());
const listStartProfilesMock = vi.hoisted(() => vi.fn());
const readOrganizationProfileDirectoryMock = vi.hoisted(() => vi.fn());
const readOrganizationAgentRuntimeOverviewMock = vi.hoisted(() => vi.fn());
const listOrganizationSpacesMock = vi.hoisted(() => vi.fn());
const getBootstrapMock = vi.hoisted(() => vi.fn());
const getStatusMock = vi.hoisted(() => vi.fn());
const listSignalEnvelopesMock = vi.hoisted(() => vi.fn());
const createWebSpaceApiMock = vi.hoisted(() => vi.fn());
const openCurrentCenterAgentDirectMessageSpaceMock = vi.hoisted(() => vi.fn());
const readCurrentCenterAgentDirectMessageSpaceProjectionMock = vi.hoisted(() =>
	vi.fn()
);
let queryPersistence: BrowserQueryPersistenceController;

vi.mock("#/lib/organizations/organization-scope", () => ({
	resolveOrganizationScope: resolveOrganizationScopeMock,
}));

vi.mock("#/lib/profiles/existing-profiles", () => ({
	listStartProfiles: listStartProfilesMock,
}));

vi.mock("#/lib/organizations/organization-directory", () => ({
	readCurrentOrganizationAgentRuntimeOverview:
		readOrganizationAgentRuntimeOverviewMock,
	readCurrentOrganizationProfileDirectory: readOrganizationProfileDirectoryMock,
}));

vi.mock("#/lib/organizations/organization-spaces", () => ({
	listCurrentOrganizationSpaces: listOrganizationSpacesMock,
}));

vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: createWebSpaceApiMock,
}));

vi.mock("#/lib/organizations/center-agent", async () => {
	const actual = await vi.importActual<
		typeof import("#/lib/organizations/center-agent")
	>("#/lib/organizations/center-agent");
	return {
		...actual,
		openCurrentCenterAgentDirectMessageSpace:
			openCurrentCenterAgentDirectMessageSpaceMock,
		readCurrentCenterAgentDirectMessageSpaceProjection:
			readCurrentCenterAgentDirectMessageSpaceProjectionMock,
	};
});

const authorizedScope = {
	access: "authorized" as const,
	account: { email: "felix@example.com", image: null, name: "Felix" },
	activeOrganization: {
		id: "org-acme",
		isPersonal: false,
		name: "Acme",
		slug: "acme",
	},
	currentOrganization: {
		id: "org-acme",
		isPersonal: false,
		name: "Acme",
		slug: "acme",
	},
	organizations: [{ id: "org-acme", name: "Acme", slug: "acme" }],
	storageScope: "user-1",
};

const humanProfile = {
	createdAt: "2026-01-01T00:00:00.000Z",
	createdByUserId: "user-1",
	creatorProfileId: null,
	isDefault: true,
	lastUsedAt: null,
	managedRole: null,
	ownerName: "Felix",
	ownerUserId: "user-1",
	profileHandle: "felix",
	profileKind: "human" as const,
	profileName: "Felix",
	source: "manual",
	status: "active" as const,
	updatedAt: "2026-01-01T00:00:00.000Z",
	openMeldProfileId: "human-1",
};

const organizationProfileDirectory = {
	agentProfiles: [],
	generatedAt: "2026-07-16T00:00:00.000Z",
	members: [],
	organizationId: "org-acme",
};

const organizationAgentRuntimeOverview = {
	agentProfiles: [],
	generatedAt: "2026-07-16T00:00:00.000Z",
	organizationId: "org-acme",
};

const organizationSpaces = {
	generatedAt: "2026-07-16T00:00:00.000Z",
	organizationId: "org-acme",
	spaces: [],
};

describe("organization app route prefetch", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resolveOrganizationScopeMock.mockResolvedValue(authorizedScope);
		listStartProfilesMock.mockResolvedValue([humanProfile]);
		readOrganizationProfileDirectoryMock.mockResolvedValue(
			organizationProfileDirectory
		);
		readOrganizationAgentRuntimeOverviewMock.mockResolvedValue(
			organizationAgentRuntimeOverview
		);
		listOrganizationSpacesMock.mockResolvedValue(organizationSpaces);
		getBootstrapMock.mockResolvedValue(createBootstrapResponse());
		getStatusMock.mockResolvedValue(createBootstrapResponse().status);
		listSignalEnvelopesMock.mockResolvedValue({
			envelopes: [],
			nextCursor: null,
		});
		readCurrentCenterAgentDirectMessageSpaceProjectionMock.mockResolvedValue({
			generatedAt: "2026-08-10T00:00:00.000Z",
			organizationId: "org-acme",
			projection: {
				centerAgentProfileId: "agent-center",
				isCenterAgentDirectMessageSpace: true,
				kind: "center_agent_direct_message_space",
				memberProfileId: "human-1",
				organizationId: "org-acme",
				spaceId: "space-center-agent",
			},
		});
		createWebSpaceApiMock.mockReturnValue({
			getBootstrap: getBootstrapMock,
			getStatus: getStatusMock,
			listSignalEnvelopes: listSignalEnvelopesMock,
		});
		queryPersistence = createQueryPersistenceMock();
	});

	it("warms Agent identities without blocking navigation on runtime status", async () => {
		const queryClient = createQueryClient();

		await prefetchAgentsRouteIdentityData({
			organizationSlug: "acme",
			queryClient,
			queryPersistence,
			routeFamily: "/o/acme/agents",
		});

		expect(
			queryClient.getQueryData(startQueryKeys.profilesForStorageScope("user-1"))
		).toEqual([humanProfile]);
		expect(
			queryClient.getQueryData(
				organizationQueryKeys.profileDirectory("org-acme")
			)
		).toEqual(organizationProfileDirectory);
		expect(
			queryClient.getQueryData(
				organizationQueryKeys.agentRuntimeOverview("org-acme")
			)
		).toBeUndefined();
	});

	it("warms the Spaces list and account profiles in parallel", async () => {
		const queryClient = createQueryClient();

		await prefetchSpacesRouteData({
			organizationSlug: "acme",
			queryClient,
			queryPersistence,
			routeFamily: "/o/acme/spaces",
		});

		expect(
			queryClient.getQueryData(startQueryKeys.profilesForStorageScope("user-1"))
		).toEqual([humanProfile]);
		expect(
			queryClient.getQueryData(organizationQueryKeys.spaces("org-acme"))
		).toEqual(organizationSpaces);
		expect(queryPersistence.activateAuthorizedScope).toHaveBeenCalledWith({
			organizationId: "org-acme",
			organizationSlug: "acme",
			ownerAccountId: "user-1",
			queryClient,
		});
		expect(
			vi.mocked(queryPersistence.activateAuthorizedScope).mock
				.invocationCallOrder[0]
		).toBeLessThan(listOrganizationSpacesMock.mock.invocationCallOrder[0] ?? 0);
	});

	it("restores the Space display cache and warms one complete bootstrap", async () => {
		const queryClient = createQueryClient();

		await prefetchSpaceConversationRouteData({
			organizationSlug: "acme",
			profileId: "human-1",
			queryClient,
			queryPersistence,
			routeFamily: "/o/acme/spaces/space-1?profileId=human-1",
			spaceId: "space-1",
		});

		expect(
			queryClient.getQueryData(spaceQueryKeys.bootstrap("space-1", "human-1"))
		).toMatchObject({ status: { spaceId: "space-1" } });
		expect(getBootstrapMock).toHaveBeenCalledTimes(1);
		expect(getStatusMock).not.toHaveBeenCalled();
		expect(listSignalEnvelopesMock).not.toHaveBeenCalled();
		expect(
			queryClient.getQueryData(spaceQueryKeys.history("space-1", "human-1"))
		).toEqual({ envelopes: [], nextCursor: null });
		expect(queryPersistence.activateSpaceConversation).toHaveBeenCalledWith({
			organizationId: "org-acme",
			organizationSlug: "acme",
			ownerAccountId: "user-1",
			queryClient,
			spaceId: "space-1",
			openMeldProfileId: "human-1",
		});
	});

	it("restores a known Space cache before starting any current server read", async () => {
		const queryClient = createQueryClient();

		await restoreSpaceConversationRouteData({
			organizationSlug: "acme",
			profileId: "human-1",
			queryClient,
			queryPersistence,
			routeFamily: "/o/acme/spaces/space-1?profileId=human-1",
			spaceId: "space-1",
		});

		expect(queryPersistence.activateSpaceConversation).toHaveBeenCalledWith({
			organizationId: "org-acme",
			organizationSlug: "acme",
			ownerAccountId: "user-1",
			queryClient,
			spaceId: "space-1",
			openMeldProfileId: "human-1",
		});
		expect(listStartProfilesMock).not.toHaveBeenCalled();
		expect(getBootstrapMock).not.toHaveBeenCalled();
		expect(getStatusMock).not.toHaveBeenCalled();
		expect(listSignalEnvelopesMock).not.toHaveBeenCalled();
	});

	it("starts the current bootstrap only after the saved conversation is restored", async () => {
		const queryClient = createQueryClient();
		let finishRestore: (() => void) | undefined;
		queryPersistence.activateSpaceConversation = vi.fn(
			async () =>
				await new Promise<void>((resolve) => {
					finishRestore = resolve;
				})
		);

		const prefetch = prefetchSpaceConversationRouteData({
			organizationSlug: "acme",
			profileId: "human-1",
			queryClient,
			queryPersistence,
			routeFamily: "/o/acme/spaces/space-1?profileId=human-1",
			spaceId: "space-1",
		});

		await vi.waitFor(() => {
			expect(queryPersistence.activateSpaceConversation).toHaveBeenCalledTimes(
				1
			);
		});
		expect(getBootstrapMock).not.toHaveBeenCalled();

		finishRestore?.();
		await prefetch;

		expect(getBootstrapMock).toHaveBeenCalledTimes(1);
		expect(listSignalEnvelopesMock).not.toHaveBeenCalled();
	});

	it("prefetches a known authorized conversation without waiting for route scope or profiles", async () => {
		const queryClient = createQueryClient();

		await prefetchKnownSpaceConversationData({
			organizationId: "org-acme",
			organizationSlug: "acme",
			ownerAccountId: "user-1",
			queryClient,
			queryPersistence,
			spaceId: "space-1",
			openMeldProfileId: "human-1",
		});

		expect(resolveOrganizationScopeMock).not.toHaveBeenCalled();
		expect(listStartProfilesMock).not.toHaveBeenCalled();
		expect(queryPersistence.activateSpaceConversation).toHaveBeenCalledTimes(1);
		expect(getBootstrapMock).toHaveBeenCalledTimes(1);
		expect(getStatusMock).not.toHaveBeenCalled();
		expect(listSignalEnvelopesMock).not.toHaveBeenCalled();
	});

	it("warms an existing Center Agent conversation through its read-only projection", async () => {
		const queryClient = createQueryClient();

		await prefetchCenterAgentConversationData({
			organizationId: "org-acme",
			organizationSlug: "acme",
			ownerAccountId: "user-1",
			queryClient,
			queryPersistence,
		});

		expect(
			readCurrentCenterAgentDirectMessageSpaceProjectionMock
		).toHaveBeenCalledOnce();
		expect(openCurrentCenterAgentDirectMessageSpaceMock).not.toHaveBeenCalled();
		expect(queryPersistence.activateSpaceConversation).toHaveBeenCalledWith({
			organizationId: "org-acme",
			organizationSlug: "acme",
			ownerAccountId: "user-1",
			queryClient,
			spaceId: "space-center-agent",
			openMeldProfileId: "human-1",
		});
		expect(getBootstrapMock).toHaveBeenCalledOnce();
		expect(getStatusMock).not.toHaveBeenCalled();
		expect(listSignalEnvelopesMock).not.toHaveBeenCalled();
	});

	it("never opens or creates a Center Agent conversation from hover prefetch", async () => {
		readCurrentCenterAgentDirectMessageSpaceProjectionMock.mockResolvedValueOnce(
			{
				generatedAt: "2026-08-10T00:00:00.000Z",
				organizationId: "org-acme",
				projection: null,
			}
		);
		const queryClient = createQueryClient();

		await prefetchCenterAgentConversationData({
			organizationId: "org-acme",
			organizationSlug: "acme",
			ownerAccountId: "user-1",
			queryClient,
			queryPersistence,
		});

		expect(openCurrentCenterAgentDirectMessageSpaceMock).not.toHaveBeenCalled();
		expect(queryPersistence.activateSpaceConversation).not.toHaveBeenCalled();
		expect(getBootstrapMock).not.toHaveBeenCalled();
		expect(getStatusMock).not.toHaveBeenCalled();
		expect(listSignalEnvelopesMock).not.toHaveBeenCalled();
	});
});

function createQueryClient() {
	return new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
}

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

function createBootstrapResponse() {
	return {
		history: { nextCursor: null, signals: [] },
		members: {
			agents: [],
			generatedAt: "2026-07-16T00:00:00.000Z",
			humans: [],
			spaceId: "space-1",
			summary: {
				agentCount: 0,
				humanCount: 0,
				liveNowCount: 0,
				totalCount: 0,
			},
		},
		status: {
			accessMode: "public",
			allowedActions: ["post_message", "post_status", "stay_silent"],
			dispatchBrief: "default",
			dispatchPolicy: { mode: "mention_only" },
			entryBrief: "default",
			generatedAt: "2026-07-16T00:00:00.000Z",
			members: {
				agentCount: 0,
				humanCount: 0,
				liveAgentCount: 0,
				liveHumanCount: 0,
				liveNowCount: 0,
				totalCount: 0,
			},
			name: "Design Room",
			passwordProtected: false,
			publicationMode: "collaboration",
			resultArchivePolicy: { mode: "all_final_results" },
			spaceId: "space-1",
		},
		threads: { previews: [], threads: [] },
	};
}
