import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { createTestQueryClient } from "#/test-support/query-client";
import {
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
		const cancelQueriesSpy = vi.spyOn(queryClient, "cancelQueries");
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
		});
		expect(cancelQueriesSpy).toHaveBeenCalledWith({
			exact: true,
			queryKey: overviewQueryKey,
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
			})
		);
	});
});
