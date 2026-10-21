import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountSidebarQueryKey } from "#/query/account/sidebar-preferences";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import type { BrowserQueryPersistenceController } from "#/query/persistence/browser-query-persistence";
import { startQueryKeys } from "#/query/query-keys";
import { spaceEntryResolutionQueryOptions } from "#/query/spaces/entry-resolution";
import { spaceQueryKeys } from "#/query/spaces/status";
import { spaceThreadSignalsQueryOptions } from "#/query/spaces/threads";
import {
	prefetchAgentsRouteIdentityData,
	prefetchCenterAgentConversationData,
	prefetchKnownSpaceConversationData,
	prefetchPeopleRouteData,
	prefetchPluginsRouteData,
	prefetchSpaceConversationRouteData,
	prefetchSpacesRouteData,
	restoreSpaceConversationRouteData,
} from "./app-route-prefetch";

const readAccountContextMock = vi.hoisted(() => vi.fn());
const listPluginProvidersMock = vi.hoisted(() => vi.fn());
const listPluginConnectionsMock = vi.hoisted(() => vi.fn());
vi.mock("#/lib/organizations/connector-connections", () => ({
	listCurrentOrganizationConnectorAppCatalog: listPluginProvidersMock,
	listCurrentOrganizationAppConnections: listPluginConnectionsMock,
}));
const listStartProfilesMock = vi.hoisted(() => vi.fn());
const readOrganizationProfileDirectoryMock = vi.hoisted(() => vi.fn());
const readOrganizationAgentRuntimeOverviewMock = vi.hoisted(() => vi.fn());
const readAccountSidebarMock = vi.hoisted(() => vi.fn());
const listOrganizationSpacesMock = vi.hoisted(() => vi.fn());
const getBootstrapMock = vi.hoisted(() => vi.fn());
const getStatusMock = vi.hoisted(() => vi.fn());
const resolveEntryMock = vi.hoisted(() => vi.fn());
const listSignalEnvelopesMock = vi.hoisted(() => vi.fn());
const createWebSpaceApiMock = vi.hoisted(() => vi.fn());
const readThreadSelectionMock = vi.hoisted(() => vi.fn());
vi.mock("#/lib/spaces/thread-panel-storage", () => ({
	readSpaceThreadPanelSelection: readThreadSelectionMock,
}));
const openCurrentCenterAgentDirectMessageSpaceMock = vi.hoisted(() => vi.fn());
const readCurrentCenterAgentDirectMessageSpaceProjectionMock = vi.hoisted(() =>
	vi.fn()
);
let queryPersistence: BrowserQueryPersistenceController;

