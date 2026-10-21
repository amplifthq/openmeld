import {
	authProfileViewSchema,
	organizationSpaceDirectoryWithMemberCountsResponseSchema,
} from "@openmeld/schemas";
import type { SignalEnvelope } from "@openmeld/schemas/types";
import { dehydrate, QueryClient } from "@tanstack/react-query";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
	beginSpaceOpen,
	installSpaceOpenReporting,
	markSpaceOpen,
} from "#/lib/observability/space-open";
import { accountSidebarQueryKey } from "#/query/account/sidebar-preferences";
import { computerFileAccessQueryKeys } from "#/query/connect/computer-file-access";
import { createCurrentComputerToolbarDisplaySnapshot } from "#/query/connect/current-computer-toolbar-display-snapshot";
import { centerAgentQueryKeys } from "#/query/organizations/center-agent";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { organizationPluginConnectionQueryKeys } from "#/query/organizations/plugin-connections";
import { startQueryKeys } from "#/query/query-keys";
import { spaceConversationDisplaySnapshotSchema } from "#/query/spaces/display-snapshot";
import { spaceHeaderTitleDisplayQueryKey } from "#/query/spaces/header-title-display";
import { spaceQueryKeys } from "#/query/spaces/status";
import {
	accountMemberSpacesDisplayQueryKey,
	spaceViewerMembershipDisplayQueryKey,
} from "#/query/spaces/viewer-membership-display";
import {
	BROWSER_QUERY_CACHE_BUSTER,
	buildSpaceConversationQueryCacheScopeId,
	createBrowserQueryPersistenceController,
	mergePersistedBrowserViews,
	type QueryPersistenceDiagnostic,
} from "./browser-query-persistence";
import {
	type AsyncStringStorage,
	createDexieQueryCacheStore,
	type DexieQueryCacheStore,
} from "./dexie-query-cache-store";

const stores: DexieQueryCacheStore[] = [];

afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(stores.splice(0).map((store) => store.deleteDatabase()));
});

