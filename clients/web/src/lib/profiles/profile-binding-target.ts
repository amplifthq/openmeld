import { resolveSelectableCandidates } from "@openmeld/agent-runtime";
import type {
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
} from "@openmeld/schemas/types";
import {
	type ConnectedRuntimeSources,
	resolveConnectedLocalRuntime,
} from "#/lib/connect/connected-runtime";

export type ProfileBindingCatalogExecutionTargetSources =
	ConnectedRuntimeSources & {
		currentComputer?: LocalRuntimeComputer | null;
		selectedExecutionTarget?: LocalRuntimeExecutionTarget | null;
	};

export type ProfileBindingCatalogExecutionTargetPreference = {
	connectedComputerId: string;
	localAgentId: string;
};

// Binding is a configuration choice. Readiness remains display/repair metadata,
// so the candidate filter must stay launchStatus-agnostic.
export function bindableLocalAgentIdsFromTarget(
	executionTarget: LocalRuntimeExecutionTarget | null | undefined
): string[] {
	const entries = executionTarget?.localAgentCatalog.entries ?? [];
	return resolveSelectableCandidates(
		entries.map((entry) => ({
			...entry,
			registered: entry.detected,
		}))
	).map((entry) => entry.agentId);
}

export function bindableLocalAgentEntriesFromTarget(
	executionTarget: LocalRuntimeExecutionTarget | null | undefined
) {
	const bindableAgentIds = new Set(
		bindableLocalAgentIdsFromTarget(executionTarget)
	);
	return (executionTarget?.localAgentCatalog.entries ?? []).filter((entry) =>
		bindableAgentIds.has(entry.agentId)
	);
}

// The current-device target is often unresolved (no isCurrent computer, empty
// currentDeviceId) even when the service is connected and agents are detected.
// Prefer the resolved current-device target, then the live connected runtime,
// then any reported computer, and read its current/first execution target.
export function resolveProfileBindingCatalogExecutionTarget(
	sources: ProfileBindingCatalogExecutionTargetSources,
	preference?: ProfileBindingCatalogExecutionTargetPreference
): LocalRuntimeExecutionTarget | null {
	if (preference) {
		return resolvePreferredProfileBindingExecutionTarget(sources, preference);
	}
	if (sources.selectedExecutionTarget) {
		return sources.selectedExecutionTarget;
	}
	const computer =
		resolveConnectedLocalRuntime(sources) ??
		sources.currentComputer ??
		sources.localRuntimesQuery?.data?.localRuntimes[0] ??
		null;
	if (!computer) {
		return null;
	}
	return (
		computer.executionTargets.find((target) => target.isCurrent) ??
		computer.executionTargets[0] ??
		null
	);
}

function resolvePreferredProfileBindingExecutionTarget(
	sources: ProfileBindingCatalogExecutionTargetSources,
	preference: ProfileBindingCatalogExecutionTargetPreference
): LocalRuntimeExecutionTarget | null {
	const connectedComputer =
		sources.localRuntimesQuery?.data?.localRuntimes.find(
			(computer) =>
				computer.connectedComputerId === preference.connectedComputerId
		) ?? null;
	if (!(connectedComputer && preference.localAgentId)) {
		return null;
	}
	const compatibleTargets = connectedComputer.executionTargets.filter(
		(target) =>
			new Set(bindableLocalAgentIdsFromTarget(target)).has(
				preference.localAgentId
			)
	);
	return (
		compatibleTargets.find((target) => target.isCurrent) ??
		compatibleTargets[0] ??
		null
	);
}
