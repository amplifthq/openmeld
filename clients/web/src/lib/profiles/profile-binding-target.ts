import { resolveSelectableCandidates } from "@openmeld/agent-runtime";
import type {
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
} from "@openmeld/schemas/types";
import type { ConnectedRuntimeSources } from "#/lib/connect/connected-runtime";

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

// The catalog and Binding must use the same selected computer and lane.
// Missing selection or catalog is not permission to choose another computer.
export function resolveProfileBindingCatalogExecutionTarget(
	sources: ProfileBindingCatalogExecutionTargetSources,
	preference?: ProfileBindingCatalogExecutionTargetPreference
): LocalRuntimeExecutionTarget | null {
	if (preference) {
		return resolvePreferredProfileBindingExecutionTarget(sources, preference);
	}
	return sources.selectedExecutionTarget ?? null;
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
