import {
	createAgentActivityApi,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	AgentActivitySnapshotQuery,
	AgentActivitySnapshotResponse,
	AgentActivityStatsQuery,
	AgentActivityStatsResponse,
} from "@openmeld/schemas/types";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export type AgentActivityFailure = StructuredApiClientFailure;

function createWebAgentActivityApi(organizationId: string) {
	return createAgentActivityApi(
		createWebOpenMeldApiFoundation({ organizationId })
	);
}

export async function readCurrentAgentActivitySnapshot(
	input: {
		organizationId: string;
		signal?: AbortSignal;
	} & AgentActivitySnapshotQuery
): Promise<AgentActivitySnapshotResponse> {
	try {
		const response = await createWebAgentActivityApi(
			input.organizationId
		).readSnapshot({
			...(input.includeProviderMetadata === true
				? { includeProviderMetadata: true }
				: {}),
			...(input.memberUserId ? { memberUserId: input.memberUserId } : {}),
			...(input.projectId ? { projectId: input.projectId } : {}),
			...(input.provider ? { provider: input.provider } : {}),
			...(input.status ? { status: input.status } : {}),
			signal: input.signal,
		});
		if (response.organizationId !== input.organizationId) {
			throw new Error("Agent Activity response organization mismatch.");
		}
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
export async function readCurrentAgentActivityStats(
	input: {
		organizationId: string;
		signal?: AbortSignal;
	} & AgentActivityStatsQuery
): Promise<AgentActivityStatsResponse> {
	try {
		const response = await createWebAgentActivityApi(
			input.organizationId
		).readStats({
			...(input.projectId ? { projectId: input.projectId } : {}),
			signal: input.signal,
		});
		if (response.organizationId !== input.organizationId) {
			throw new Error("Agent Activity stats response organization mismatch.");
		}
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