describe("BrowserQueryPersistenceController", () => {
	it("merges saved older pages into an equally recent tab without replacing its newer message data", async () => {
		const store = createTestStore();
		const saved = createQueryClient();
		const current = createQueryClient();
		const key = spaceQueryKeys.history("space-a", "profile-a");
		const messages = Array.from({ length: 70 }, (_, i) => ({
			...createTextSignal(`signal-${i}`, "space-a", "profile-a"),
			ts: i + 1,
		}));
		saved.setQueryData(
			key,
			{ envelopes: messages, nextCursor: null },
			{ updatedAt: 100 }
		);
		current.setQueryData(
			key,
			{
				envelopes: [
					{ ...messages[69], data: { text: "Current tab revision" } },
				],
				nextCursor: null,
			},
			{ updatedAt: 100 }
		);
		await store
			.createStorage({
				ownerAccountId: "account-a",
				organizationId: "organization-a",
				scopeAlias: "organization-a",
				scopeKind: "space",
				scopeId: buildSpaceConversationQueryCacheScopeId(
					"space-a",
					"profile-a"
				),
			})
			.setItem(
				"tanstack-query-cache",
				JSON.stringify({
					buster: BROWSER_QUERY_CACHE_BUSTER,
					timestamp: Date.now(),
					clientState: dehydrate(saved),
				})
			);
		const controller = createBrowserQueryPersistenceController({
			store,
			restoreBudgetMs: 100,
			throttleTimeMs: 0,
		});
		const scope = {
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: current,
		};
		await controller.activateAuthorizedScope(scope);
		await controller.activateSpaceConversation({
			...scope,
			spaceId: "space-a",
			openMeldProfileId: "profile-a",
		});
		const result = current.getQueryData<{ envelopes: SignalEnvelope[] }>(key);
		expect(result?.envelopes).toHaveLength(70);
		expect(result?.envelopes.at(-1)?.data).toEqual({
			text: "Current tab revision",
		});
		expect(current.getQueryState(key)?.dataUpdatedAt).toBe(100);
		controller.deactivate();
	});
	it("retains loaded older pages across two tab writes, keeping the newer duplicate message", () => {
		const key = spaceQueryKeys.history("space-a", "profile-a");
		const oldTab = createQueryClient();
		const newTab = createQueryClient();
		const messages = Array.from({ length: 90 }, (_, index) => ({
			...createTextSignal(`message-${index}`, "space-a", "profile-a"),
			ts: index + 1,
		}));
		oldTab.setQueryData(
			key,
			{
				envelopes: messages,
				nextCursor: "older-page",
				confirmedCursor: "removed-anchor",
			},
			{ updatedAt: 10 }
		);
		newTab.setQueryData(
			key,
			{
				envelopes: [{ ...messages[89], data: { text: "Updated message" } }],
				nextCursor: null,
				confirmedCursor: "message-89",
			},
			{ updatedAt: 20 }
		);
		const pack = (client: QueryClient) =>
			JSON.stringify({
				buster: "browser-read-cache-v1",
				timestamp: Date.now(),
				clientState: dehydrate(client),
			});
		for (const [left, right] of [
			[oldTab, newTab],
			[newTab, oldTab],
		]) {
			const merged = JSON.parse(
				mergePersistedBrowserViews(pack(left), pack(right))
			);
			const history = merged.clientState.queries[0].state.data;
			expect(history.envelopes).toHaveLength(90);
			expect(history.envelopes[89].data.text).toBe("Updated message");
			expect(history.confirmedCursor).toBe("message-89");
		}
	});
	it("saves only when a query owned by that persistence segment changes", async () => {
		const accountSetItem = vi.fn(async () => undefined);
		const organizationSetItem = vi.fn(async () => undefined);
		const controller = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 100,
			store: {
				clearAccount: async () => undefined,
				clearAll: async () => undefined,
				clearOrganization: async () => undefined,
				clearOrganizationBySlug: async () => undefined,
				createStorage: (scope) => ({
					getItem: async () => null,
					removeItem: async () => undefined,
					setItem:
						scope.scopeKind === "account"
							? accountSetItem
							: organizationSetItem,
				}),
			},
			throttleTimeMs: 0,
		});
		const queryClient = createQueryClient();

		await controller.activateAuthorizedScope({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient,
		});
		accountSetItem.mockClear();
		organizationSetItem.mockClear();

		queryClient.setQueryData(["unrelated", "query"], { value: true });
		queryClient.setQueryData(
			computerFileAccessQueryKeys.policy("account-a", "device-a", "dev-local"),
			{
				deviceId: "device-a",
				policy: {
					folders: ["/Users/felix/Private"],
					mode: "block_selected_folders",
					revision: 1,
					updatedAtMs: 1,
				},
			}
		);
		queryClient.setQueryData(
			startQueryKeys.currentComputerToolbarDisplaySnapshot("account-a"),
			{
				currentComputer: {
					attention: {
						reason: "agent_check_failed",
						tone: "warning",
					},
					deviceId: "device-a",
					privatePath: "/Users/felix/Private",
				},
				version: 1,
			}
		);
		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(accountSetItem).not.toHaveBeenCalled();
		expect(organizationSetItem).not.toHaveBeenCalled();

		queryClient.setQueryData(
			startQueryKeys.profilesForStorageScope("account-a"),
			[createProfileFixture("profile-a", "Felix")]
		);
		await vi.waitFor(() => expect(accountSetItem).toHaveBeenCalledTimes(1));
		expect(organizationSetItem).not.toHaveBeenCalled();
	});

	it("restores one bounded read-only Space conversation without persisting its bootstrap", async () => {
		const store = createTestStore();
		const sourceQueryClient = createQueryClient();
		const sourceController = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 100,
			store,
			throttleTimeMs: 0,
		});
		await sourceController.activateAuthorizedScope({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: sourceQueryClient,
		});
		await sourceController.activateSpaceConversation({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: sourceQueryClient,
			spaceId: "space-a",
			openMeldProfileId: "profile-a",
		});
		const history = {
			threadDisplay: {
				threads: [
					{
						threadId: "thr_11111111-1111-4111-8111-111111111111",
						spaceId: "space-a",
						rootSignalId: "signal-a",
						createdByProfileId: "11111111-1111-4111-8111-111111111111",
						createdAt: "2026-08-11T00:00:00.000Z",
						updatedAt: "2026-08-11T00:00:00.000Z",
					},
				],
				previews: [
					{
						threadId: "thr_11111111-1111-4111-8111-111111111111",
						replyCount: 3,
						signals: [createTextSignal("reply-a", "space-a", "profile-a")],
						placements: [],
					},
				],
			},
			envelopes: [
				{
					...createTextSignal("signal-a", "space-a", "profile-a"),
					reactions: {
						version: 2,
						groups: [
							{
								emoji: "👍",
								label: "thumbs up",
								count: 1,
								reactedByMe: true,
								actors: [
									{
										profileId: "profile-a",
										displayName: "Alex",
										profileKind: "human" as const,
									},
								],
								actorsHasMore: false,
							},
						],
					},
				},
			],
			nextCursor: "before-signal-a",
		};
		const displaySnapshot = {
			status: {
				spaceId: "space-a",
				generatedAt: "2026-08-11T00:00:00.000Z",
				name: "Launch",
				accessMode: "members_only",
				passwordProtected: false,
				dispatchPolicy: { mode: "mention_only" },
				publicationMode: "collaboration",
				resultArchivePolicy: { mode: "all_final_results" },
				entryBrief: "default",
				dispatchBrief: "default",
				members: {
					totalCount: 2,
					humanCount: 1,
					agentCount: 1,
					liveNowCount: 1,
					liveHumanCount: 1,
					liveAgentCount: 0,
				},
			},
			version: 1,
		};
		sourceQueryClient.setQueryData(
			["spaces", "display-snapshot", "space-a", "profile-a"],
			displaySnapshot
		);
		expect(
			spaceConversationDisplaySnapshotSchema.safeParse(displaySnapshot).success
		).toBe(true);
		const spaceStorage = store.createStorage({
			organizationId: "organization-a",
			ownerAccountId: "account-a",
			scopeAlias: "organization-a",
			scopeId: buildSpaceConversationQueryCacheScopeId("space-a", "profile-a"),
			scopeKind: "space",
		});
		await waitForStoredQuery(
			spaceStorage,
			spaceQueryKeys.displaySnapshot("space-a", "profile-a")
		);
		sourceQueryClient.setQueryData(
			spaceQueryKeys.history("space-a", "profile-a"),
			history
		);
		sourceQueryClient.setQueryData(
			spaceQueryKeys.bootstrap("space-a", "profile-a"),
			{ privateBootstrapValue: "must-not-persist" }
		);
		await waitForStoredQuery(
			spaceStorage,
			spaceQueryKeys.history("space-a", "profile-a")
		);
		const directory = {
			version: 1,
			members: [
				{
					profileId: "agent-a",
					profileName: "Runner",
					profileKind: "agent",
					primaryMentionLabel: "runner",
					avatarUrl: null,
					agentControllerRef: null,
				},
			],
		};
		sourceQueryClient.setQueryData(
			spaceQueryKeys.memberDirectoryDisplay("space-a", "profile-a"),
			directory
		);
		sourceQueryClient.setQueryData(
			spaceQueryKeys.members("space-a", "profile-a"),
			{ wakeAvailability: "ready" }
		);
		await waitForStoredQuery(
			spaceStorage,
			spaceQueryKeys.memberDirectoryDisplay("space-a", "profile-a")
		);
		const navigation = {
			entries: [
				{
					signalId: "signal-a",
					endSignalId: "signal-a",
					startAt: 1,
					endAt: 1,
					count: 1,
					author: "Alex",
					preview: "First message",
				},
			],
			total: 31,
		};
		sourceQueryClient.setQueryData(
			spaceQueryKeys.historyNavigation("space-a", "profile-a"),
			navigation
		);
		await waitForStoredQuery(
			spaceStorage,
			spaceQueryKeys.historyNavigation("space-a", "profile-a")
		);
		const membership = { version: 1, membership: "member" };
		sourceQueryClient.setQueryData(
			spaceViewerMembershipDisplayQueryKey("space-a", "profile-a"),
			membership
		);
		await waitForStoredQuery(
			spaceStorage,
			spaceViewerMembershipDisplayQueryKey("space-a", "profile-a")
		);
		const headerTitle = { version: 1, title: "New chat" };
		sourceQueryClient.setQueryData(
			spaceHeaderTitleDisplayQueryKey("space-a", "profile-a"),
			headerTitle
		);
		await waitForStoredQuery(
			spaceStorage,
			spaceHeaderTitleDisplayQueryKey("space-a", "profile-a")
		);

		await sourceController.activateSpaceConversation({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: sourceQueryClient,
			spaceId: "space-a",
			openMeldProfileId: "profile-b",
		});
		const profileBHistory = {
			envelopes: [createTextSignal("signal-b", "space-a", "profile-b")],
			nextCursor: null,
		};
		sourceQueryClient.setQueryData(
			spaceQueryKeys.history("space-a", "profile-b"),
			profileBHistory
		);
		await waitForStoredQuery(
			store.createStorage({
				organizationId: "organization-a",
				ownerAccountId: "account-a",
				scopeAlias: "organization-a",
				scopeId: buildSpaceConversationQueryCacheScopeId(
					"space-a",
					"profile-b"
				),
				scopeKind: "space",
			}),
			spaceQueryKeys.history("space-a", "profile-b")
		);
		sourceController.deactivate();

		const restoredQueryClient = createQueryClient();
		const openingReports = vi.fn();
		onTestFinished(installSpaceOpenReporting(openingReports));
		beginSpaceOpen("/spaces/space-a", "navigation");
		const restoredController = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 100,
			store,
			throttleTimeMs: 0,
		});
		await restoredController.activateAuthorizedScope({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: restoredQueryClient,
		});
		await restoredController.activateSpaceConversation({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: restoredQueryClient,
			spaceId: "space-a",
			openMeldProfileId: "profile-a",
		});

		expect(
			restoredQueryClient.getQueryData(
				spaceQueryKeys.history("space-a", "profile-a")
			)
		).toEqual(history);
		expect(
			restoredQueryClient.getQueryData([
				"spaces",
				"display-snapshot",
				"space-a",
				"profile-a",
			])
		).toEqual(displaySnapshot);
		markSpaceOpen("space-a", "denied");
		expect(openingReports).toHaveBeenLastCalledWith(
			expect.objectContaining({
				spaceOpen: expect.objectContaining({ cache: "restored" }),
			})
		);
		expect(
			restoredQueryClient.getQueryData(
				spaceQueryKeys.memberDirectoryDisplay("space-a", "profile-a")
			)
		).toEqual(directory);
		expect(
			restoredQueryClient.getQueryData(
				spaceQueryKeys.historyNavigation("space-a", "profile-a")
			)
		).toEqual(navigation);
		expect(
			restoredQueryClient.getQueryData(
				spaceViewerMembershipDisplayQueryKey("space-a", "profile-a")
			)
		).toEqual(membership);
		expect(
			restoredQueryClient.getQueryData(
				spaceHeaderTitleDisplayQueryKey("space-a", "profile-a")
			)
		).toEqual(headerTitle);
		expect(
			restoredQueryClient.getQueryData(
				spaceQueryKeys.members("space-a", "profile-a")
			)
		).toBeUndefined();
		expect(
			restoredQueryClient.getQueryData(
				spaceQueryKeys.historyNavigation("space-a", "profile-b")
			)
		).toBeUndefined();
		expect(
			restoredQueryClient.getQueryData(
				spaceQueryKeys.memberDirectoryDisplay("space-a", "profile-b")
			)
		).toBeUndefined();

		expect(
			restoredQueryClient.getQueryState(
				spaceQueryKeys.history("space-a", "profile-a")
			)?.isInvalidated
		).toBe(true);
		expect(
			restoredQueryClient.getQueryData(
				spaceQueryKeys.bootstrap("space-a", "profile-a")
			)
		).toBeUndefined();
		expect(
			restoredQueryClient.getQueryData(
				spaceQueryKeys.history("space-a", "profile-b")
			)
		).toBeUndefined();

		await restoredController.activateSpaceConversation({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: restoredQueryClient,
			spaceId: "space-a",
			openMeldProfileId: "profile-b",
		});
		expect(
			restoredQueryClient.getQueryData(
				spaceQueryKeys.history("space-a", "profile-b")
			)
		).toEqual(profileBHistory);
	});

	it("reads the saved Space view when its history directory is missing from memory", async () => {
		const store = createTestStore();
		const queryClient = createQueryClient();
		const controller = createBrowserQueryPersistenceController({
			restoreBudgetMs: 100,
			store,
		});
		const scope = {
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient,
		};
		await controller.activateAuthorizedScope(scope);
		queryClient.setQueryData(spaceQueryKeys.history("space-a", "profile-a"), {
			envelopes: [],
			nextCursor: null,
		});
		queryClient.setQueryData(
			spaceQueryKeys.displaySnapshot("space-a", "profile-a"),
			{ status: { spaceId: "space-a" } }
		);
		const createStorage = vi.spyOn(store, "createStorage");
		await controller.restoreSpaceConversation({
			...scope,
			spaceId: "space-a",
			openMeldProfileId: "profile-a",
		});
		expect(createStorage).toHaveBeenCalled();
		createStorage.mockClear();
		queryClient.setQueryData(
			spaceQueryKeys.historyNavigation("space-a", "profile-a"),
			{ entries: [], total: 0 }
		);
		await controller.restoreSpaceConversation({
			...scope,
			spaceId: "space-a",
			openMeldProfileId: "profile-a",
		});
		expect(createStorage).not.toHaveBeenCalled();
		controller.deactivate();
	});

	it("keeps saving the open Space while another Space is restored for prefetch", async () => {
		const store = createTestStore();
		const queryClient = createQueryClient();
		const controller = createBrowserQueryPersistenceController({
			restoreBudgetMs: 100,
			store,
			throttleTimeMs: 0,
		});
		const scope = {
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient,
		};
		await controller.activateAuthorizedScope(scope);
		await controller.activateSpaceConversation({
			...scope,
			spaceId: "space-a",
			openMeldProfileId: "profile-a",
		});
		await controller.restoreSpaceConversation({
			...scope,
			spaceId: "space-b",
			openMeldProfileId: "profile-a",
		});
		const historyKey = spaceQueryKeys.history("space-a", "profile-a");
		const history = {
			envelopes: [createTextSignal("new-message", "space-a", "profile-a")],
			nextCursor: null,
		};
		queryClient.setQueryData(historyKey, history);
		const storage = store.createStorage({
			organizationId: "organization-a",
			ownerAccountId: "account-a",
			scopeAlias: "organization-a",
			scopeId: buildSpaceConversationQueryCacheScopeId("space-a", "profile-a"),
			scopeKind: "space",
		});
		await waitForStoredQuery(storage, historyKey);
		const payload = JSON.parse(
			(await storage.getItem("tanstack-query-cache")) ?? "null"
		) as { clientState?: { queries?: unknown[] } };
		expect(payload.clientState?.queries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					queryKey: historyKey,
					state: expect.objectContaining({ data: history }),
				}),
			])
		);
		controller.deactivate();
	});

	it("saves the latest message snapshot once after a burst of updates", async () => {
		const store = createTestStore();
		const queryClient = createQueryClient();
		const record = vi.fn();
		const controller = createBrowserQueryPersistenceController({
			diagnostics: { record },
			restoreBudgetMs: 100,
			store,
			throttleTimeMs: 1000,
		});
		const scope = {
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient,
		};
		await controller.activateAuthorizedScope(scope);
		await controller.activateSpaceConversation({
			...scope,
			spaceId: "space-a",
			openMeldProfileId: "profile-a",
		});
		const storage = store.createStorage({
			organizationId: "organization-a",
			ownerAccountId: "account-a",
			scopeAlias: "organization-a",
			scopeId: buildSpaceConversationQueryCacheScopeId("space-a", "profile-a"),
			scopeKind: "space",
		});
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const historyKey = spaceQueryKeys.history("space-a", "profile-a");
		for (const signalId of ["first", "second", "latest"]) {
			queryClient.setQueryData(historyKey, {
				envelopes: [createTextSignal(signalId, "space-a", "profile-a")],
				nextCursor: null,
			});
		}
		expect(await storage.getItem("tanstack-query-cache")).toBeNull();
		await vi.advanceTimersByTimeAsync(1000);
		const payload = JSON.parse(
			(await storage.getItem("tanstack-query-cache")) ?? "null"
		) as { clientState?: { queries?: Array<{ state?: { data?: unknown } }> } };
		expect(payload.clientState?.queries?.[0]?.state?.data).toEqual({
			envelopes: [createTextSignal("latest", "space-a", "profile-a")],
			nextCursor: null,
		});
		expect(
			record.mock.calls.filter(
				([diagnostic]) => diagnostic.event === "save_preparation"
			)
		).toHaveLength(1);
		controller.deactivate();
	});

	it("switches Spaces without waiting for the previous Space's save, and clears only after it lands", async () => {
		const baseStore = createTestStore();
		const spaceAScopeId = buildSpaceConversationQueryCacheScopeId(
			"space-a",
			"profile-a"
		);
		let releaseWrite: (() => void) | undefined;
		const gatedSetItem = vi.fn();
		const store: DexieQueryCacheStore = {
			...baseStore,
			createStorage: (scope) => {
				const storage = baseStore.createStorage(scope);
				if (scope.scopeId !== spaceAScopeId) {
					return storage;
				}
				return {
					...storage,
					setItem: async (key, value) => {
						gatedSetItem();
						await new Promise<void>((resolve) => {
							releaseWrite = resolve;
						});
						await storage.setItem(key, value);
					},
				};
			},
		};
		const queryClient = createQueryClient();
		const controller = createBrowserQueryPersistenceController({
			restoreBudgetMs: 100,
			store,
			// Long enough that the switch, not the timer, flushes Space A.
			throttleTimeMs: 200,
		});
		const scope = {
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient,
		};
		await controller.activateAuthorizedScope(scope);
		await controller.activateSpaceConversation({
			...scope,
			spaceId: "space-a",
			openMeldProfileId: "profile-a",
		});
		queryClient.setQueryData(spaceQueryKeys.history("space-a", "profile-a"), {
			envelopes: [createTextSignal("pending", "space-a", "profile-a")],
			nextCursor: null,
		});
		await controller.activateSpaceConversation({
			...scope,
			spaceId: "space-b",
			openMeldProfileId: "profile-a",
		});
		// The outgoing snapshot was captured at the switch; its write is still
		// in flight while the next Space is already active.
		await vi.waitFor(() => expect(gatedSetItem).toHaveBeenCalledOnce());
		expect(releaseWrite).toBeDefined();
		const spaceBHistoryKey = spaceQueryKeys.history("space-b", "profile-a");
		queryClient.setQueryData(spaceBHistoryKey, {
			envelopes: [createTextSignal("next", "space-b", "profile-a")],
			nextCursor: null,
		});
		await waitForStoredQuery(
			baseStore.createStorage({
				organizationId: "organization-a",
				ownerAccountId: "account-a",
				scopeAlias: "organization-a",
				scopeId: buildSpaceConversationQueryCacheScopeId(
					"space-b",
					"profile-a"
				),
				scopeKind: "space",
			}),
			spaceBHistoryKey
		);
		let cleared = false;
		const clearing = controller.clearActiveAccount().then(() => {
			cleared = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(cleared).toBe(false);
		releaseWrite?.();
		await clearing;
		expect(
			await baseStore
				.createStorage({
					organizationId: "organization-a",
					ownerAccountId: "account-a",
					scopeAlias: "organization-a",
					scopeId: spaceAScopeId,
					scopeKind: "space",
				})
				.getItem("tanstack-query-cache")
		).toBeNull();
	});

	it("does not write a delayed Space snapshot after account cleanup", async () => {
		const store = createTestStore();
		const queryClient = createQueryClient();
		const controller = createBrowserQueryPersistenceController({
			restoreBudgetMs: 100,
			store,
			throttleTimeMs: 1000,
		});
		const scope = {
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient,
		};
		await controller.activateAuthorizedScope(scope);
		await controller.activateSpaceConversation({
			...scope,
			spaceId: "space-a",
			openMeldProfileId: "profile-a",
		});
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		queryClient.setQueryData(spaceQueryKeys.history("space-a", "profile-a"), {
			envelopes: [createTextSignal("private", "space-a", "profile-a")],
			nextCursor: null,
		});
		await controller.clearActiveAccount();
		await vi.advanceTimersByTimeAsync(1000);
		expect(
			await store
				.createStorage({
					organizationId: "organization-a",
					ownerAccountId: "account-a",
					scopeAlias: "organization-a",
					scopeId: buildSpaceConversationQueryCacheScopeId(
						"space-a",
						"profile-a"
					),
					scopeKind: "space",
				})
				.getItem("tanstack-query-cache")
		).toBeNull();
	});

	it("clears only the explicitly rejected Space conversation", async () => {
		const store = createTestStore();
		const sourceQueryClient = createQueryClient();
		const sourceController = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 100,
			store,
			throttleTimeMs: 0,
		});
		await sourceController.activateAuthorizedScope({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: sourceQueryClient,
		});

		const rejectedHistory = {
			envelopes: [
				createTextSignal("signal-rejected", "space-rejected", "profile-a"),
			],
			nextCursor: null,
		};
		const retainedHistory = {
			envelopes: [
				createTextSignal("signal-retained", "space-retained", "profile-a"),
			],
			nextCursor: null,
		};
		const rejectedStorage = store.createStorage({
			organizationId: "organization-a",
			ownerAccountId: "account-a",
			scopeAlias: "organization-a",
			scopeId: buildSpaceConversationQueryCacheScopeId(
				"space-rejected",
				"profile-a"
			),
			scopeKind: "space",
		});
		const retainedStorage = store.createStorage({
			organizationId: "organization-a",
			ownerAccountId: "account-a",
			scopeAlias: "organization-a",
			scopeId: buildSpaceConversationQueryCacheScopeId(
				"space-retained",
				"profile-a"
			),
			scopeKind: "space",
		});

		await sourceController.activateSpaceConversation({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: sourceQueryClient,
			spaceId: "space-rejected",
			openMeldProfileId: "profile-a",
		});
		sourceQueryClient.setQueryData(
			spaceQueryKeys.history("space-rejected", "profile-a"),
			rejectedHistory
		);
		await waitForStoredQuery(
			rejectedStorage,
			spaceQueryKeys.history("space-rejected", "profile-a")
		);

		await sourceController.activateSpaceConversation({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: sourceQueryClient,
			spaceId: "space-retained",
			openMeldProfileId: "profile-a",
		});
		sourceQueryClient.setQueryData(
			spaceQueryKeys.history("space-retained", "profile-a"),
			retainedHistory
		);
		await waitForStoredQuery(
			retainedStorage,
			spaceQueryKeys.history("space-retained", "profile-a")
		);

		await sourceController.clearSpaceConversation({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: sourceQueryClient,
			spaceId: "space-rejected",
			openMeldProfileId: "profile-a",
		});

		expect(await rejectedStorage.getItem("tanstack-query-cache")).toBeNull();
		expect(
			await retainedStorage.getItem("tanstack-query-cache")
		).not.toBeNull();
		expect(
			sourceQueryClient.getQueryData(
				spaceQueryKeys.history("space-rejected", "profile-a")
			)
		).toBeUndefined();
		expect(
			sourceQueryClient.getQueryData(
				spaceQueryKeys.history("space-retained", "profile-a")
			)
		).toEqual(retainedHistory);
		sourceController.deactivate();

		const restoredQueryClient = createQueryClient();
		const restoredController = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 100,
			store,
			throttleTimeMs: 0,
		});
		await restoredController.activateAuthorizedScope({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: restoredQueryClient,
		});
		await restoredController.activateSpaceConversation({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: restoredQueryClient,
			spaceId: "space-rejected",
			openMeldProfileId: "profile-a",
		});
		expect(
			restoredQueryClient.getQueryData(
				spaceQueryKeys.history("space-rejected", "profile-a")
			)
		).toBeUndefined();

		await restoredController.activateSpaceConversation({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: restoredQueryClient,
			spaceId: "space-retained",
			openMeldProfileId: "profile-a",
		});
		expect(
			restoredQueryClient.getQueryData(
				spaceQueryKeys.history("space-retained", "profile-a")
			)
		).toEqual(retainedHistory);
	});

	it("restores the safe Center Agent DM projection without persisting open-command state", async () => {
		const store = createTestStore();
		const sourceQueryClient = createQueryClient();
		const sourceController = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 100,
			store,
			throttleTimeMs: 0,
		});
		await sourceController.activateAuthorizedScope({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: sourceQueryClient,
		});
		const projection = {
			generatedAt: "2026-08-11T00:00:00.000Z",
			organizationId: "organization-a",
			projection: {
				centerAgentProfileId: "agent-center",
				isCenterAgentDirectMessageSpace: true,
				kind: "center_agent_direct_message_space",
				memberProfileId: "profile-a",
				organizationId: "organization-a",
				spaceId: "space-center-agent",
			},
		};
		sourceQueryClient.setQueryData(
			centerAgentQueryKeys.directMessageSpaceProjection("organization-a"),
			projection
		);
		sourceQueryClient.setQueryData(
			centerAgentQueryKeys.directMessageSpaceOpen("organization-a"),
			{ privateOpenCommandState: true }
		);
		await waitForStoredQuery(
			store.createStorage({
				organizationId: "organization-a",
				ownerAccountId: "account-a",
				scopeAlias: "organization-a",
				scopeId: "organization-a",
				scopeKind: "organization",
			}),
			centerAgentQueryKeys.directMessageSpaceProjection("organization-a")
		);
		sourceController.deactivate();

		const restoredQueryClient = createQueryClient();
		const restoredController = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 100,
			store,
			throttleTimeMs: 0,
		});
		await restoredController.activateAuthorizedScope({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: restoredQueryClient,
		});

		expect(
			restoredQueryClient.getQueryData(
				centerAgentQueryKeys.directMessageSpaceProjection("organization-a")
			)
		).toEqual(projection);
		expect(
			restoredQueryClient.getQueryData(
				centerAgentQueryKeys.directMessageSpaceOpen("organization-a")
			)
		).toBeUndefined();
	});

	it("restores only the approved account and organization queries", async () => {
		const store = createTestStore();
		const diagnostics: QueryPersistenceDiagnostic[] = [];
		const sourceQueryClient = createQueryClient();
		const sourceController = createBrowserQueryPersistenceController({
			diagnostics: { record: (event) => diagnostics.push(event) },
			restoreBudgetMs: 100,
			store,
			throttleTimeMs: 0,
		});

		await sourceController.activateAuthorizedScope({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: sourceQueryClient,
		});

		const profile = createProfileFixture("profile-a", "Félix 🎉");
		const organizationSpaces = createOrganizationSpacesFixture(
			"organization-a",
			[{ name: "Launch", spaceId: "space-a" }],
			"2026-07-16T00:00:00.000Z"
		);
		const restoredOrganizationSpaces = {
			...organizationSpaces,
			spaces: organizationSpaces.spaces.map((space) => ({
				...space,
				lastJoinedAt: null,
			})),
		};
		const savedSidebar = {
			ok: true as const,
			preferences: {
				pinned: { sort: "priority" as const, spaceIds: [] },
				spaces: { sort: "priority" as const, spaceIds: [] },
				groups: [],
				people: {
					starred: { sort: "priority" as const, itemIds: ["profile-a"] },
					people: { sort: "priority" as const, itemIds: [] },
					groups: [],
				},
			},
			revision: 3,
		};
		const computerToolbarSnapshot = createCurrentComputerToolbarDisplaySnapshot(
			{
				deviceId: "device-current",
				status: {
					label: "Check delayed",
					reason: "agent_check_failed",
					showLabel: true,
					tone: "warning",
				},
			}
		);
		sourceQueryClient.setQueryData(
			startQueryKeys.profilesForStorageScope("account-a"),
			[profile]
		);
		sourceQueryClient.setQueryData(
			startQueryKeys.currentComputerToolbarDisplaySnapshot("account-a"),
			computerToolbarSnapshot
		);
		sourceQueryClient.setQueryData(startQueryKeys.localRuntimes("account-a"), {
			localRuntimes: [
				{
					deviceId: "device-current",
					privatePath: "/Users/felix/Must Not Persist",
				},
			],
		});
		sourceQueryClient.setQueryData(
			organizationQueryKeys.spaces("organization-a"),
			organizationSpaces
		);
		sourceQueryClient.setQueryData(
			accountSidebarQueryKey("account-a", "organization-a"),
			savedSidebar
		);
		const memberSpaces = {
			version: 1,
			spaces: [{ spaceId: "space-a", profileIds: ["profile-a"] }],
		};
		sourceQueryClient.setQueryData(
			accountMemberSpacesDisplayQueryKey("account-a", "organization-a"),
			memberSpaces
		);
		sourceQueryClient.setQueryData(
			organizationPluginConnectionQueryKeys.statusSummary("organization-a"),
			{
				connectedServices: ["github", "linear"],
				organizationId: "organization-a",
			}
		);
		sourceQueryClient.setQueryData(
			organizationPluginConnectionQueryKeys.catalog("organization-a"),
			{
				connections: [{ ownerDisplayName: "Must Not Persist" }],
				currentUserId: "private-user-id",
				organizationId: "organization-a",
			}
		);
		sourceQueryClient.setQueryData(
			organizationQueryKeys.directory("organization-a"),
			{
				members: [{ email: "must-not-persist@example.com" }],
				organizationId: "organization-a",
			}
		);
		sourceQueryClient.setQueryData(["spaces", "space-a", "bootstrap"], {
			messages: ["must not persist"],
		});

		await Promise.all([
			waitForStoredQuery(
				store.createStorage({
					ownerAccountId: "account-a",
					scopeAlias: "account-a",
					scopeId: "account-a",
					scopeKind: "account",
				}),
				startQueryKeys.currentComputerToolbarDisplaySnapshot("account-a")
			),
			waitForStoredQuery(
				store.createStorage({
					ownerAccountId: "account-a",
					scopeAlias: "account-a",
					scopeId: "account-a",
					scopeKind: "account",
				}),
				startQueryKeys.profilesForStorageScope("account-a")
			),
			waitForStoredQuery(
				store.createStorage({
					ownerAccountId: "account-a",
					scopeAlias: "organization-a",
					scopeId: "organization-a",
					scopeKind: "organization",
				}),
				accountSidebarQueryKey("account-a", "organization-a")
			),
			waitForStoredQuery(
				store.createStorage({
					ownerAccountId: "account-a",
					scopeAlias: "organization-a",
					scopeId: "organization-a",
					scopeKind: "organization",
				}),
				accountMemberSpacesDisplayQueryKey("account-a", "organization-a")
			),
			waitForStoredQuery(
				store.createStorage({
					ownerAccountId: "account-a",
					scopeAlias: "organization-a",
					scopeId: "organization-a",
					scopeKind: "organization",
				}),
				organizationQueryKeys.spaces("organization-a")
			),
			waitForStoredQuery(
				store.createStorage({
					ownerAccountId: "account-a",
					scopeAlias: "organization-a",
					scopeId: "organization-a",
					scopeKind: "organization",
				}),
				organizationPluginConnectionQueryKeys.statusSummary("organization-a")
			),
		]);
		const accountPayload = await store
			.createStorage({
				ownerAccountId: "account-a",
				scopeAlias: "account-a",
				scopeId: "account-a",
				scopeKind: "account",
			})
			.getItem("tanstack-query-cache");
		expect(accountPayload).not.toContain("Must Not Persist");
		const organizationPayload = await store
			.createStorage({
				ownerAccountId: "account-a",
				scopeAlias: "organization-a",
				scopeId: "organization-a",
				scopeKind: "organization",
			})
			.getItem("tanstack-query-cache");
		expect(organizationPayload).not.toContain("Must Not Persist");
		expect(organizationPayload).not.toContain("private-user-id");
		sourceController.deactivate();
		diagnostics.length = 0;

		const restoredQueryClient = createQueryClient();
		const restoredController = createBrowserQueryPersistenceController({
			diagnostics: { record: (event) => diagnostics.push(event) },
			restoreBudgetMs: 100,
			store,
			throttleTimeMs: 0,
		});
		await restoredController.activateAuthorizedScope({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: restoredQueryClient,
		});
		for (const [scopeKind, payload] of [
			["account", accountPayload],
			["organization", organizationPayload],
		] as const) {
			expect(diagnostics).toContainEqual(
				expect.objectContaining({
					event: "restore_hit",
					scopeKind,
					sizeBytes: new TextEncoder().encode(payload ?? "").byteLength,
				})
			);
		}

		expect(
			restoredQueryClient.getQueryData(
				startQueryKeys.profilesForStorageScope("account-a")
			)
		).toEqual([profile]);
		expect(
			restoredQueryClient.getQueryState(
				startQueryKeys.profilesForStorageScope("account-a")
			)?.isInvalidated
		).toBe(true);
		expect(
			restoredQueryClient.getQueryData(
				startQueryKeys.currentComputerToolbarDisplaySnapshot("account-a")
			)
		).toEqual(computerToolbarSnapshot);
		expect(
			restoredQueryClient.getQueryState(
				startQueryKeys.currentComputerToolbarDisplaySnapshot("account-a")
			)?.isInvalidated
		).toBe(true);
		expect(
			restoredQueryClient.getQueryData(
				startQueryKeys.localRuntimes("account-a")
			)
		).toBeUndefined();
		expect(
			restoredQueryClient.getQueryData(
				accountMemberSpacesDisplayQueryKey("account-a", "organization-a")
			)
		).toEqual(memberSpaces);
		expect(
			restoredQueryClient.getQueryData(
				organizationPluginConnectionQueryKeys.statusSummary("organization-a")
			)
		).toEqual({
			connectedServices: ["github", "linear"],
			organizationId: "organization-a",
		});
		expect(
			restoredQueryClient.getQueryState(
				organizationPluginConnectionQueryKeys.statusSummary("organization-a")
			)?.isInvalidated
		).toBe(true);
		expect(
			restoredQueryClient.getQueryData(
				organizationPluginConnectionQueryKeys.catalog("organization-a")
			)
		).toBeUndefined();
		expect(
			restoredQueryClient.getQueryData(
				organizationQueryKeys.spaces("organization-a")
			)
		).toEqual(restoredOrganizationSpaces);
		expect(
			restoredQueryClient.getQueryData(
				accountSidebarQueryKey("account-a", "organization-a")
			)
		).toEqual(savedSidebar);
		expect(
			restoredQueryClient.getQueryState(
				accountSidebarQueryKey("account-a", "organization-a")
			)?.isInvalidated
		).toBe(true);
		expect(
			restoredQueryClient.getQueryState(
				organizationQueryKeys.spaces("organization-a")
			)?.isInvalidated
		).toBe(true);
		expect(
			restoredQueryClient.getQueryData(
				organizationQueryKeys.directory("organization-a")
			)
		).toBeUndefined();
		expect(
			restoredQueryClient.getQueryData(["spaces", "space-a", "bootstrap"])
		).toBeUndefined();
	});

	it("keeps organization snapshots isolated and clears only the requested organization", async () => {
		const store = createTestStore();
		const queryClient = createQueryClient();
		const controller = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 100,
			store,
			throttleTimeMs: 0,
		});

		await controller.activateAuthorizedScope({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient,
		});
		const organizationA = createOrganizationSpacesFixture("organization-a", [
			{ name: "A", spaceId: "space-a" },
		]);
		const organizationB = createOrganizationSpacesFixture("organization-b", [
			{ name: "B", spaceId: "space-b" },
		]);
		queryClient.setQueryData(
			organizationQueryKeys.spaces("organization-a"),
			organizationA
		);
		await waitForStoredPayload(
			store.createStorage({
				ownerAccountId: "account-a",
				scopeAlias: "organization-a",
				scopeId: "organization-a",
				scopeKind: "organization",
			})
		);

		await controller.activateAuthorizedScope({
			organizationId: "organization-b",
			organizationSlug: "organization-b",
			ownerAccountId: "account-a",
			queryClient,
		});
		queryClient.setQueryData(
			organizationQueryKeys.spaces("organization-b"),
			organizationB
		);
		await waitForStoredPayload(
			store.createStorage({
				ownerAccountId: "account-a",
				scopeAlias: "organization-b",
				scopeId: "organization-b",
				scopeKind: "organization",
			})
		);

		await controller.clearOrganization("account-a", "organization-a");
		expect(
			queryClient.getQueryData(organizationQueryKeys.spaces("organization-a"))
		).toBeUndefined();
		controller.deactivate();

		const restoredQueryClient = createQueryClient();
		const restoredController = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 100,
			store,
			throttleTimeMs: 0,
		});
		await restoredController.activateAuthorizedScope({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: restoredQueryClient,
		});
		await restoredController.activateAuthorizedScope({
			organizationId: "organization-b",
			organizationSlug: "organization-b",
			ownerAccountId: "account-a",
			queryClient: restoredQueryClient,
		});

		expect(
			restoredQueryClient.getQueryData(
				organizationQueryKeys.spaces("organization-a")
			)
		).toBeUndefined();
		expect(
			restoredQueryClient.getQueryData(
				organizationQueryKeys.spaces("organization-b")
			)
		).toEqual(organizationB);
	});

	it("fails closed across an account switch even if the auth boundary was skipped", async () => {
		const store = createTestStore();
		const queryClient = createQueryClient();
		const controller = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 100,
			store,
			throttleTimeMs: 0,
		});
		const accountAStorage = store.createStorage({
			ownerAccountId: "account-a",
			scopeAlias: "account-a",
			scopeId: "account-a",
			scopeKind: "account",
		});
		const accountAOrganizationStorage = store.createStorage({
			ownerAccountId: "account-a",
			scopeAlias: "organization-shared",
			scopeId: "organization-shared",
			scopeKind: "organization",
		});

		await controller.activateAuthorizedScope({
			organizationId: "organization-shared",
			organizationSlug: "organization-shared",
			ownerAccountId: "account-a",
			queryClient,
		});
		queryClient.setQueryData(
			startQueryKeys.profilesForStorageScope("account-a"),
			[createProfileFixture("profile-a", "Account A")]
		);
		queryClient.setQueryData(
			organizationQueryKeys.spaces("organization-shared"),
			createOrganizationSpacesFixture("organization-shared", [])
		);
		queryClient.setQueryData(
			accountSidebarQueryKey("account-a", "organization-shared"),
			{
				ok: true,
				preferences: {
					pinned: { sort: "priority", spaceIds: [] },
					spaces: { sort: "priority", spaceIds: [] },
					groups: [],
				},
				revision: 1,
			}
		);
		await waitForStoredQuery(
			accountAStorage,
			startQueryKeys.profilesForStorageScope("account-a")
		);
		await waitForStoredQuery(
			accountAOrganizationStorage,
			accountSidebarQueryKey("account-a", "organization-shared")
		);

		await controller.activateAuthorizedScope({
			organizationId: "organization-b",
			organizationSlug: "organization-b",
			ownerAccountId: "account-b",
			queryClient,
		});

		expect(await accountAStorage.getItem("tanstack-query-cache")).toBeNull();
		expect(
			await accountAOrganizationStorage.getItem("tanstack-query-cache")
		).toBeNull();
		expect(
			queryClient.getQueryData(
				startQueryKeys.profilesForStorageScope("account-a")
			)
		).toBeUndefined();
		expect(
			queryClient.getQueryData(
				organizationQueryKeys.spaces("organization-shared")
			)
		).toBeUndefined();
		expect(
			queryClient.getQueryData(
				accountSidebarQueryKey("account-a", "organization-shared")
			)
		).toBeUndefined();
	});

	it("repairs a corrupt saved payload after the network supplies fresh data", async () => {
		let payload: string | null = "not-json";
		const storage: AsyncStringStorage = {
			getItem: async () => payload,
			removeItem: () => {
				payload = null;
				return Promise.resolve();
			},
			setItem: (_key, value) => {
				payload = value;
				return Promise.resolve();
			},
		};
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const consoleWarn = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		const queryClient = createQueryClient();
		const controller = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 100,
			store: {
				clearAccount: async () => undefined,
				clearAll: async () => undefined,
				clearOrganization: async () => undefined,
				clearOrganizationBySlug: async () => undefined,
				createStorage: () => storage,
			},
			throttleTimeMs: 0,
		});

		await controller.activateAuthorizedScope({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient,
		});
		expect(payload).toBeNull();
		queryClient.setQueryData(
			startQueryKeys.profilesForStorageScope("account-a"),
			[createProfileFixture("profile-a", "Fresh profile")]
		);

		await vi.waitFor(() => {
			expect(payload).not.toBeNull();
			expect(() => JSON.parse(payload ?? "")).not.toThrow();
		});
		expect(consoleError).toHaveBeenCalled();
		expect(consoleWarn).toHaveBeenCalled();
	});

	it("reports quota failures without breaking the network-owned query cache", async () => {
		const diagnostics: QueryPersistenceDiagnostic[] = [];
		const quotaStorage: AsyncStringStorage = {
			getItem: async () => null,
			removeItem: async () => undefined,
			setItem: () =>
				Promise.reject(
					new DOMException("Browser storage is full", "QuotaExceededError")
				),
		};
		const queryClient = createQueryClient();
		const controller = createBrowserQueryPersistenceController({
			diagnostics: { record: (event) => diagnostics.push(event) },
			restoreBudgetMs: 100,
			store: {
				clearAccount: async () => undefined,
				clearAll: async () => undefined,
				clearOrganization: async () => undefined,
				clearOrganizationBySlug: async () => undefined,
				createStorage: () => quotaStorage,
			},
			throttleTimeMs: 0,
		});
		await controller.activateAuthorizedScope({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient,
		});

		queryClient.setQueryData(
			startQueryKeys.profilesForStorageScope("account-a"),
			[createProfileFixture("profile-a", "Network profile")]
		);

		await vi.waitFor(() => {
			expect(diagnostics).toContainEqual(
				expect.objectContaining({
					errorName: "QuotaExceededError",
					event: "quota_failed",
					scopeKind: "account",
				})
			);
		});
		expect(
			queryClient.getQueryData(
				startQueryKeys.profilesForStorageScope("account-a")
			)
		).toHaveLength(1);
	});

	it("stops waiting at the restore budget while a slow store continues safely", async () => {
		vi.useFakeTimers();
		let finishRestore: ((value: string | null) => void) | undefined;
		const slowStorage: AsyncStringStorage = {
			getItem: async () =>
				await new Promise<string | null>((resolve) => {
					finishRestore = resolve;
				}),
			removeItem: async () => undefined,
			setItem: async () => undefined,
		};
		const controller = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 25,
			store: {
				clearAccount: async () => undefined,
				clearAll: async () => undefined,
				clearOrganization: async () => undefined,
				clearOrganizationBySlug: async () => undefined,
				createStorage: (scope) =>
					scope.scopeKind === "account" ? slowStorage : createEmptyStorage(),
			},
			throttleTimeMs: 0,
		});

		const activation = controller.activateAuthorizedScope({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient: createQueryClient(),
		});
		await vi.advanceTimersByTimeAsync(25);

		await expect(activation).resolves.toBeUndefined();
		finishRestore?.(null);
		await vi.runAllTimersAsync();
	});

	it("does not hydrate a late restore after the account changes", async () => {
		vi.useFakeTimers();
		let finishAccountARestore: ((value: string | null) => void) | undefined;
		const accountAStorage: AsyncStringStorage = {
			getItem: async () =>
				await new Promise<string | null>((resolve) => {
					finishAccountARestore = resolve;
				}),
			removeItem: async () => undefined,
			setItem: async () => undefined,
		};
		const emptyStorage: AsyncStringStorage = {
			getItem: async () => null,
			removeItem: async () => undefined,
			setItem: async () => undefined,
		};
		const queryClient = createQueryClient();
		const controller = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 25,
			store: {
				clearAccount: async () => undefined,
				clearAll: async () => undefined,
				clearOrganization: async () => undefined,
				clearOrganizationBySlug: async () => undefined,
				createStorage: (scope) =>
					scope.ownerAccountId === "account-a" && scope.scopeKind === "account"
						? accountAStorage
						: emptyStorage,
			},
			throttleTimeMs: 0,
		});

		const accountAActivation = controller.activateAuthorizedScope({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient,
		});
		await vi.advanceTimersByTimeAsync(25);
		await accountAActivation;
		await controller.activateAuthorizedScope({
			organizationId: "organization-b",
			organizationSlug: "organization-b",
			ownerAccountId: "account-b",
			queryClient,
		});

		finishAccountARestore?.(createPersistedProfilePayload("account-a"));
		await vi.runAllTimersAsync();

		expect(
			queryClient.getQueryData(
				startQueryKeys.profilesForStorageScope("account-a")
			)
		).toBeUndefined();
	});

	it("retries failed old-account cleanup before the new account activates", async () => {
		const clearAccount = vi
			.fn<() => Promise<void>>()
			.mockRejectedValueOnce(new Error("IndexedDB unavailable"))
			.mockResolvedValue(undefined);
		const controller = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 100,
			store: {
				clearAccount,
				clearAll: async () => undefined,
				clearOrganization: async () => undefined,
				clearOrganizationBySlug: async () => undefined,
				createStorage: () => ({
					getItem: async () => null,
					removeItem: async () => undefined,
					setItem: async () => undefined,
				}),
			},
			throttleTimeMs: 0,
		});
		const queryClient = createQueryClient();

		await controller.activateAuthorizedScope({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient,
		});
		await controller.activateAuthorizedScope({
			organizationId: "organization-b",
			organizationSlug: "organization-b",
			ownerAccountId: "account-b",
			queryClient,
		});
		await controller.activateAuthorizedScope({
			organizationId: "organization-b",
			organizationSlug: "organization-b",
			ownerAccountId: "account-b",
			queryClient,
		});

		expect(clearAccount).toHaveBeenCalledTimes(2);
	});

	it("shares one activation promise for concurrent parent and child loaders", async () => {
		const controller = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 100,
			store: {
				clearAccount: async () => undefined,
				clearAll: async () => undefined,
				clearOrganization: async () => undefined,
				clearOrganizationBySlug: async () => undefined,
				createStorage: () => createEmptyStorage(),
			},
			throttleTimeMs: 0,
		});
		const queryClient = createQueryClient();
		const input = {
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient,
		};

		const parentActivation = controller.activateAuthorizedScope(input);
		const childActivation = controller.activateAuthorizedScope(input);

		expect(childActivation).toBe(parentActivation);
		await expect(parentActivation).resolves.toBeUndefined();
	});

	it("caps a queued organization activation at one navigation restore budget", async () => {
		vi.useFakeTimers();
		const controller = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 25,
			store: {
				clearAccount: async () => undefined,
				clearAll: async () => undefined,
				clearOrganization: async () => undefined,
				clearOrganizationBySlug: async () => undefined,
				createStorage: (scope) =>
					scope.scopeKind === "organization"
						? {
								getItem: async () => await new Promise(() => undefined),
								removeItem: async () => undefined,
								setItem: async () => undefined,
							}
						: createEmptyStorage(),
			},
			throttleTimeMs: 0,
		});
		const queryClient = createQueryClient();

		const firstActivation = controller.activateAuthorizedScope({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient,
		});
		const secondActivation = controller.activateAuthorizedScope({
			organizationId: "organization-b",
			organizationSlug: "organization-b",
			ownerAccountId: "account-a",
			queryClient,
		});
		let secondResolved = false;
		const observedSecondActivation = secondActivation.then(() => {
			secondResolved = true;
		});

		await vi.advanceTimersByTimeAsync(24);
		expect(secondResolved).toBe(false);
		await vi.advanceTimersByTimeAsync(1);

		await expect(firstActivation).resolves.toBeUndefined();
		await observedSecondActivation;
		expect(secondResolved).toBe(true);
		await vi.advanceTimersByTimeAsync(25);
	});

	it("caps a Space activation budget while an older scope operation is queued", async () => {
		vi.useFakeTimers();
		let finishSpaceClear: (() => void) | undefined;
		let spaceClearStarted: (() => void) | undefined;
		const spaceClearDidStart = new Promise<void>((resolve) => {
			spaceClearStarted = resolve;
		});
		const controller = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 25,
			store: {
				clearAccount: async () => undefined,
				clearAll: async () => undefined,
				clearOrganization: async () => undefined,
				clearOrganizationBySlug: async () => undefined,
				createStorage: (scope) => ({
					getItem: async () => null,
					removeItem:
						scope.scopeKind === "space" &&
						scope.scopeId ===
							buildSpaceConversationQueryCacheScopeId("space-a", "profile-a")
							? async () => {
									spaceClearStarted?.();
									await new Promise<void>((resolve) => {
										finishSpaceClear = resolve;
									});
								}
							: async () => undefined,
					setItem: async () => undefined,
				}),
			},
			throttleTimeMs: 0,
		});
		const queryClient = createQueryClient();
		const scope = {
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient,
		};

		await controller.activateAuthorizedScope(scope);
		await controller.activateSpaceConversation({
			...scope,
			spaceId: "space-a",
			openMeldProfileId: "profile-a",
		});
		const clear = controller.clearSpaceConversation({
			...scope,
			spaceId: "space-a",
			openMeldProfileId: "profile-a",
		});
		await spaceClearDidStart;

		let activationResolved = false;
		const activation = controller
			.activateSpaceConversation({
				...scope,
				spaceId: "space-b",
				openMeldProfileId: "profile-a",
			})
			.then(() => {
				activationResolved = true;
			});

		await vi.advanceTimersByTimeAsync(24);
		expect(activationResolved).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await activation;
		expect(activationResolved).toBe(true);

		finishSpaceClear?.();
		await clear;
		await vi.runAllTimersAsync();
	});

	it("clears the scoped database when a cold auth boundary has no owner marker", async () => {
		const clearAll = vi.fn(async () => undefined);
		const controller = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 100,
			store: {
				clearAccount: async () => undefined,
				clearAll,
				clearOrganization: async () => undefined,
				clearOrganizationBySlug: async () => undefined,
				createStorage: () => createEmptyStorage(),
			},
			throttleTimeMs: 0,
		});

		await controller.clearActiveAccount();

		expect(clearAll).toHaveBeenCalledTimes(1);
	});

	it("retries failed cold cleanup before enabling persistence for a new account", async () => {
		const clearAll = vi
			.fn<() => Promise<void>>()
			.mockRejectedValueOnce(new Error("IndexedDB blocked"))
			.mockRejectedValueOnce(new Error("IndexedDB still blocked"))
			.mockResolvedValue(undefined);
		const createStorage = vi.fn(() => createEmptyStorage());
		const controller = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 100,
			store: {
				clearAccount: async () => undefined,
				clearAll,
				clearOrganization: async () => undefined,
				clearOrganizationBySlug: async () => undefined,
				createStorage,
			},
			throttleTimeMs: 0,
		});
		const queryClient = createQueryClient();
		const activationInput = {
			organizationId: "organization-b",
			organizationSlug: "organization-b",
			ownerAccountId: "account-b",
			queryClient,
		};

		await expect(controller.clearActiveAccount()).rejects.toThrow(
			"IndexedDB blocked"
		);
		await controller.activateAuthorizedScope(activationInput);

		expect(clearAll).toHaveBeenCalledTimes(2);
		expect(createStorage).not.toHaveBeenCalled();

		await controller.activateAuthorizedScope(activationInput);

		expect(clearAll).toHaveBeenCalledTimes(3);
		expect(createStorage).toHaveBeenCalledTimes(2);
	});

	it("does not subscribe after an account switch interrupts restore invalidation", async () => {
		let accountAPayload: string | null =
			createPersistedProfilePayload("account-a");
		const accountASetItem = vi.fn(async () => undefined);
		const accountAStorage: AsyncStringStorage = {
			getItem: async () => accountAPayload,
			removeItem: () => {
				accountAPayload = null;
				return Promise.resolve();
			},
			setItem: accountASetItem,
		};
		const queryClient = createQueryClient();
		const accountAQueryKey =
			startQueryKeys.profilesForStorageScope("account-a");
		const originalInvalidateQueries =
			queryClient.invalidateQueries.bind(queryClient);
		let finishAccountAInvalidation: (() => void) | undefined;
		vi.spyOn(queryClient, "invalidateQueries").mockImplementation(
			async (filters, options) => {
				if (
					JSON.stringify(filters?.queryKey) === JSON.stringify(accountAQueryKey)
				) {
					await new Promise<void>((resolve) => {
						finishAccountAInvalidation = resolve;
					});
					return;
				}
				await originalInvalidateQueries(filters, options);
			}
		);
		const controller = createBrowserQueryPersistenceController({
			diagnostics: { record: vi.fn() },
			restoreBudgetMs: 5,
			store: {
				clearAccount: async () => undefined,
				clearAll: async () => undefined,
				clearOrganization: async () => undefined,
				clearOrganizationBySlug: async () => undefined,
				createStorage: (scope) =>
					scope.ownerAccountId === "account-a" && scope.scopeKind === "account"
						? accountAStorage
						: createEmptyStorage(),
			},
			throttleTimeMs: 0,
		});

		await controller.activateAuthorizedScope({
			organizationId: "organization-a",
			organizationSlug: "organization-a",
			ownerAccountId: "account-a",
			queryClient,
		});
		expect(finishAccountAInvalidation).toBeDefined();
		await controller.activateAuthorizedScope({
			organizationId: "organization-b",
			organizationSlug: "organization-b",
			ownerAccountId: "account-b",
			queryClient,
		});
		accountASetItem.mockClear();
		finishAccountAInvalidation?.();
		await new Promise((resolve) => setTimeout(resolve, 0));

		queryClient.setQueryData(accountAQueryKey, [
			createProfileFixture("profile-late", "Late old profile"),
		]);
		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(accountASetItem).not.toHaveBeenCalled();
	});
});

