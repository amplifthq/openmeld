import { HOSTED_REMOTE_AGENT_CONTROLLER_REF } from "@openmeld/agent-runtime";
import {
	aiUsageQueryResponseSchema,
	organizationProfileDirectoryResponseSchema,
} from "@openmeld/schemas";
import type {
	AiUsageQuery,
	AiUsageQueryResponse,
} from "@openmeld/schemas/types";
import { demoDirectory } from "./demo-data";

export const demoUsageDirectory =
	organizationProfileDirectoryResponseSchema.parse({
		...demoDirectory,
		agentProfiles: [
			[
				"agt_55555555-5555-4555-8555-555555555555",
				"Maya’s Codex",
				"maya-codex",
				"builtin:codex",
			],
			[
				"agt_44444444-4444-4444-8444-444444444444",
				"Research assistant",
				"maya-research",
				HOSTED_REMOTE_AGENT_CONTROLLER_REF,
			],
		].map(([profileId, profileName, profileHandle, agentControllerRef]) => ({
			profileId,
			profileName,
			profileHandle,
			agentControllerRef,
			ownerUserId: "preview",
			ownerName: "Maya Chen",
			organizationId: "org",
			profileKind: "agent",
			isCenterAgent: false,
			isDefault: false,
			status: "active",
			source: "web_create",
			managedRole: null,
			createdByUserId: "preview",
			creatorProfileId: null,
			lastUsedAt: null,
			createdAt: "2026-10-01T00:00:00.000Z",
			updatedAt: "2026-10-01T00:00:00.000Z",
		})),
	});

// Fictional completed requests, shaped by the shared product contract. Totals,
// legends, chart buckets, and detail rows all derive from these same records.
const remote = [
	{ model: "openai/gpt-6-astra", costs: [18, 24, 31, 22, 36, 12, 19] },
	{ model: "anthropic/claude-opus-5.5", costs: [8, 14, 12, 17, 15, 9, 13] },
	{ model: "openai/gpt-6-luna", costs: [1, 2, 1, 3, 2, 1, 2] },
];
const local = [
	{
		controller: "builtin:codex",
		tokens: [
			2_680_731, 3_910_240, 5_210_361, 2_720_118, 4_890_645, 3_420_287,
			2_140_352,
		],
	},
	{
		controller: "builtin:claude-code",
		tokens: [
			1_310_427, 2_081_935, 1_560_921, 2_810_650, 3_105_843, 1_910_624,
			1_260_392,
		],
	},
];
type Totals = Pick<
	AiUsageQueryResponse["models"][number],
	| "requests"
	| "inputTokens"
	| "outputTokens"
	| "totalTokens"
	| "missingTokenRequests"
>;
function tokens(total: number): Totals {
	const output = Math.round(total * 0.025);
	return {
		requests: 24,
		inputTokens: total - output,
		outputTokens: output,
		totalTokens: total,
		missingTokenRequests: 0,
	};
}
function sum(rows: Totals[]): Totals {
	return rows.reduce(
		(total, row) => ({
			requests: total.requests + row.requests,
			inputTokens: total.inputTokens + row.inputTokens,
			outputTokens: total.outputTokens + row.outputTokens,
			totalTokens: total.totalTokens + row.totalTokens,
			missingTokenRequests: 0,
		}),
		{
			requests: 0,
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			missingTokenRequests: 0,
		}
	);
}

export function readOrganizationAiUsage(input: { query: AiUsageQuery }) {
	const { query } = input;
	if (query.agentProfileIds?.length === 0) {
		return Promise.resolve(
			aiUsageQueryResponseSchema.parse({
				fromMs: query.fromMs,
				toMs: query.toMs,
				models: [],
			})
		);
	}
	const edges = query.bucketBoundariesMs ?? [query.fromMs, query.toMs];
	const personal = query.agentProfileIds !== undefined;
	const factor = personal ? 0.42 : 1;
	const timeSeries: NonNullable<AiUsageQueryResponse["timeSeries"]> = edges
		.slice(0, -1)
		.map((fromMs, index) => {
			const toMs = edges[index + 1];
			if (query.runtime === "local") {
				const controllers = local.map((agent) => ({
					controller: agent.controller,
					...tokens(Math.round(agent.tokens[index % 7] * factor)),
				}));
				return { fromMs, toMs, ...sum(controllers), controllers };
			}
			const models = remote.map((entry) => ({
				provider: "openrouter",
				model: entry.model,
				...tokens(Math.round(entry.costs[index % 7] * 72_513 * factor)),
				reportedCostNanoUsd: Math.round(
					entry.costs[index % 7] * factor * 1_000_000_000
				),
				estimatedCostNanoUsd: 0,
				missingCostRequests: 0,
			}));
			return { fromMs, toMs, ...sum(models), models };
		});
	const models =
		query.runtime === "local"
			? [
					{
						runtime: "local",
						provider: "local",
						model: null,
						...sum(timeSeries),
						reportedCostNanoUsd: 0,
						estimatedCostNanoUsd: 0,
						missingCostRequests: 0,
					},
				]
			: remote.map((entry, index) => {
					const rows = timeSeries.flatMap(
						(bucket) => bucket.models?.[index] ?? []
					);
					return {
						runtime: "remote",
						provider: "openrouter",
						model: entry.model,
						...sum(rows),
						reportedCostNanoUsd: rows.reduce(
							(total, row) => total + row.reportedCostNanoUsd,
							0
						),
						estimatedCostNanoUsd: 0,
						missingCostRequests: 0,
					};
				});
	return Promise.resolve(
		aiUsageQueryResponseSchema.parse({
			fromMs: query.fromMs,
			toMs: query.toMs,
			models,
			timeSeries,
		})
	);
}
