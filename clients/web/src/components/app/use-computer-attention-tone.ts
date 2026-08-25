"use client";

import { useLocalRuntimeQueries } from "#/components/agents/use-local-runtime-queries";
import { useStartFlowState } from "#/components/app/start-flow-state";
import {
	type ComputerAttentionTone,
	resolveCurrentLocalRuntimeComputerAttentionToneForInventory,
} from "#/lib/computer-summary-status";

export function useComputerAttentionTone(): ComputerAttentionTone | null {
	const { storageScope } = useStartFlowState();
	const localRuntimeQueries = useLocalRuntimeQueries({ storageScope });
	const readinessQuery =
		localRuntimeQueries.currentLocalRuntimeReplyReadinessQuery;
	const localRuntimes = localRuntimeQueries.localRuntimesQuery.data;

	return resolveCurrentLocalRuntimeComputerAttentionToneForInventory({
		isReconcilingStatus:
			readinessQuery.isFetching && !readinessQuery.isFetchedAfterMount,
		localRuntimeCount: localRuntimes?.localRuntimes.length,
		readiness: readinessQuery.data,
	});
}
