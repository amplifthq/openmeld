import { QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { createTestQueryClient } from "#/test-support/query-client";
import {
	agentExecutionReadinessBatchQueryOptions,
	agentExecutionReadinessQueryKeys,
	refreshWebAgentReadinessAfterCoreFactsChanged,
	refreshWebAgentReadinessFacts,
	refreshWebAgentReadinessSharedCaches,
} from "./execution-readiness";

const {
	notifyAgentExecutionReadinessRefreshMock,
	readAgentExecutionReadinessBatchMock,
} = vi.hoisted(() => ({
	notifyAgentExecutionReadinessRefreshMock: vi.fn(),
	readAgentExecutionReadinessBatchMock: vi.fn(),
}));

vi.mock("#/lib/agents/agent-execution-readiness", () => ({
	notifyAgentExecutionReadinessRefresh: (
		...args: Parameters<typeof notifyAgentExecutionReadinessRefreshMock>
	) => notifyAgentExecutionReadinessRefreshMock(...args),
	readAgentExecutionReadinessBatch: (
		...args: Parameters<typeof readAgentExecutionReadinessBatchMock>
	) => readAgentExecutionReadinessBatchMock(...args),
}));

describe("refreshWebAgentReadinessFacts", () => {
	beforeEach(() => {
		notifyAgentExecutionReadinessRefreshMock.mockReset().mockResolvedValue({
			ok: true,
		});
		readAgentExecutionReadinessBatchMock.mockReset().mockResolvedValue({
			items: [],
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("keeps readiness batches isolated by canonical Organization", () => {
		expect(
			agentExecutionReadinessQueryKeys.batch(
				"scope-test",
				"org-acme",
				["agt_target"],
				undefined
			)
		).not.toEqual(
			agentExecutionReadinessQueryKeys.batch(
				"scope-test",
				"org-beta",
				["agt_target"],
				undefined
			)
		);
	});

	it("treats cancelled refreshes as superseded work, not failures", async () => {
		const queryClient = createTestQueryClient();
		const onStepFailure = vi.fn();
		const consoleWarnSpy = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		const cancelledError = Object.assign(new Error("CancelledError"), {
			name: "CancelledError",
		});
		notifyAgentExecutionReadinessRefreshMock.mockRejectedValueOnce(
			cancelledError
		);

		await refreshWebAgentReadinessFacts({
			agentProfileIds: ["agt_123"],
			onStepFailure,
			organizationId: "org-acme",
			queryClient,
			storageScope: "scope-test",
		});

		expect(onStepFailure).not.toHaveBeenCalled();
		expect(consoleWarnSpy).not.toHaveBeenCalled();
	});

	it("still reports real refresh failures", async () => {
		const queryClient = createTestQueryClient();
		const onStepFailure = vi.fn();
		const realError = new Error("Gateway unavailable");
		notifyAgentExecutionReadinessRefreshMock.mockRejectedValueOnce(realError);

		await refreshWebAgentReadinessFacts({
			agentProfileIds: ["agt_123"],
			maxAttempts: 1,
			onStepFailure,
			organizationId: "org-acme",
			queryClient,
			storageScope: "scope-test",
		});

		expect(onStepFailure).toHaveBeenCalledWith(
			expect.objectContaining({
				agentProfileIds: ["agt_123"],
				error: realError,
				step: "agent_execution_readiness",
				willRetry: false,
			})
		);
	});

	it("invalidates only active readiness batches containing the requested profiles", async () => {
		const queryClient = createTestQueryClient();
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

		await refreshWebAgentReadinessSharedCaches({
			agentProfileIds: ["agt_target"],
			includeLocalRuntimeCaches: false,
			organizationId: "org-acme",
			queryClient,
			storageScope: "scope-test",
		});

		expect(invalidateQueriesSpy).toHaveBeenCalledTimes(2);
		const invalidateInput = invalidateQueriesSpy.mock.calls[0]?.[0] as
			| {
					predicate?: (query: { queryKey: readonly unknown[] }) => boolean;
					refetchType?: string;
			  }
			| undefined;
		expect(invalidateInput?.refetchType).toBe("active");
		expect(
			invalidateInput?.predicate?.({
				queryKey: [
					"agents",
					"execution-readiness",
					"batch",
					"scope-test",
					"org-acme",
					"bound-runtime",
					"",
					"agt_target",
				],
			})
		).toBe(true);
		expect(
			invalidateInput?.predicate?.({
				queryKey: [
					"agents",
					"execution-readiness",
					"batch",
					"scope-test",
					"org-acme",
					"bound-runtime",
					"",
					"agt_other",
				],
			})
		).toBe(false);
	});

	it("does not refetch the whole Agent runtime overview for one Profile change", async () => {
		const queryClient = createTestQueryClient();
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

		await refreshWebAgentReadinessSharedCaches({
			agentProfileIds: ["agt_target"],
			includeLocalRuntimeCaches: false,
			organizationId: "org-123",
			queryClient,
			storageScope: "scope-test",
		});

		expect(invalidateQueriesSpy).not.toHaveBeenCalledWith({
			queryKey: ["organizations", "org-123", "agent-runtime-overview"],
			refetchType: "active",
		});
	});

	it("patches only the changed Profile readiness in an active runtime overview", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(
			organizationQueryKeys.profileDirectory("org-123"),
			{
				agentProfiles: [{ profileId: "agt_target", ownerUserId: "scope-test" }],
			}
		);
		const overviewQueryKey = [
			"organizations",
			"org-123",
			"agent-runtime-overview",
		] as const;
		const targetBefore = {
			agentProfileId: "agt_target",
			generatedAt: "2026-09-04T10:00:00.000Z",
		};
		const otherBefore = {
			agentProfileId: "agt_other",
			generatedAt: "2026-09-04T10:00:00.000Z",
		};
		const targetAfter = {
			agentProfileId: "agt_target",
			generatedAt: "2026-09-04T10:01:00.000Z",
		};
		queryClient.setQueryData(overviewQueryKey, {
			agentProfiles: [
				{ profileId: "agt_target", readiness: targetBefore },
				{ profileId: "agt_other", readiness: otherBefore },
			],
			generatedAt: "2026-09-04T10:00:00.000Z",
			organizationId: "org-123",
		});
		const overviewQuery = queryClient
			.getQueryCache()
			.find({ exact: true, queryKey: overviewQueryKey });
		if (!overviewQuery) {
			throw new Error("Expected the runtime overview query to be cached.");
		}
		vi.spyOn(overviewQuery, "isActive").mockReturnValue(true);
		readAgentExecutionReadinessBatchMock.mockResolvedValue({
			items: [targetAfter],
		});

		await refreshWebAgentReadinessSharedCaches({
			agentProfileIds: ["agt_target"],
			includeLocalRuntimeCaches: false,
			organizationId: "org-123",
			queryClient,
			storageScope: "scope-test",
		});

		expect(readAgentExecutionReadinessBatchMock).toHaveBeenCalledWith({
			agentProfileIds: ["agt_target"],
			organizationId: "org-123",
			signal: expect.any(AbortSignal),
		});
		const overview = queryClient.getQueryData<{
			agentProfiles: { profileId: string; readiness: unknown }[];
		}>(overviewQueryKey);
		expect(overview?.agentProfiles).toEqual([
			{ profileId: "agt_target", readiness: targetAfter },
			{ profileId: "agt_other", readiness: otherBefore },
		]);
	});

	it("refreshes Core-owned readiness facts without notifying route catalog sync", async () => {
		const queryClient = createTestQueryClient();
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

		await refreshWebAgentReadinessAfterCoreFactsChanged({
			agentProfileIds: ["agt_target"],
			includeLocalRuntimeCaches: false,
			organizationId: "org-acme",
			queryClient,
			storageScope: "scope-test",
		});

		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: organizationQueryKeys.profileDirectory("org-acme"),
			refetchType: "active",
		});
		expect(invalidateQueriesSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				queryKey: expect.arrayContaining([
					"agents",
					"execution-readiness",
					"batch",
					"scope-test",
					"org-acme",
				]),
				refetchType: "active",
			}),
			{ cancelRefetch: false }
		);
	});
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("readiness refresh ordering", () => {
	const key = organizationQueryKeys.agentRuntimeOverview("org-1");
	const snapshot = (generatedAt: string) => ({
		agentProfiles: [
			{
				profileId: "agt_target",
				readiness: { agentProfileId: "agt_target", generatedAt },
			},
		],
	});
	const refresh = (queryClient: ReturnType<typeof createTestQueryClient>) =>
		refreshWebAgentReadinessSharedCaches({
			queryClient,
			organizationId: "org-1",
			storageScope: "account-1",
			agentProfileIds: ["agt_target"],
			includeLocalRuntimeCaches: false,
		});
	function setup() {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(key, snapshot("initial"));
		queryClient.setQueryData(organizationQueryKeys.profileDirectory("org-1"), {
			agentProfiles: [{ profileId: "agt_target", ownerUserId: "account-1" }],
		});
		const observer = new QueryObserver(queryClient, {
			queryKey: key,
			queryFn: async () => snapshot("full"),
			staleTime: Number.POSITIVE_INFINITY,
		});
		const stop = observer.subscribe(() => undefined);
		return { queryClient, stop };
	}
	afterEach(() => readAgentExecutionReadinessBatchMock.mockReset());

	it("coalesces concurrent events and reads once more after a change during the read", async () => {
		const { queryClient, stop } = setup();
		const first = deferred<{ items: unknown[] }>();
		const started = deferred<void>();
		readAgentExecutionReadinessBatchMock
			.mockImplementationOnce(() => {
				started.resolve();
				return first.promise;
			})
			.mockResolvedValue({
				items: [snapshot("latest").agentProfiles[0].readiness],
			});
		const a = refresh(queryClient);
		await started.promise;
		const b = refresh(queryClient);
		const c = refresh(queryClient);
		expect(readAgentExecutionReadinessBatchMock).toHaveBeenCalledTimes(1);
		first.resolve({ items: [snapshot("older").agentProfiles[0].readiness] });
		await Promise.all([a, b, c]);
		expect(readAgentExecutionReadinessBatchMock).toHaveBeenCalledTimes(2);
		expect(queryClient.getQueryData(key)).toEqual(snapshot("latest"));
		stop();
		queryClient.clear();
	});

	it.each([
		"removed",
		"full-response",
	])("does not let an old partial response overwrite %s", async (change) => {
		const { queryClient, stop } = setup();
		const first = deferred<{ items: unknown[] }>();
		const started = deferred<void>();
		const followup = deferred<{ items: unknown[] }>();
		const followupStarted = deferred<void>();
		readAgentExecutionReadinessBatchMock
			.mockImplementationOnce(() => {
				started.resolve();
				return first.promise;
			})
			.mockImplementationOnce(() => {
				followupStarted.resolve();
				return followup.promise;
			});
		const pending = refresh(queryClient);
		await started.promise;
		if (change === "removed") {
			queryClient.removeQueries({ queryKey: key, exact: true });
		}
		queryClient.setQueryData(key, snapshot("new-full"));
		first.resolve({
			items: [snapshot("old-partial").agentProfiles[0].readiness],
		});
		if (change === "full-response") {
			await followupStarted.promise;
			expect(queryClient.getQueryData(key)).toEqual(snapshot("new-full"));
			followup.resolve({
				items: [snapshot("current").agentProfiles[0].readiness],
			});
		}
		await pending;
		expect(queryClient.getQueryData(key)).toEqual(
			snapshot(change === "removed" ? "new-full" : "current")
		);
		stop();
		queryClient.clear();
	});

	it("uses the authorized overview for another owner's Agent", async () => {
		const { queryClient, stop } = setup();
		queryClient.setQueryData(organizationQueryKeys.profileDirectory("org-1"), {
			agentProfiles: [{ profileId: "agt_target", ownerUserId: "someone-else" }],
		});
		await refresh(queryClient);
		expect(readAgentExecutionReadinessBatchMock).not.toHaveBeenCalled();
		expect(queryClient.getQueryData(key)).toEqual(snapshot("full"));
		stop();
		queryClient.clear();
	});

	it("uses one cancellable request for equivalent Agent sets", async () => {
		const queryClient = createTestQueryClient();
		const response = deferred<{ items: unknown[] }>();
		readAgentExecutionReadinessBatchMock.mockReturnValue(response.promise);
		const options = (agentProfileIds: string[]) =>
			agentExecutionReadinessBatchQueryOptions({
				agentProfileIds,
				organizationId: "org-1",
				storageScope: "account-1",
				enabled: true,
			});
		const a = queryClient.fetchQuery(options(["b", "a", "a"]));
		const b = queryClient.fetchQuery(options(["a", "b"]));
		expect(readAgentExecutionReadinessBatchMock).toHaveBeenCalledTimes(1);
		expect(
			readAgentExecutionReadinessBatchMock.mock.calls[0][0].agentProfileIds
		).toEqual(["a", "b"]);
		const signal = readAgentExecutionReadinessBatchMock.mock.calls[0][0]
			.signal as AbortSignal;
		const settled = Promise.allSettled([a, b]);
		await queryClient.cancelQueries();
		expect(signal.aborted).toBe(true);
		await settled;
		response.resolve({ items: [] });
		queryClient.clear();
	});
});
