import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "#/test-support/query-client";
import {
	refreshWebAgentReadinessAfterCoreFactsChanged,
	refreshWebAgentReadinessFacts,
	refreshWebAgentReadinessSharedCaches,
} from "./execution-readiness";

const notifyAgentExecutionReadinessRefreshMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/agents/agent-execution-readiness", () => ({
	notifyAgentExecutionReadinessRefresh: (
		...args: Parameters<typeof notifyAgentExecutionReadinessRefreshMock>
	) => notifyAgentExecutionReadinessRefreshMock(...args),
	readAgentExecutionReadinessBatch: vi.fn(),
}));

describe("refreshWebAgentReadinessFacts", () => {
	beforeEach(() => {
		notifyAgentExecutionReadinessRefreshMock.mockReset().mockResolvedValue({
			ok: true,
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
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
			queryClient,
			storageScope: "scope-test",
		});

		expect(invalidateQueriesSpy).toHaveBeenCalledTimes(1);
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
					"bound-runtime",
					"",
					"agt_other",
				],
			})
		).toBe(false);
	});

	it("also invalidates the organization Directory projection after Core readiness changes", async () => {
		const queryClient = createTestQueryClient();
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

		await refreshWebAgentReadinessSharedCaches({
			agentProfileIds: ["agt_target"],
			includeLocalRuntimeCaches: false,
			organizationId: "org-123",
			queryClient,
			storageScope: "scope-test",
		});

		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: ["organizations", "org-123", "directory"],
			refetchType: "active",
		});
	});

	it("refreshes Core-owned readiness facts without notifying route catalog sync", async () => {
		const queryClient = createTestQueryClient();
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

		await refreshWebAgentReadinessAfterCoreFactsChanged({
			agentProfileIds: ["agt_target"],
			includeLocalRuntimeCaches: false,
			queryClient,
			storageScope: "scope-test",
		});

		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		expect(invalidateQueriesSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				queryKey: expect.arrayContaining([
					"agents",
					"execution-readiness",
					"batch",
					"scope-test",
				]),
				refetchType: "active",
			})
		);
	});
});
