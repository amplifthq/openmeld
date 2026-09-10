import type { StructuredApiClientFailure } from "@openmeld/api-client";
import type {
	AgentExecutionReadinessTargetRuntime,
	GetAgentExecutionReadinessBatchResponse,
	OrganizationAgentRuntimeOverviewResponse,
} from "@openmeld/schemas/types";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import {
	notifyAgentExecutionReadinessRefresh,
	readAgentExecutionReadinessBatch,
} from "#/lib/agents/agent-execution-readiness";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { isQueryCancellationError } from "#/query/query-cancellation";
import { baseQueryOptions } from "#/query/query-config";
import { startQueryKeys } from "#/query/query-keys";

function normalizeQueryScope(storageScope: string | null | undefined): string {
	const normalizedScope = (storageScope ?? "").trim();
	return normalizedScope.length > 0 ? normalizedScope : "anonymous";
}

export const agentExecutionReadinessQueryKeys = {
	batchesForOrganization: (storageScope: string, organizationId: string) =>
		[
			"agents",
			"execution-readiness",
			"batch",
			normalizeQueryScope(storageScope),
			organizationId,
		] as const,
	batch: (
		storageScope: string,
		organizationId: string,
		agentProfileIds: readonly string[],
		targetRuntime: AgentExecutionReadinessTargetRuntime | undefined
	) =>
		[
			"agents",
			"execution-readiness",
			"batch",
			normalizeQueryScope(storageScope),
			organizationId,
			targetRuntime?.kind ?? "bound-runtime",
			targetRuntime?.kind === "openmeld_service_runtime_id"
				? targetRuntime.openMeldServiceRuntimeId
				: "",
			...agentProfileIds,
		] as const,
} as const;

export function agentExecutionReadinessBatchQueryOptions(input: {
	agentProfileIds: readonly string[];
	enabled: boolean;
	organizationId: string;
	storageScope: string;
	targetRuntime?: AgentExecutionReadinessTargetRuntime;
}) {
	return queryOptions<
		GetAgentExecutionReadinessBatchResponse,
		StructuredApiClientFailure
	>({
		queryKey: agentExecutionReadinessQueryKeys.batch(
			input.storageScope,
			input.organizationId,
			input.agentProfileIds,
			input.targetRuntime
		),
		queryFn: async () =>
			await readAgentExecutionReadinessBatch({
				agentProfileIds: input.agentProfileIds,
				organizationId: input.organizationId,
				...(input.targetRuntime === undefined
					? {}
					: { targetRuntime: input.targetRuntime }),
			}),
		enabled: input.enabled && input.agentProfileIds.length > 0,
		gcTime: baseQueryOptions.gcTime,
		retry: baseQueryOptions.retry,
		// Short mount gate only: readiness freshness is driven by the
		// invalidation bus and recovery refresh ticks, which invalidate
		// imperatively and bypass staleness.
		staleTime: 15_000,
		refetchOnMount: true,
		refetchOnWindowFocus: false,
	});
}

export type WebAgentReadinessRefreshStep =
	| "agent_execution_readiness"
	| "shared_caches";

export type WebAgentReadinessRefreshFailure = {
	agentProfileIds: readonly string[];
	attempt: number;
	error: unknown;
	maxAttempts: number;
	step: WebAgentReadinessRefreshStep;
	storageScope: string;
	willRetry: boolean;
};

export async function refreshWebAgentReadinessFacts(input: {
	agentProfileIds?: readonly string[];
	includeLocalRuntimeCaches?: boolean;
	maxAttempts?: number;
	organizationId: string;
	onStepFailure?: (failure: WebAgentReadinessRefreshFailure) => void;
	queryClient: QueryClient;
	storageScope: string;
}) {
	const agentProfileIds = normalizeAgentProfileIds(input.agentProfileIds ?? []);
	const maxAttempts = Math.max(1, input.maxAttempts ?? 2);

	if (agentProfileIds.length > 0) {
		await runWebAgentReadinessRefreshStep({
			action: () =>
				notifyAgentExecutionReadinessRefresh({
					agentProfileIds,
					organizationId: input.organizationId,
				}),
			agentProfileIds,
			maxAttempts,
			onStepFailure: input.onStepFailure,
			step: "agent_execution_readiness",
			storageScope: input.storageScope,
		});
	}

	await refreshWebAgentReadinessAfterCoreFactsChanged({
		agentProfileIds,
		includeLocalRuntimeCaches: input.includeLocalRuntimeCaches,
		maxAttempts,
		organizationId: input.organizationId,
		onStepFailure: input.onStepFailure,
		queryClient: input.queryClient,
		storageScope: input.storageScope,
	});
}

export async function refreshWebAgentReadinessAfterCoreFactsChanged(
	input: Parameters<typeof refreshWebAgentReadinessFacts>[0]
) {
	const agentProfileIds = normalizeAgentProfileIds(input.agentProfileIds ?? []);
	const maxAttempts = Math.max(1, input.maxAttempts ?? 2);

	await runWebAgentReadinessRefreshStep({
		action: () =>
			refreshWebAgentReadinessSharedCaches({
				agentProfileIds,
				includeLocalRuntimeCaches: input.includeLocalRuntimeCaches,
				organizationId: input.organizationId,
				queryClient: input.queryClient,
				storageScope: input.storageScope,
			}),
		agentProfileIds,
		maxAttempts,
		onStepFailure: input.onStepFailure,
		step: "shared_caches",
		storageScope: input.storageScope,
	});
}