vi.mock("#/lib/organizations/account-organization-context", () => ({
	readCurrentAccountOrganizationContext: readAccountContextMock,
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

vi.mock("#/query/account/sidebar-preferences", () => ({
	accountSidebarQueryKey: (profileId: string, organizationId: string) => [
		"account-sidebar",
		profileId,
		organizationId,
	],
	accountSidebarQueryOptions: (profileId: string, organizationId: string) => ({
		queryKey: ["account-sidebar", profileId, organizationId],
		queryFn: readAccountSidebarMock,
		staleTime: 30_000,
	}),
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
	currentUserId: "user-1",
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
		readThreadSelectionMock.mockReturnValue(null);
		readAccountContextMock.mockResolvedValue({
			account: authorizedScope.account,
			currentUserId: authorizedScope.currentUserId,
			organizations: authorizedScope.organizations,
			defaultOrganizationId: authorizedScope.activeOrganization.id,
		});
		listStartProfilesMock.mockResolvedValue([humanProfile]);
		readOrganizationProfileDirectoryMock.mockResolvedValue(
			organizationProfileDirectory
		);
		readAccountSidebarMock.mockResolvedValue({
			ok: true,
			preferences: {
				pinned: { sort: "priority", spaceIds: [] },
				spaces: { sort: "priority", spaceIds: [] },
				groups: [],
			},
			revision: 1,
		});
		readOrganizationAgentRuntimeOverviewMock.mockResolvedValue(
			organizationAgentRuntimeOverview
		);
		listOrganizationSpacesMock.mockResolvedValue(organizationSpaces);
		getBootstrapMock.mockResolvedValue(createBootstrapResponse());
		getStatusMock.mockResolvedValue(createBootstrapResponse().status);
		resolveEntryMock.mockResolvedValue({
			target: { spaceId: "space-1" },
			view: { state: "allowed", experience: "member" },
			participation: { state: "active_member" },
			safeContext: { organizationId: "org-acme" },
			recovery: null,
		});
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
			resolveEntry: resolveEntryMock,
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
			queryClient.getQueryData(accountSidebarQueryKey("user-1", "org-acme"))
		).toEqual(expect.objectContaining({ revision: 1 }));
		expect(
			queryClient.getQueryData(
				organizationQueryKeys.agentRuntimeOverview("org-acme")
			)
		).toBeUndefined();
	});

	it("warms People and personal sidebar preferences without loading runtime status", async () => {
		const queryClient = createQueryClient();
		await prefetchPeopleRouteData({
			organizationSlug: "acme",
			queryClient,
			queryPersistence,
			routeFamily: "/o/acme/people",
		});
		expect(
			queryClient.getQueryData(
				organizationQueryKeys.profileDirectory("org-acme")
			)
		).toEqual(organizationProfileDirectory);
		expect(
			queryClient.getQueryData(accountSidebarQueryKey("user-1", "org-acme"))
		).toEqual(expect.objectContaining({ revision: 1 }));
		expect(
			queryClient.getQueryData(
				organizationQueryKeys.agentRuntimeOverview("org-acme")
			)
		).toBeUndefined();
	});

	it("starts both Plugin reads together and reuses in-flight requests", async () => {
		const queryClient = createQueryClient();
		let releaseProviders!: (value: {
			providers: [];
			organizationId: string;
		}) => void;
		listPluginProvidersMock.mockReturnValue(
			new Promise((resolve) => {
				releaseProviders = resolve;
			})
		);
		listPluginConnectionsMock.mockResolvedValue({
			connections: [],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});
		const input = {
			organizationSlug: "acme",
			queryClient,
			queryPersistence,
			routeFamily: "/o/acme/plugins",
		};
		const first = prefetchPluginsRouteData(input);
		await vi.waitFor(() =>
			expect(listPluginConnectionsMock).toHaveBeenCalledOnce()
		);
		expect(listPluginProvidersMock).toHaveBeenCalledOnce();
		const second = prefetchPluginsRouteData(input);
		releaseProviders({ providers: [], organizationId: "org-acme" });
		await Promise.all([first, second]);
		expect(listPluginProvidersMock).toHaveBeenCalledOnce();
		expect(listPluginConnectionsMock).toHaveBeenCalledOnce();
		queryClient.clear();
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

	it.each([
		"human-1",
		undefined,
	])("warms the conversation with an explicit or resolved default viewer: %s", async (profileId) => {
		const queryClient = createQueryClient();

		await prefetchSpaceConversationRouteData({
			organizationSlug: "acme",
			profileId,
			queryClient,
			queryPersistence,
			routeFamily: "/o/acme/spaces/space-1?profileId=human-1",
			spaceId: "space-1",
		});

		expect(
			queryClient.getQueryData(spaceQueryKeys.bootstrap("space-1", "human-1"))
		).toMatchObject({ status: { spaceId: "space-1" } });
		expect(getBootstrapMock).toHaveBeenCalledTimes(1);
		// A cold click consumes the same fresh gate result without a second read,
		// even though no persisted conversation display snapshot exists yet.
		expect(
			queryClient.getQueryData(
				spaceQueryKeys.displaySnapshot("space-1", "human-1")
			)
		).toBeUndefined();
		const entry = await queryClient.fetchQuery(
			spaceEntryResolutionQueryOptions({
				enabled: true,
				spaceId: "space-1",
				openMeldProfileId: "human-1",
			})
		);
		expect(entry.view.state).toBe("allowed");
		expect(resolveEntryMock).toHaveBeenCalledTimes(1);
		const entryOptions = spaceEntryResolutionQueryOptions({
			enabled: true,
			spaceId: "space-1",
			openMeldProfileId: "human-1",
		});
		await queryClient.invalidateQueries({
			queryKey: entryOptions.queryKey,
			refetchType: "none",
		});
		resolveEntryMock.mockResolvedValueOnce({
			...entry,
			view: { state: "unavailable" },
		});
		expect((await queryClient.fetchQuery(entryOptions)).view.state).toBe(
			"unavailable"
		);
		expect(resolveEntryMock).toHaveBeenCalledTimes(2);
		await queryClient.fetchQuery(
			spaceEntryResolutionQueryOptions({
				enabled: true,
				spaceId: "space-1",
				openMeldProfileId: "human-2",
			})
		);
		expect(resolveEntryMock).toHaveBeenCalledTimes(3);
		expect(getStatusMock).not.toHaveBeenCalled();
		expect(listSignalEnvelopesMock).not.toHaveBeenCalled();
		expect(
			queryClient.getQueryData(spaceQueryKeys.history("space-1", "human-1"))
		).toEqual({
			envelopes: [],
			nextCursor: null,
			confirmedCursor: null,
			personalHistoryDeletedAt: 0,
		});
		expect(queryPersistence.restoreSpaceConversation).toHaveBeenCalledWith({
			organizationId: "org-acme",
			organizationSlug: "acme",
			ownerAccountId: "user-1",
			queryClient,
			spaceId: "space-1",
			openMeldProfileId: "human-1",
		});
	});
	it("starts the restored Thread alongside a pending bootstrap and reuses its fresh result", async () => {
		const queryClient = createQueryClient();
		readThreadSelectionMock.mockReturnValue("thread-1");
		const listThreadSignals = vi
			.fn()
			.mockResolvedValue({ signals: [], placements: [] });
		createWebSpaceApiMock.mockReturnValue({
			getBootstrap: getBootstrapMock,
			resolveEntry: resolveEntryMock,
			listThreadSignals,
		});
		let completeBootstrap:
			| ((value: ReturnType<typeof createBootstrapResponse>) => void)
			| undefined;
		getBootstrapMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					completeBootstrap = resolve;
				})
		);
		const prefetch = prefetchKnownSpaceConversationData({
			organizationId: "org-acme",
			organizationSlug: "acme",
			ownerAccountId: "user-1",
			queryClient,
			queryPersistence,
			spaceId: "space-1",
			openMeldProfileId: "human-1",
		});
		await vi.waitFor(() => expect(listThreadSignals).toHaveBeenCalledTimes(1));
		expect(
			queryClient.getQueryData(spaceQueryKeys.bootstrap("space-1", "human-1"))
		).toBeUndefined();
		completeBootstrap?.(createBootstrapResponse());
		await prefetch;
		await queryClient.fetchQuery(
			spaceThreadSignalsQueryOptions({
				spaceId: "space-1",
				threadId: "thread-1",
				openMeldProfileId: "human-1",
				enabled: true,
			})
		);
		expect(listThreadSignals).toHaveBeenCalledTimes(1);
		queryClient.clear();
	});

	it.each([
		"cached",
		"cold",
	])("prefetches the explicit Thread instead of the saved Thread with a %s catalog", async (cacheState) => {
		const queryClient = createQueryClient();
		readThreadSelectionMock.mockReturnValue("previous-thread");
		const catalog = {
			threads: [
				{
					threadId: "thr_11111111-1111-4111-8111-111111111111",
					spaceId: "space-1",
					rootSignalId: "target-root",
					createdByProfileId: "human-1",
					createdAt: "2026-09-15T00:00:00Z",
					updatedAt: "2026-09-15T00:00:00Z",
				},
			],
			previews: [],
		};
		if (cacheState === "cached") {
			queryClient.setQueryData(
				spaceQueryKeys.threads("space-1", "human-1"),
				catalog
			);
		}
		const listThreads = vi.fn().mockResolvedValue(catalog);
		const listThreadSignals = vi
			.fn()
			.mockResolvedValue({ signals: [], placements: [] });
		let finishBootstrap!: (
			value: ReturnType<typeof createBootstrapResponse>
		) => void;
		getBootstrapMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					finishBootstrap = resolve;
				})
		);
		createWebSpaceApiMock.mockReturnValue({
			getBootstrap: getBootstrapMock,
			resolveEntry: resolveEntryMock,
			listThreads,
			listThreadSignals,
		});
		const prefetch = prefetchSpaceConversationRouteData({
			organizationSlug: "acme",
			profileId: "human-1",
			queryClient,
			queryPersistence,
			routeFamily: "/o/acme/spaces/space-1",
			spaceId: "space-1",
			focusThreadRootSignalId: "target-root",
		});
		await vi.waitFor(() =>
			expect(listThreadSignals).toHaveBeenCalledWith(
				expect.objectContaining({ threadId: catalog.threads[0].threadId })
			)
		);
		expect(listThreads).toHaveBeenCalledTimes(cacheState === "cold" ? 1 : 0);
		expect(
			queryClient.getQueryData(spaceQueryKeys.bootstrap("space-1", "human-1"))
		).toBeUndefined();
		finishBootstrap(createBootstrapResponse());
		await prefetch;
		queryClient.clear();
	});

	it("does not prefetch a saved Thread for an explicit main-message link", async () => {
		const queryClient = createQueryClient();
		readThreadSelectionMock.mockReturnValue("previous-thread");
		const listThreadSignals = vi.fn();
		const listThreads = vi
			.fn()
			.mockResolvedValue({ threads: [], previews: [] });
		createWebSpaceApiMock.mockReturnValue({
			getBootstrap: getBootstrapMock,
			resolveEntry: resolveEntryMock,
			listThreads,
			listThreadSignals,
		});
		await prefetchKnownSpaceConversationData({
			organizationId: "org-acme",
			organizationSlug: "acme",
			ownerAccountId: "user-1",
			queryClient,
			queryPersistence,
			spaceId: "space-1",
			openMeldProfileId: "human-1",
			focusSignalId: "main-message",
		});
		await vi.waitFor(() => expect(listThreads).toHaveBeenCalledTimes(1));
		expect(listThreadSignals).not.toHaveBeenCalled();
		expect(readThreadSelectionMock).not.toHaveBeenCalled();
		queryClient.clear();
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

		expect(queryPersistence.restoreSpaceConversation).toHaveBeenCalledWith({
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
		queryPersistence.restoreSpaceConversation = vi.fn(
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
			expect(queryPersistence.restoreSpaceConversation).toHaveBeenCalledTimes(
				1
			);
		});
		expect(getBootstrapMock).not.toHaveBeenCalled();
		// The access decision does not depend on saved display data, so its
		// request overlaps the restore.
		await vi.waitFor(() => expect(resolveEntryMock).toHaveBeenCalledTimes(1));

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

		expect(readAccountContextMock).not.toHaveBeenCalled();
		expect(listStartProfilesMock).not.toHaveBeenCalled();
		expect(queryPersistence.restoreSpaceConversation).toHaveBeenCalledTimes(1);
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
		expect(queryPersistence.restoreSpaceConversation).toHaveBeenCalledWith({
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
		expect(queryPersistence.restoreSpaceConversation).not.toHaveBeenCalled();
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
		restoreSpaceConversation: vi.fn(async () => undefined),
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