function createPersistedProfilePayload(ownerAccountId: string): string {
	const source = createQueryClient();
	source.setQueryData(startQueryKeys.profilesForStorageScope(ownerAccountId), [
		createProfileFixture("profile-old", "Old account profile"),
	]);
	return JSON.stringify({
		buster: "browser-read-cache-v1",
		clientState: dehydrate(source),
		timestamp: Date.now(),
	});
}

function createProfileFixture(openMeldProfileId: string, profileName: string) {
	return authProfileViewSchema.parse({
		createdAt: "2026-07-16T00:00:00.000Z",
		createdByUserId: "account-a",
		creatorProfileId: null,
		isDefault: true,
		lastUsedAt: null,
		managedRole: null,
		ownerName: "Felix",
		ownerUserId: "account-a",
		profileHandle: openMeldProfileId,
		profileKind: "human",
		profileName,
		source: "auth",
		status: "active",
		updatedAt: "2026-07-16T00:00:00.000Z",
		openMeldProfileId,
	});
}

function createOrganizationSpacesFixture(
	organizationId: string,
	spaces: Array<{ name: string; spaceId: string }>,
	lastJoinedAt: string | null = null
) {
	return organizationSpaceDirectoryWithMemberCountsResponseSchema.parse({
		generatedAt: "2026-07-16T00:00:00.000Z",
		organizationId,
		spaces: spaces.map((space) => ({
			activeMemberCount: 1,
			joined: true,
			lastJoinedAt,
			name: space.name,
			organizationId,
			spaceCreatedAt: "2026-07-16T00:00:00.000Z",
			spaceId: space.spaceId,
			spaceUpdatedAt: "2026-07-16T00:00:00.000Z",
			updatedAt: "2026-07-16T00:00:00.000Z",
			visibility: "public",
		})),
	});
}

