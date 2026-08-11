import {
	type AgentProfileReplyRecoveryCurrentLocalRuntimeReplyState,
	type AgentProfileReplyRecoveryPlan,
	planAgentProfileReplyRecovery,
	type SelectableLocalAgentTarget,
} from "@openmeld/agent-profile";
import { buildAgentControllerRef } from "@openmeld/agent-runtime";
import type {
	SpaceMemberAgentSnapshot,
	StartDeviceProjection,
} from "@openmeld/schemas/types";
import type { ComputerReplyReadiness } from "@openmeld/start";

export type WebAgentProfileReplyRecoveryLocalAgentCatalog =
	StartDeviceProjection["deviceAgentCatalog"];

export function planAgentProfileReplyRecoveryFromWebEvidence(input: {
	autoRefreshExhausted?: boolean;
	currentLocalRuntimeReplyReadiness?: ComputerReplyReadiness | null;
	localAgentCatalog?: WebAgentProfileReplyRecoveryLocalAgentCatalog | null;
	member: SpaceMemberAgentSnapshot;
}): AgentProfileReplyRecoveryPlan {
	return planAgentProfileReplyRecovery({
		autoRefreshExhausted: input.autoRefreshExhausted,
		currentLocalRuntimeReplyState: mapCurrentLocalRuntimeReplyState(
			input.currentLocalRuntimeReplyReadiness ?? null
		),
		member: input.member,
		selectableLocalAgentTargets: mapSelectableLocalAgentTargets(
			input.localAgentCatalog ?? null
		),
	});
}

function mapCurrentLocalRuntimeReplyState(
	readiness: ComputerReplyReadiness | null
): AgentProfileReplyRecoveryCurrentLocalRuntimeReplyState | null {
	if (readiness === null) {
		return null;
	}

	switch (readiness.status) {
		case "ready":
		case "checking":
		case "unknown":
			return readiness.status;
		case "needs_repair":
		case "needs_setup":
			return "not_ready";
		default:
			return "unknown";
	}
}

function mapSelectableLocalAgentTargets(
	catalog: WebAgentProfileReplyRecoveryLocalAgentCatalog | null
): readonly SelectableLocalAgentTarget[] | null {
	if (catalog === null) {
		return null;
	}

	const targets: SelectableLocalAgentTarget[] = [];
	for (const entry of catalog.entries) {
		if (!entry.selectable) {
			continue;
		}

		const agentControllerRef = buildAgentControllerRef({
			kind: entry.targetKind,
			id: entry.agentId,
		});

		targets.push({
			agentId: entry.agentId,
			agentControllerRef,
			displayName: entry.displayName,
		});
	}

	return targets;
}
