import {
	createAgentProfileBindingApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	AgentExecutionReadinessTargetRuntime,
	GetAgentExecutionReadinessBatchResponse,
} from "@openmeld/schemas/types";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export const AGENT_EXECUTION_READINESS_REQUEST_BATCH_SIZE = 100;
export const AGENT_EXECUTION_READINESS_UI_BATCH_SIZE = 12;

export function chunkAgentExecutionReadinessProfileIds(
	agentProfileIds: readonly string[],
	batchSize = AGENT_EXECUTION_READINESS_REQUEST_BATCH_SIZE
): string[][] {
	const chunks: string[][] = [];
	for (let index = 0; index < agentProfileIds.length; index += batchSize) {
		chunks.push(agentProfileIds.slice(index, index + batchSize));
	}
	return chunks;
}

export async function readAgentExecutionReadinessBatch(input: {
	agentProfileIds: readonly string[];
	targetRuntime?: AgentExecutionReadinessTargetRuntime;
}): Promise<GetAgentExecutionReadinessBatchResponse> {
	try {
		const api = createAgentProfileBindingApi(
			createUnscopedWebOpenMeldApiFoundation()
		);
		const responses: GetAgentExecutionReadinessBatchResponse[] = [];
		for (const agentProfileIds of chunkAgentExecutionReadinessProfileIds(
			input.agentProfileIds
		)) {
			responses.push(
				await api.getExecutionReadinessBatch({
					agentProfileIds: [...agentProfileIds],
					...(input.targetRuntime === undefined
						? {}
						: { targetRuntime: input.targetRuntime }),
				})
			);
		}

		return {
			items: responses.flatMap((response) => response.items),
		};
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function notifyAgentExecutionReadinessRefresh(input: {
	agentProfileIds: readonly string[];
}): Promise<void> {
	try {
		const api = createAgentProfileBindingApi(
			createUnscopedWebOpenMeldApiFoundation()
		);
		const uniqueProfileIds = [...new Set(input.agentProfileIds)];
		if (uniqueProfileIds.length === 0) {
			return;
		}
		await api.notifyRouteCatalogChangedBatch({
			agentProfileIds: uniqueProfileIds,
			reason: "agent_execution_readiness_refresh",
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
