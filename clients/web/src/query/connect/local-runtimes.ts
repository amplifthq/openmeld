import type { StructuredApiClientFailure } from "@openmeld/api-client";
import type {
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalRuntimesResponse,
} from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import {
	readCurrentLocalRuntimeReplyReadiness,
	readLocalRuntimes,
} from "#/lib/connect/local-runtimes";
import { baseQueryOptions } from "#/query/query-config";
import { startQueryKeys } from "#/query/query-keys";
import {
	CURRENT_LOCAL_RUNTIME_REPLY_READINESS_REFRESH_INTERVAL_MS,
	LOCAL_RUNTIME_CATALOG_READY_RECONCILE_DELAY_MS as STRATEGY_LOCAL_RUNTIME_CATALOG_READY_RECONCILE_DELAY_MS,
} from "#/strategy-constants";

const CURRENT_LOCAL_RUNTIME_REPLY_READINESS_REFRESH_MAX_INTERVAL_MS = 30_000;
export const LOCAL_RUNTIME_CATALOG_CHECK_RECOVERY_INTERVAL_MS = 10_000;
export const LOCAL_RUNTIME_USAGE_LIMIT_REFRESH_INTERVAL_MS = 30_000;
export const LOCAL_RUNTIME_CATALOG_READY_RECONCILE_DELAY_MS =
	STRATEGY_LOCAL_RUNTIME_CATALOG_READY_RECONCILE_DELAY_MS;

type ReplyReadinessQueryLike = {
	state: {
		data: CurrentLocalRuntimeReplyReadinessResponse | undefined;
		dataUpdateCount: number;
	};
};

type ReplyReadinessRefreshBudget = {
	evidenceKey: string;
	pollCount: number;
};

type LocalRuntimeCatalogReadyReconcileInput = {
	localRuntimes: LocalRuntimesResponse | undefined;
	readiness: CurrentLocalRuntimeReplyReadinessResponse | undefined;
};

type LocalRuntimeCatalogQueryLike = {
	state: {
		data: LocalRuntimesResponse | undefined;
	};
};

const replyReadinessRefreshBudgets = new WeakMap<
	ReplyReadinessQueryLike,
	ReplyReadinessRefreshBudget
>();

export function boundedCurrentLocalRuntimeReplyReadinessRefetchInterval(
	query: ReplyReadinessQueryLike
): number | false {
	const readiness = query.state.data;
	if (
		!(readiness && shouldRefreshCurrentLocalRuntimeReplyReadiness(readiness))
	) {
		replyReadinessRefreshBudgets.delete(query);
		return false;
	}
	if (typeof document !== "undefined" && document.hidden) {
		return false;
	}
	const evidenceKey = resolveReplyReadinessEvidenceKey(readiness);
	const budget = replyReadinessRefreshBudgets.get(query);
	if (budget?.evidenceKey !== evidenceKey) {
		replyReadinessRefreshBudgets.set(query, {
			evidenceKey,
			pollCount: 1,
		});
		return CURRENT_LOCAL_RUNTIME_REPLY_READINESS_REFRESH_INTERVAL_MS;
	}
	budget.pollCount += 1;
	return resolveReplyReadinessBackoffMs(budget.pollCount);
}

function resolveReplyReadinessBackoffMs(pollCount: number): number {
	const exponent = Math.max(0, pollCount - 1);
	return Math.min(
		CURRENT_LOCAL_RUNTIME_REPLY_READINESS_REFRESH_MAX_INTERVAL_MS,
		CURRENT_LOCAL_RUNTIME_REPLY_READINESS_REFRESH_INTERVAL_MS * 2 ** exponent
	);
}

function resolveReplyReadinessEvidenceKey(
	readiness: CurrentLocalRuntimeReplyReadinessResponse
): string {
	return [
		readiness.status,
		String(readiness.canReplyFromThisComputer),
		readiness.primaryBlocker,
	].join("|");
}

