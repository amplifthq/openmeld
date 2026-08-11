"use client";

import { useLocalRuntimeQueries } from "#/components/agents/use-local-runtime-queries";
import { useStartFlowState } from "#/components/app/start-flow-state";
import {
	resolveCurrentLocalRuntimeSettingsAttentionToneForInventory,
	type SettingsAttentionTone,
} from "#/lib/settings-attention";

export function useSettingsAttentionTone(): SettingsAttentionTone | null {
	const { storageScope } = useStartFlowState();
	const localRuntimeQueries = useLocalRuntimeQueries({ storageScope });

	return resolveCurrentLocalRuntimeSettingsAttentionToneForInventory({
		localRuntimeCount:
			localRuntimeQueries.localRuntimesQuery.data?.localRuntimes.length,
		readiness: localRuntimeQueries.currentLocalRuntimeReplyReadinessQuery.data,
	});
}
