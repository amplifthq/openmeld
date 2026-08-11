import { beforeEach, describe, expect, it, vi } from "vitest";

const getExecutionReadinessBatch = vi.fn(
	async (input: { agentProfileIds: string[] }) => ({
		items: input.agentProfileIds.map((agentProfileId) => ({ agentProfileId })),
	})
);
const notifyRouteCatalogChangedBatch = vi.fn(async () => ({
	notifiedSessions: 1,
	ok: true,
}));

vi.mock("@openmeld/api-client", () => ({
	createAgentProfileBindingApi: vi.fn(() => ({
		getExecutionReadinessBatch,
		notifyRouteCatalogChangedBatch,
	})),
	toStructuredApiClientFailure: (error: unknown) => error,
}));

vi.mock("#/lib/openmeld-api/client", () => ({
	createWebOpenMeldApiFoundation: vi.fn(() => ({})),
}));

import {
	AGENT_EXECUTION_READINESS_UI_BATCH_SIZE,
	chunkAgentExecutionReadinessProfileIds,
	notifyAgentExecutionReadinessRefresh,
	readAgentExecutionReadinessBatch,
} from "./agent-execution-readiness";

function buildAgentProfileId(index: number): string {
	return `agt_00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

describe("read agent execution readiness batch", () => {
	beforeEach(() => {
		getExecutionReadinessBatch.mockClear();
		notifyRouteCatalogChangedBatch.mockClear();
	});

	it("splits large profile lists into gateway-sized batches", async () => {
		const agentProfileIds = Array.from({ length: 101 }, (_, index) =>
			buildAgentProfileId(index + 1)
		);

		const result = await readAgentExecutionReadinessBatch({ agentProfileIds });

		expect(getExecutionReadinessBatch).toHaveBeenCalledTimes(2);
		expect(
			getExecutionReadinessBatch.mock.calls[0]?.[0].agentProfileIds
		).toHaveLength(100);
		expect(
			getExecutionReadinessBatch.mock.calls[1]?.[0].agentProfileIds
		).toEqual([agentProfileIds[100]]);
		expect(result.items.map((item) => item.agentProfileId)).toEqual(
			agentProfileIds
		);
	});

	it("keeps ordinary profile lists in one readiness query batch", () => {
		const agentProfileIds = Array.from({ length: 42 }, (_, index) =>
			buildAgentProfileId(index + 1)
		);

		expect(chunkAgentExecutionReadinessProfileIds(agentProfileIds)).toEqual([
			agentProfileIds,
		]);
	});

	it("splits ordinary profile lists into bounded UI batches", () => {
		const agentProfileIds = Array.from({ length: 42 }, (_, index) =>
			buildAgentProfileId(index + 1)
		);

		const batches = chunkAgentExecutionReadinessProfileIds(
			agentProfileIds,
			AGENT_EXECUTION_READINESS_UI_BATCH_SIZE
		);

		expect(batches).toHaveLength(4);
		expect(batches.map((batch) => batch.length)).toEqual([12, 12, 12, 6]);
		expect(batches.flat()).toEqual(agentProfileIds);
	});

	it("nudges route catalog refreshes through one batch request", async () => {
		await notifyAgentExecutionReadinessRefresh({
			agentProfileIds: ["agt_2", "agt_1", "agt_2"],
		});

		expect(notifyRouteCatalogChangedBatch).toHaveBeenCalledOnce();
		expect(notifyRouteCatalogChangedBatch).toHaveBeenCalledWith({
			agentProfileIds: ["agt_2", "agt_1"],
			reason: "agent_execution_readiness_refresh",
		});
	});
});