function createTextSignal(
	id: string,
	spaceId: string,
	profileId: string
): SignalEnvelope {
	return {
		data: { text: "Saved conversation message" },
		id,
		profile: {
			kind: "human",
			profileId,
			profileName: "Felix",
		},
		spaceId,
		ts: 1,
		type: "signal.text",
		v: 1,
	} as SignalEnvelope;
}

function createQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: { gcTime: Number.POSITIVE_INFINITY, retry: false },
		},
	});
}

function createEmptyStorage(): AsyncStringStorage {
	return {
		getItem: async () => null,
		removeItem: async () => undefined,
		setItem: async () => undefined,
	};
}

function createTestStore(): DexieQueryCacheStore {
	const store = createDexieQueryCacheStore({
		databaseName: `openmeld-browser-persistence-${crypto.randomUUID()}`,
		IDBKeyRange,
		indexedDB,
		retentionMs: 60_000,
	});
	stores.push(store);
	return store;
}

async function waitForStoredPayload(
	storage: AsyncStringStorage
): Promise<void> {
	await vi.waitFor(async () => {
		if ((await storage.getItem("tanstack-query-cache")) === null) {
			throw new Error("Expected the TanStack Query payload to be persisted.");
		}
	});
}

async function waitForStoredQuery(
	storage: AsyncStringStorage,
	queryKey: readonly unknown[]
): Promise<void> {
	await vi.waitFor(async () => {
		const payload = await storage.getItem("tanstack-query-cache");
		if (payload === null) {
			throw new Error("Expected the TanStack Query payload to be persisted.");
		}
		const persisted = JSON.parse(payload ?? "null") as {
			clientState?: { queries?: Array<{ queryKey?: readonly unknown[] }> };
		};
		const includesQuery = persisted.clientState?.queries?.some(
			(query) => JSON.stringify(query.queryKey) === JSON.stringify(queryKey)
		);
		if (!includesQuery) {
			throw new Error("Expected the approved query to be persisted.");
		}
	});
}
