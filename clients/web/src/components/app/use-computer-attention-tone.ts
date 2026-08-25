"use client";

import { useLocalRuntimeQueries } from "#/components/agents/use-local-runtime-queries";
import { useStartFlowState } from "#/components/app/start-flow-state";
import {
	type ComputerAttentionTone,
	resolveCurrentLocalRuntimeComputerAttentionToneForInventory,
	resolveCurrentLocalRuntimeSubjectDeviceId,
} from "#/lib/computer-summary-status";

export function useComputerAttentionTone(): ComputerAttentionTone | null {
	const { storageScope } = useStartFlowState();
	const localRuntimeQueries = useLocalRuntimeQueries({ storageScope });
	const readinessQuery =
		localRuntimeQueries.currentLocalRuntimeReplyReadinessQuery;
	const localRuntimes = localRuntimeQueries.localRuntimesQuery.data;
	const currentDeviceId =
		resolveCurrentLocalRuntimeSubjectDeviceId(readinessQuery.data) ??
		localRuntimes?.currentDeviceId ??
		null;
	const currentComputer = localRuntimes?.localRuntimes.find(
		(computer) => computer.deviceId === currentDeviceId
	);
	const executionTarget =
		currentComputer?.executionTargets.find((target) => target.isCurrent) ??
		currentComputer?.executionTargets[0] ??
		null;

	return resolveCurrentLocalRuntimeComputerAttentionToneForInventory({
		executionTarget,
		isReconcilingStatus:
			readinessQuery.isFetching && !readinessQuery.isFetchedAfterMount,
		localRuntimeCount: localRuntimes?.localRuntimes.length,
		readiness: readinessQuery.data,
	});
}