export function localRuntimesQueryOptions(input: {
	enabled: boolean;
	storageScope: string;
}) {
	return queryOptions<LocalRuntimesResponse, StructuredApiClientFailure>({
		queryKey: startQueryKeys.localRuntimes(input.storageScope),
		queryFn: readLocalRuntimes,
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		refetchInterval: localRuntimeCatalogCheckRecoveryRefetchInterval,
		retry: baseQueryOptions.retry,
		staleTime: baseQueryOptions.staleTime,
		refetchOnMount: true,
		refetchOnWindowFocus: false,
	});
}

export function localRuntimeCatalogCheckRecoveryRefetchInterval(
	query: LocalRuntimeCatalogQueryLike
): number | false {
	const hasFailedControllerCheck = query.state.data?.localRuntimes.some(
		(computer) =>
			computer.executionTargets.some((target) =>
				target.capabilities.some(
					(capability) =>
						capability.agentControllerInterface?.check?.status === "failed"
				)
			)
	);
	return hasFailedControllerCheck
		? LOCAL_RUNTIME_CATALOG_CHECK_RECOVERY_INTERVAL_MS
		: LOCAL_RUNTIME_USAGE_LIMIT_REFRESH_INTERVAL_MS;
}

export function shouldReconcileLocalRuntimeCatalogAfterReplyReady(
	input: LocalRuntimeCatalogReadyReconcileInput
): boolean {
	const readiness = input.readiness;
	if (
		readiness?.status !== "ready" ||
		!readiness.canReplyFromThisComputer ||
		readiness.service.connected !== true ||
		readiness.currentTarget.availability !== "resolved"
	) {
		return false;
	}
	const resolvedTarget = readiness.currentTarget;
	const currentTarget = input.localRuntimes?.localRuntimes
		.flatMap((computer) => computer.executionTargets)
		.find(
			(target) =>
				target.deviceId === resolvedTarget.deviceId &&
				target.runtimeLane === resolvedTarget.runtimeLane
		);
	if (!currentTarget) {
		return Boolean(input.localRuntimes);
	}
	if (currentTarget.status !== "ready") {
		return true;
	}
	return currentTarget.localAgentCatalog.entries.some(
		(entry) =>
			entry.detected &&
			(entry.lifecycleStatus === "suspended" || entry.launchStatus !== "ready")
	);
}

export function resolveLocalRuntimeCatalogReadyReconcileKey(
	input: LocalRuntimeCatalogReadyReconcileInput
): string | null {
	if (!shouldReconcileLocalRuntimeCatalogAfterReplyReady(input)) {
		return null;
	}
	const readiness = input.readiness;
	if (readiness?.currentTarget.availability !== "resolved") {
		return null;
	}
	return [
		readiness.currentTarget.deviceId,
		readiness.currentTarget.runtimeLane,
	].join("|");
}

export function currentLocalRuntimeReplyReadinessQueryOptions(input: {
	enabled: boolean;
	refetchIntervalMs?: false | number;
	storageScope: string;
}) {
	return queryOptions<
		CurrentLocalRuntimeReplyReadinessResponse,
		StructuredApiClientFailure
	>({
		queryKey: startQueryKeys.currentLocalRuntimeReplyReadiness(
			input.storageScope
		),
		queryFn: readCurrentLocalRuntimeReplyReadiness,
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		retry: baseQueryOptions.retry,
		staleTime: baseQueryOptions.staleTime,
		// A prior Connected result is historical evidence, not current liveness.
		// Every status surface must reconcile it when the surface mounts.
		refetchOnMount: "always",
		refetchInterval:
			input.refetchIntervalMs === undefined
				? boundedCurrentLocalRuntimeReplyReadinessRefetchInterval
				: input.refetchIntervalMs,
		refetchOnWindowFocus: false,
	});
}

function shouldRefreshCurrentLocalRuntimeReplyReadiness(
	readiness: CurrentLocalRuntimeReplyReadinessResponse | undefined
): boolean {
	if (!readiness) {
		return false;
	}
	return !readiness.canReplyFromThisComputer || readiness.status === "checking";
}