export async function refreshWebAgentReadinessSharedCaches(input: {
	agentProfileIds?: readonly string[];
	includeLocalRuntimeCaches?: boolean;
	organizationId: string;
	queryClient: QueryClient;
	storageScope: string;
}) {
	const agentProfileIds = normalizeAgentProfileIds(input.agentProfileIds ?? []);
	const refreshes: Promise<unknown>[] = [
		input.queryClient.invalidateQueries({
			predicate:
				agentProfileIds.length === 0
					? undefined
					: (query) =>
							agentProfileIds.some((agentProfileId) =>
								query.queryKey.includes(agentProfileId)
							),
			queryKey: agentExecutionReadinessQueryKeys.batchesForOrganization(
				input.storageScope,
				input.organizationId
			),
			refetchType: "active",
		}),
	];
	const organizationId = input.organizationId.trim();
	if (organizationId.length > 0) {
		refreshes.push(
			input.queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.profileDirectory(organizationId),
				refetchType: "active",
			})
		);
		const overviewQueryKey =
			organizationQueryKeys.agentRuntimeOverview(organizationId);
		if (agentProfileIds.length === 0) {
			refreshes.push(
				input.queryClient.invalidateQueries({
					queryKey: overviewQueryKey,
					refetchType: "active",
				})
			);
		} else {
			const overviewQuery = input.queryClient
				.getQueryCache()
				.find({ exact: true, queryKey: overviewQueryKey });
			if (
				overviewQuery?.isActive() &&
				input.queryClient.getQueryData(overviewQueryKey)
			) {
				refreshes.push(
					refreshAgentRuntimeOverviewReadiness({
						agentProfileIds,
						organizationId,
						overviewQueryKey,
						queryClient: input.queryClient,
					})
				);
			}
		}
	}

	if (input.includeLocalRuntimeCaches !== false) {
		refreshes.push(
			input.queryClient.invalidateQueries({
				queryKey: startQueryKeys.currentDeviceTarget(input.storageScope),
				refetchType: "active",
			}),
			input.queryClient.invalidateQueries({
				queryKey: startQueryKeys.localRuntimes(input.storageScope),
				refetchType: "active",
			}),
			input.queryClient.invalidateQueries({
				queryKey: startQueryKeys.currentLocalRuntimeReplyReadiness(
					input.storageScope
				),
				refetchType: "active",
			})
		);
	}

	await Promise.all(refreshes);
}

async function refreshAgentRuntimeOverviewReadiness(input: {
	agentProfileIds: readonly string[];
	organizationId: string;
	overviewQueryKey: ReturnType<
		typeof organizationQueryKeys.agentRuntimeOverview
	>;
	queryClient: QueryClient;
}) {
	await input.queryClient.cancelQueries({
		exact: true,
		queryKey: input.overviewQueryKey,
	});
	const refreshed = await readAgentExecutionReadinessBatch({
		agentProfileIds: input.agentProfileIds,
		organizationId: input.organizationId,
	});
	const readinessByProfileId = new Map(
		refreshed.items.map((item) => [item.agentProfileId, item] as const)
	);
	input.queryClient.setQueryData<OrganizationAgentRuntimeOverviewResponse>(
		input.overviewQueryKey,
		(current) =>
			current
				? {
						...current,
						agentProfiles: current.agentProfiles.map((profile) => ({
							...profile,
							readiness:
								readinessByProfileId.get(profile.profileId) ??
								profile.readiness,
						})),
					}
				: current
	);
}

async function runWebAgentReadinessRefreshStep(input: {
	action: () => Promise<unknown> | unknown;
	agentProfileIds: readonly string[];
	maxAttempts: number;
	onStepFailure?: (failure: WebAgentReadinessRefreshFailure) => void;
	step: WebAgentReadinessRefreshStep;
	storageScope: string;
}) {
	for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
		try {
			await input.action();
			return;
		} catch (error) {
			if (isQueryCancellationError(error)) {
				return;
			}
			const failure = {
				agentProfileIds: input.agentProfileIds,
				attempt,
				error,
				maxAttempts: input.maxAttempts,
				step: input.step,
				storageScope: input.storageScope,
				willRetry: attempt < input.maxAttempts,
			} satisfies WebAgentReadinessRefreshFailure;
			if (input.onStepFailure) {
				input.onStepFailure(failure);
			} else {
				console.warn("[openmeld.web.agent_readiness_facts_refresh_failed]", {
					agentProfileId: input.agentProfileIds[0] ?? null,
					agentProfileIds: input.agentProfileIds,
					attempt: failure.attempt,
					error: error instanceof Error ? error.message : String(error),
					maxAttempts: failure.maxAttempts,
					step: failure.step,
					storageScope: failure.storageScope,
					willRetry: failure.willRetry,
				});
			}
		}
	}
}

function normalizeAgentProfileIds(
	agentProfileIds: readonly string[]
): string[] {
	const normalizedAgentProfileIds = new Set<string>();
	for (const agentProfileId of agentProfileIds) {
		const normalizedAgentProfileId = agentProfileId.trim();
		if (normalizedAgentProfileId.length > 0) {
			normalizedAgentProfileIds.add(normalizedAgentProfileId);
		}
	}
	return [...normalizedAgentProfileIds];
}
